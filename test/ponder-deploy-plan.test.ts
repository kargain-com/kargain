import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  planNeverSwitchesOnHold,
  planPonderDeploy,
} from "../scripts/lib/ponder-deploy-plan.ts";
import {
  baseObs,
  evidenceTexts,
  newerSchema,
  newerSha,
  noAnswer,
  otherSchema,
  otherSha,
  PLAN_CONTROLS,
  postCutoverState,
  preCutoverState,
  schema,
  sha,
  slotRef,
  status,
} from "./fixtures/ponder-deploy-plan-controls.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_SRC = path.join(ROOT, "scripts/lib/ponder-deploy-plan.ts");
const STATE_SRC = path.join(ROOT, "scripts/lib/ponder-deploy-state.ts");
const VIEWS_SRC = path.join(ROOT, "scripts/lib/ponder-views-switch.ts");

describe("ponder-deploy-plan", () => {
  it("self-contained: plan/state/views import only scripts/lib + builtins", () => {
    for (const file of [PLAN_SRC, STATE_SRC, VIEWS_SRC]) {
      const src = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(
        src,
        /from ["']\.\.\/\.\.\/lib\//,
        `${path.basename(file)} must not import lib/`,
      );
      assert.doesNotMatch(
        src,
        /from ["']@\//,
        `${path.basename(file)} must not import @/`,
      );
    }
  });

  it("constructed: import of lib/web3/commercial-active from plan is red", () => {
    const dirty = `${fs.readFileSync(PLAN_SRC, "utf8")}\nimport { x } from "../../lib/web3/commercial-active.ts";\n`;
    assert.throws(() => {
      assert.doesNotMatch(dirty, /from ["']\.\.\/\.\.\/lib\//);
    });
  });

  it("A9: push pre-cutover prints awaiting_dispatch and exits", () => {
    const result = planPonderDeploy({
      state: preCutoverState(),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({ eventName: "push" }),
    });
    assert.ok(
      evidenceTexts(result).includes(
        "deploy_evidence cutover=awaiting_dispatch",
      ),
    );
    assert.ok(result.actions.some((a) => a.type === "exit" && a.code === 0));
    assert.ok(!result.actions.some((a) => a.type === "start_slot"));
  });

  it("A1 sequence: hold then deploy still plans first_cutover", () => {
    // Run 1 (hold) shape: pre-cutover with pending + legacy_schema recorded.
    const afterHold = preCutoverState({
      pending: slotRef("blue", schema, sha, "execB"),
      legacy_schema: otherSchema,
      rollback_model: "keep_previous",
    });
    const result = planPonderDeploy({
      state: afterHold,
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        ready: { blue: status(200), green: noAnswer, nginx: noAnswer },
        executableDigest: "execB",
        kargainHasBaseTables: true,
        eventName: "workflow_dispatch",
      }),
    });
    const switchAction = result.actions.find((a) => a.type === "switch_views");
    assert.ok(switchAction && switchAction.type === "switch_views");
    assert.equal(switchAction.kind, "first_cutover");
  });

  it("A6: ready pending then newer commit continues start in same plan", () => {
    const pending = slotRef("green", schema, sha, "execB");
    const result = planPonderDeploy({
      state: postCutoverState({
        pending,
        rollback_model: "keep_previous",
        live: slotRef("blue", otherSchema, otherSha, "execA"),
      }),
      operation: "deploy",
      deploySha: newerSha,
      observations: baseObs({
        ready: { blue: status(200), green: status(200), nginx: status(200) },
        storedExecutable: "execA",
        executableDigest: "execC",
        deploySha: newerSha,
        deployCommit: newerSha,
        kargainHasBaseTables: false,
      }),
    });
    assert.ok(result.actions.some((a) => a.type === "switch_views"));
    assert.ok(result.actions.some((a) => a.type === "start_slot"));
    const switchedLive = result.actions.find(
      (a) =>
        a.type === "write_state" &&
        a.state.live?.executable === "execB" &&
        a.state.pending === null,
    );
    assert.ok(switchedLive, "switch must record pending's executable as live");
    const continuedPending = result.actions.find(
      (a) =>
        a.type === "write_state" &&
        a.state.pending?.schema === newerSchema &&
        a.state.pending?.executable === "execC",
    );
    assert.ok(
      continuedPending,
      "same run must continue start for the newer commit",
    );
  });

  it("hold never switches", () => {
    const result = planPonderDeploy({
      state: preCutoverState(),
      operation: "hold",
      deploySha: sha,
      observations: baseObs({ executableDigest: "new" }),
    });
    assert.equal(planNeverSwitchesOnHold(result), true);
    assert.ok(
      evidenceTexts(result).includes(
        `deploy_evidence switch=pending schema=${schema}`,
      ),
    );
  });

  it("constructed: hold that emits switch_views is red vs planNeverSwitchesOnHold", () => {
    const planted = {
      actions: [
        {
          type: "switch_views" as const,
          targetSchema: schema,
          kind: "normal" as const,
          renameLiveTo: "kargain_views_prev",
        },
      ],
    };
    assert.equal(planNeverSwitchesOnHold(planted), false);
  });

  it("constructed: switch with rollback_model unset is blocked, stays pending", () => {
    const result = planPonderDeploy({
      state: preCutoverState({
        pending: slotRef("blue", schema, sha, "new"),
        rollback_model: null,
      }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        ready: { blue: status(200), green: noAnswer, nginx: noAnswer },
        executableDigest: "new",
        kargainHasBaseTables: true,
      }),
    });
    const texts = evidenceTexts(result);
    assert.ok(texts.includes("deploy_switch_blocked: rollback_model_unset"));
    assert.ok(
      texts.includes(`deploy_evidence switch=pending schema=${schema}`),
    );
    assert.ok(!result.actions.some((a) => a.type === "switch_views"));
  });

  it("B3: keep_previous rollback waits ready200 before flip", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        live: slotRef("green", schema, sha, "execNew"),
        previous: slotRef("blue", otherSchema, otherSha, "execOld"),
        rollback_model: "keep_previous",
      }),
      operation: "rollback",
      deploySha: sha,
      observations: baseObs({
        ready: { blue: status(200), green: status(200), nginx: status(200) },
        storedExecutable: "execNew",
        executableDigest: "execNew",
        kargainHasBaseTables: false,
      }),
    });
    const types = result.actions.map((a) => a.type);
    const firstReady = result.actions.findIndex(
      (a) =>
        a.type === "wait_ready200" &&
        a.target === "slot" &&
        a.slot === "blue" &&
        a.timeoutMs === 60_000 &&
        a.onTimeout === "fail",
    );
    const switchIdx = types.indexOf("switch_views");
    assert.ok(firstReady >= 0, "must wait previous /ready 200");
    assert.ok(switchIdx > firstReady, "flip only after ready gate");
    const wait = result.actions[firstReady]!;
    assert.ok(wait.type === "wait_ready200");
    assert.equal(wait.failEvidence, "deploy_rollback_failed: waited 60s");
  });

  it("B7: wait_answered precedes wait_ready200 on new start", () => {
    const result = planPonderDeploy({
      state: postCutoverState({ rollback_model: "keep_previous" }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        ready: { blue: status(200), green: noAnswer, nginx: status(200) },
        storedExecutable: "old",
        executableDigest: "new",
        kargainHasBaseTables: false,
      }),
    });
    const types = result.actions.map((a) => a.type);
    const answeredIdx = types.indexOf("wait_answered");
    const readyIdx = types.indexOf("wait_ready200");
    assert.ok(answeredIdx >= 0);
    assert.ok(readyIdx > answeredIdx);
  });

  it("same-commit collision: live schema + unchanged executable → reason=live_schema", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        live: slotRef("blue", schema, sha, "exec1"),
        executable: "exec1",
      }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        storedExecutable: "exec1",
        executableDigest: "exec1",
        kargainHasBaseTables: false,
      }),
    });
    const texts = evidenceTexts(result);
    assert.ok(texts.includes("deploy_evidence outcome=unchanged"));
    assert.ok(texts.includes(`deploy_evidence schema=${schema}`));
    assert.ok(texts.includes("deploy_evidence reason=live_schema"));
  });

  it("constructed: superseding a ready pending fails (must switch-first)", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        pending: slotRef("green", schema, sha, "execB"),
        rollback_model: "keep_previous",
      }),
      operation: "deploy",
      deploySha: newerSha,
      observations: baseObs({
        ready: { blue: status(200), green: status(200), nginx: status(200) },
        storedExecutable: "old",
        executableDigest: "new",
        kargainHasBaseTables: false,
      }),
    });
    const types = result.actions.map((a) => a.type);
    const dropIdx = types.indexOf("drop_schema");
    const switchIdx = types.indexOf("switch_views");
    assert.ok(switchIdx >= 0, "must switch ready pending");
    assert.ok(
      dropIdx < 0 || switchIdx < dropIdx,
      "must not supersede ready pending",
    );
  });

  it("constructed: keeping a not-ready pending beside a new start fails (must supersede)", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        pending: slotRef("green", schema, sha, "execB"),
        rollback_model: "keep_previous",
      }),
      operation: "deploy",
      deploySha: newerSha,
      observations: baseObs({
        ready: { blue: status(200), green: status(503), nginx: status(200) },
        storedExecutable: "old",
        executableDigest: "new",
        kargainHasBaseTables: false,
      }),
    });
    assert.ok(result.actions.some((a) => a.type === "drop_schema"));
    assert.ok(result.actions.some((a) => a.type === "stop_slot"));
  });

  it("A3: probe_failed refuses before mutation", () => {
    const result = planPonderDeploy({
      state: postCutoverState(),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        ready: {
          blue: { kind: "probe_failed", detail: "compose" },
          green: noAnswer,
          nginx: noAnswer,
        },
        kargainHasBaseTables: false,
      }),
    });
    assert.ok(
      evidenceTexts(result).includes("deploy_observation_failed: blue"),
    );
    assert.ok(!result.actions.some((a) => a.type === "start_slot"));
  });

  it("under keep_previous, switch does not stop previous writer", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        pending: slotRef("green", schema, sha, "execB"),
        rollback_model: "keep_previous",
        live: slotRef("blue", otherSchema),
      }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        ready: { blue: status(200), green: status(200), nginx: status(200) },
        storedExecutable: "old",
        executableDigest: "execB",
        kargainHasBaseTables: false,
      }),
    });
    const stopBlue = result.actions.some(
      (a) => a.type === "stop_slot" && a.slot === "blue",
    );
    assert.equal(stopBlue, false);
  });

  it("under restart_previous, switch stops previous writer", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        pending: slotRef("green", schema, sha, "execB"),
        rollback_model: "restart_previous",
        live: slotRef("blue", otherSchema),
      }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        ready: { blue: status(200), green: status(200), nginx: status(200) },
        storedExecutable: "old",
        executableDigest: "execB",
        kargainHasBaseTables: false,
      }),
    });
    assert.ok(
      result.actions.some((a) => a.type === "stop_slot" && a.slot === "blue"),
    );
  });

  it("A9 / R1: push never finishes an interrupted first cutover", () => {
    const result = planPonderDeploy({
      state: preCutoverState({
        phase: "first_cutover_interrupted",
        pending: slotRef("blue", schema, sha, "execB"),
        rollback_model: "keep_previous",
        legacy_schema: otherSchema,
        legacy_image: "sha256:legacy",
      }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        eventName: "push",
        ready: { blue: status(200), green: noAnswer, nginx: noAnswer },
        kargainHasBaseTables: false,
        kargainViewsTarget: schema,
      }),
    });
    assert.ok(
      evidenceTexts(result).includes("deploy_evidence cutover=awaiting_dispatch"),
    );
    assert.ok(!result.actions.some((a) => a.type === "up_nginx"));
  });

  it("R8: the plan types and gate know only push | workflow_dispatch", () => {
    const src = fs.readFileSync(PLAN_SRC, "utf8");
    assert.doesNotMatch(src, /rehearsal/i);
    assert.match(
      src,
      /eventName: "push" \| "workflow_dispatch"/,
      "eventName is a closed union",
    );
  });
});

