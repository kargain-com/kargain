import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  planNeverSwitchesOnHold,
  planPonderDeploy,
  type PonderDeployObservations,
} from "../scripts/lib/ponder-deploy-plan.ts";
import type { PonderDeployState } from "../scripts/lib/ponder-deploy-state.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_SRC = path.join(ROOT, "scripts/lib/ponder-deploy-plan.ts");
const STATE_SRC = path.join(ROOT, "scripts/lib/ponder-deploy-state.ts");
const VIEWS_SRC = path.join(ROOT, "scripts/lib/ponder-views-switch.ts");

const sha = "f".repeat(40);
const schema = `k_${sha}`;
const otherSha = "a".repeat(40);
const otherSchema = `k_${otherSha}`;

function baseObs(
  over: Partial<PonderDeployObservations> = {},
): PonderDeployObservations {
  return {
    ready: { blue: null, green: null, legacy: null, nginx: null },
    schemas: [],
    storedExecutable: "",
    executableDigest: "exec1",
    identityDigest: "id1",
    priorCheckoutSha: otherSha,
    nginxConfigChanged: false,
    ...over,
  };
}

function preCutoverState(
  over: Partial<PonderDeployState> = {},
): PonderDeployState {
  return {
    identity: "id0",
    executable: "exec0",
    live: null,
    previous: null,
    pending: null,
    rollback_model: null,
    lag: null,
    legacy_schema: null,
    preCutover: true,
    ...over,
  };
}

function postCutoverState(
  over: Partial<PonderDeployState> = {},
): PonderDeployState {
  return {
    identity: "id0",
    executable: "exec0",
    live: { slot: "blue", schema: otherSchema },
    previous: null,
    pending: null,
    rollback_model: "keep_previous",
    lag: { l_single_max: 1, m: 30, b: 31 },
    legacy_schema: otherSchema,
    preCutover: false,
    ...over,
  };
}

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

  it("hold never switches", () => {
    const result = planPonderDeploy({
      state: preCutoverState(),
      operation: "hold",
      deploySha: sha,
      observations: baseObs({ executableDigest: "new" }),
    });
    assert.equal(planNeverSwitchesOnHold(result), true);
    assert.ok(
      result.actions.some(
        (a) =>
          a.type === "evidence" &&
          a.text === `deploy_evidence switch=pending schema=${schema}`,
      ),
    );
  });

  it("constructed: switch with rollback_model unset is blocked, stays pending", () => {
    const result = planPonderDeploy({
      state: preCutoverState({
        pending: { slot: "blue", schema },
        rollback_model: null,
      }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        ready: { blue: 200, green: null, legacy: null, nginx: null },
        executableDigest: "new",
      }),
    });
    const texts = result.actions
      .filter((a) => a.type === "evidence")
      .map((a) => (a.type === "evidence" ? a.text : ""));
    assert.ok(texts.includes("deploy_switch_blocked: rollback_model_unset"));
    assert.ok(
      texts.includes(`deploy_evidence switch=pending schema=${schema}`),
    );
    assert.ok(!result.actions.some((a) => a.type === "switch_views"));
  });

  it("same-commit collision: live schema + unchanged executable → reason=live_schema", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        live: { slot: "blue", schema },
        executable: "exec1",
      }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        storedExecutable: "exec1",
        executableDigest: "exec1",
      }),
    });
    const texts = result.actions
      .filter((a) => a.type === "evidence")
      .map((a) => (a.type === "evidence" ? a.text : ""));
    assert.ok(texts.includes("deploy_evidence outcome=unchanged"));
    assert.ok(texts.includes(`deploy_evidence schema=${schema}`));
    assert.ok(texts.includes("deploy_evidence reason=live_schema"));
  });

  it("constructed: superseding a ready pending fails (must switch-first)", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        pending: { slot: "green", schema },
        rollback_model: "keep_previous",
      }),
      operation: "deploy",
      deploySha: "b".repeat(40),
      observations: baseObs({
        ready: { blue: 200, green: 200, legacy: null, nginx: 200 },
        storedExecutable: "old",
        executableDigest: "new",
      }),
    });
    // First actions after operation evidence should switch pending, not drop it
    const types = result.actions.map((a) => a.type);
    const dropIdx = types.indexOf("drop_schema");
    const switchIdx = types.indexOf("switch_views");
    assert.ok(switchIdx >= 0, "must switch ready pending");
    assert.ok(dropIdx < 0 || switchIdx < dropIdx, "must not supersede ready pending");
  });

  it("constructed: keeping a not-ready pending beside a new start fails (must supersede)", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        pending: { slot: "green", schema },
        rollback_model: "keep_previous",
      }),
      operation: "deploy",
      deploySha: "b".repeat(40),
      observations: baseObs({
        ready: { blue: 200, green: 503, legacy: null, nginx: 200 },
        storedExecutable: "old",
        executableDigest: "new",
      }),
    });
    assert.ok(result.actions.some((a) => a.type === "drop_schema"));
    assert.ok(result.actions.some((a) => a.type === "stop_slot"));
  });

  it("under keep_previous, switch does not stop previous writer", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        pending: { slot: "green", schema },
        rollback_model: "keep_previous",
        live: { slot: "blue", schema: otherSchema },
      }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        ready: { blue: 200, green: 200, legacy: null, nginx: 200 },
        storedExecutable: "old",
        executableDigest: "new",
      }),
    });
    const stopBlue = result.actions.some(
      (a) => a.type === "stop_slot" && a.slot === "blue",
    );
    assert.equal(stopBlue, false);
  });

  it("constructed: under keep_previous, stopping previous on switch is red", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        pending: { slot: "green", schema },
        rollback_model: "keep_previous",
        live: { slot: "blue", schema: otherSchema },
      }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        ready: { blue: 200, green: 200, legacy: null, nginx: 200 },
        storedExecutable: "old",
        executableDigest: "new",
      }),
    });
    assert.throws(() => {
      assert.ok(
        result.actions.some(
          (a) => a.type === "stop_slot" && a.slot === "blue",
        ),
      );
    });
  });

  it("under restart_previous, switch stops previous writer", () => {
    const result = planPonderDeploy({
      state: postCutoverState({
        pending: { slot: "green", schema },
        rollback_model: "restart_previous",
        live: { slot: "blue", schema: otherSchema },
      }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        ready: { blue: 200, green: 200, legacy: null, nginx: 200 },
        storedExecutable: "old",
        executableDigest: "new",
      }),
    });
    assert.ok(
      result.actions.some((a) => a.type === "stop_slot" && a.slot === "blue"),
    );
  });

  it("switching before ready200 is not planned (wait precedes switch)", () => {
    const result = planPonderDeploy({
      state: postCutoverState({ rollback_model: "keep_previous" }),
      operation: "deploy",
      deploySha: sha,
      observations: baseObs({
        ready: { blue: 200, green: null, legacy: null, nginx: 200 },
        storedExecutable: "old",
        executableDigest: "new",
      }),
    });
    const types = result.actions.map((a) => a.type);
    const waitIdx = types.indexOf("wait_ready200");
    const switchIdx = types.indexOf("switch_views");
    assert.ok(waitIdx >= 0);
    assert.ok(switchIdx > waitIdx);
  });
});