describe("ponder-deploy-plan controls (R21: red on a planted defect, green on the real planner)", () => {
  assert.ok(PLAN_CONTROLS.length > 0, "controls must not be an empty set");
  for (const control of PLAN_CONTROLS) {
    it(`${control.id}: ${control.title}`, () => {
      assert.ok(control.planted.length > 0, "a control needs a planted defect");
      for (const defect of control.planted) {
        assert.throws(
          () => control.run(defect.planner),
          (err: unknown) => {
            assert.ok(
              err instanceof assert.AssertionError,
              `planted "${defect.name}" must fail by assertion, got ${String(err)}`,
            );
            assert.match(
              err.message,
              defect.expect,
              `planted "${defect.name}" failed with the wrong assertion`,
            );
            return true;
          },
          `planted defect "${defect.name}" must turn the control red`,
        );
      }
      control.run(planPonderDeploy);
    });
  }
});

describe("ponder-deploy-plan-cli (R1 / R8 observation contract)", () => {
  const cli = path.join(ROOT, "scripts/ponder-deploy-plan-cli.ts");

  function runCli(
    state: unknown,
    observations: Record<string, unknown>,
    operation = "deploy",
  ) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-plan-cli-"));
    try {
      const statePath = path.join(dir, "state.json");
      const obsPath = path.join(dir, "obs.json");
      fs.writeFileSync(statePath, JSON.stringify(state));
      fs.writeFileSync(obsPath, JSON.stringify(observations));
      return spawnSync(
        "node",
        [
          "--import",
          "tsx",
          cli,
          "--state",
          statePath,
          "--observations",
          obsPath,
          "--operation",
          operation,
          "--deploy-sha",
          sha,
        ],
        { cwd: ROOT, encoding: "utf8" },
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const fileState = {
    identity: "id0",
    executable: "exec0",
    live: null,
    previous: null,
    pending: { slot: "blue", schema, commit: sha, executable: "execB" },
    rollback_model: "keep_previous",
    lag: null,
    legacy_schema: otherSchema,
    legacy_image: "sha256:legacy",
    nginx_config_digest: null,
  };

  const wireObs = (over: Record<string, unknown> = {}) => ({
    ready: {
      blue: { kind: "status", code: 200 },
      green: { kind: "no_answer" },
      nginx: { kind: "no_answer" },
    },
    schemas: [otherSchema, schema],
    storedExecutable: "",
    executableDigest: "execB",
    identityDigest: "id1",
    deploySha: sha,
    deployCommit: sha,
    priorCheckoutSha: otherSha,
    nginxConfigDigest: "nginx0",
    eventName: "workflow_dispatch",
    legacyImageId: "sha256:legacy",
    kargainHasBaseTables: false,
    kargainViewsTarget: schema,
    kargainWriter: null,
    ...over,
  });

  it("R1: views target = pending.schema with live null plans the resumed HTTP half (no deploy_state_invalid)", () => {
    const out = runCli(fileState, wireObs());
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.doesNotMatch(out.stdout, /deploy_state_invalid/);
    assert.match(out.stdout, /write_upstream/);
    assert.match(out.stdout, /up_nginx/);
    assert.doesNotMatch(out.stdout, /switch_views/);
  });

  it("R1: any other views disagreement stays deploy_state_invalid", () => {
    const out = runCli(fileState, wireObs({ kargainViewsTarget: otherSchema }));
    assert.notEqual(out.status, 0);
    assert.match(out.stdout + out.stderr, /deploy_state_invalid/);
  });

  it("R8: event_name must be push|workflow_dispatch (rehearsal and absent are refused)", () => {
    for (const eventName of ["rehearsal", "pull_request", "", undefined]) {
      const out = runCli(fileState, wireObs({ eventName }));
      assert.notEqual(out.status, 0, String(eventName));
      assert.match(
        out.stdout + out.stderr,
        /deploy_observation_failed: event_name/,
        String(eventName),
      );
    }
  });
});
