/**
 * Plan controls (Review 2 / R21): each control asserts one property of the planner's
 * output for a constructed scenario, and every planted defect — a wrapper around the real
 * planner that reintroduces the defect — must make it fail with an AssertionError.
 * `test/ponder-deploy-plan.test.ts` runs each control red (planted) then green (real).
 */
import assert from "node:assert/strict";

import {
  planPonderDeploy,
  type PlanAction,
  type PlanResult,
  type PonderDeployObservations,
  type ProbeObservation,
} from "../../scripts/lib/ponder-deploy-plan.ts";
import { keepSetFromState } from "../../scripts/lib/ponder-deploy-retention.ts";
import type {
  PonderDeployState,
  PonderSlotRef,
} from "../../scripts/lib/ponder-deploy-state.ts";

export const sha = "f".repeat(40);
export const schema = `k_${sha}`;
export const otherSha = "a".repeat(40);
export const otherSchema = `k_${otherSha}`;
export const newerSha = "b".repeat(40);
export const newerSchema = `k_${newerSha}`;
export const oldSchema = `k_${"c".repeat(40)}`;

export const status = (code: number): ProbeObservation => ({
  kind: "status",
  code,
});
export const noAnswer: ProbeObservation = { kind: "no_answer" };

export function slotRef(
  slot: "blue" | "green",
  schemaName: string,
  commit = otherSha,
  executable = "exec0",
): PonderSlotRef {
  return { slot, schema: schemaName, commit, executable };
}

export function baseObs(
  over: Partial<PonderDeployObservations> = {},
): PonderDeployObservations {
  return {
    ready: { blue: noAnswer, green: noAnswer, nginx: noAnswer },
    schemas: [],
    storedExecutable: "",
    executableDigest: "exec1",
    identityDigest: "id1",
    deploySha: sha,
    deployCommit: sha,
    priorCheckoutSha: otherSha,
    nginxConfigDigest: "nginx0",
    eventName: "workflow_dispatch",
    legacyImageId: "sha256:legacy",
    kargainHasBaseTables: true,
    kargainViewsTarget: null,
    kargainWriter: null,
    ...over,
  };
}

export function preCutoverState(
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
    legacy_image: null,
    nginx_config_digest: null,
    phase: "pre_cutover",
    ...over,
  };
}

export function postCutoverState(
  over: Partial<PonderDeployState> = {},
): PonderDeployState {
  return {
    identity: "id0",
    executable: "exec0",
    live: slotRef("blue", otherSchema),
    previous: null,
    pending: null,
    rollback_model: "keep_previous",
    lag: { l_single_max: 1, m: 30, b: 31 },
    legacy_schema: otherSchema,
    legacy_image: "sha256:legacy",
    nginx_config_digest: "nginx0",
    phase: "post_cutover",
    ...over,
  };
}

export function evidenceTexts(result: PlanResult): string[] {
  return result.actions.flatMap((a) => (a.type === "evidence" ? [a.text] : []));
}

export type Planner = typeof planPonderDeploy;

export type PlantedDefect = {
  name: string;
  planner: Planner;
  /** The failing assertion text the control must produce under this defect. */
  expect: RegExp;
};

export type PlanControl = {
  id: string;
  title: string;
  run: (plan: Planner) => void;
  planted: readonly PlantedDefect[];
};

type Args = Parameters<Planner>[0];

function mutated(fn: (actions: PlanAction[]) => PlanAction[]): Planner {
  return (args) => ({ actions: fn(planPonderDeploy(args).actions) });
}

function observing(
  fn: (obs: PonderDeployObservations) => PonderDeployObservations,
): Planner {
  return (args) =>
    planPonderDeploy({ ...args, observations: fn(args.observations) });
}

function replacing(fn: (args: Args) => PlanResult | null): Planner {
  return (args) => fn(args) ?? planPonderDeploy(args);
}

function indexOf(actions: PlanAction[], pred: (a: PlanAction) => boolean): number {
  return actions.findIndex(pred);
}

/** Every named step is present and they appear in this order. */
function assertOrder(
  actions: PlanAction[],
  steps: ReadonlyArray<readonly [string, (a: PlanAction) => boolean]>,
  context: string,
): void {
  let prev = -1;
  let prevName = "(start)";
  for (const [name, pred] of steps) {
    const at = indexOf(actions, pred);
    assert.ok(at >= 0, `${context}: missing step ${name}`);
    assert.ok(
      at > prev,
      `${context}: ${name} must come after ${prevName} (indexes ${at} <= ${prev})`,
    );
    prev = at;
    prevName = name;
  }
}

function exitCode(actions: PlanAction[]): number | null {
  const last = actions[actions.length - 1];
  return last && last.type === "exit" ? last.code : null;
}

function lastWrittenState(actions: PlanAction[]): PonderDeployState | null {
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i]!;
    if (a.type === "write_state") return a.state;
  }
  return null;
}

function writtenStates(actions: PlanAction[]): PonderDeployState[] {
  return actions.flatMap((a) => (a.type === "write_state" ? [a.state] : []));
}

const evidenceOnly = (...texts: string[]): PlanResult => ({
  actions: [
    ...texts.map((text) => ({ type: "evidence" as const, text })),
    { type: "exit", code: 0 },
  ],
});

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

function interruptedFirstCutover(): PonderDeployState {
  return preCutoverState({
    phase: "first_cutover_interrupted",
    pending: slotRef("blue", schema, sha, "execB"),
    rollback_model: "keep_previous",
    legacy_schema: otherSchema,
    legacy_image: "sha256:legacy",
  });
}

function interruptedObs(
  over: Partial<PonderDeployObservations> = {},
): PonderDeployObservations {
  return baseObs({
    ready: { blue: status(200), green: noAnswer, nginx: noAnswer },
    executableDigest: "execB",
    kargainHasBaseTables: false,
    kargainViewsTarget: schema,
    ...over,
  });
}

/** Post-cutover, first-cutover deployment live, legacy schema still present. */
function firstCutoverLive(
  over: Partial<PonderDeployState> = {},
): PonderDeployState {
  return postCutoverState({
    live: slotRef("blue", schema, sha, "execA"),
    previous: null,
    legacy_schema: otherSchema,
    legacy_image: "sha256:legacy",
    ...over,
  });
}

function rollbackObs(
  over: Partial<PonderDeployObservations> = {},
): PonderDeployObservations {
  return baseObs({
    ready: { blue: status(200), green: noAnswer, nginx: status(200) },
    schemas: [otherSchema, schema],
    storedExecutable: "execA",
    executableDigest: "execA",
    kargainHasBaseTables: false,
    kargainViewsTarget: schema,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// R1 — interrupted first cutover
// ---------------------------------------------------------------------------

const r1Resume: PlanControl = {
  id: "R1-resume",
  title:
    "interrupted first cutover: deploy resumes the HTTP half (upstream → nginx → 200 → state), never the DB half",
  run(plan) {
    const result = plan({
      state: interruptedFirstCutover(),
      operation: "deploy",
      deploySha: sha,
      observations: interruptedObs(),
    });
    const a = result.actions;
    for (const t of [
      "switch_views",
      "stop_legacy_writer",
      "start_slot",
      "build_slot",
    ] as const) {
      assert.ok(
        !a.some((x) => x.type === t),
        `interrupted first cutover must not redo the DB half: found ${t}`,
      );
    }
    assertOrder(
      a,
      [
        [
          "write_upstream blue",
          (x) => x.type === "write_upstream" && x.slot === "blue",
        ],
        ["up_nginx", (x) => x.type === "up_nginx"],
        [
          "wait_ready200 nginx",
          (x) => x.type === "wait_ready200" && x.target === "nginx",
        ],
        [
          "write_state live=pending",
          (x) =>
            x.type === "write_state" &&
            x.state.phase === "post_cutover" &&
            x.state.live?.schema === schema &&
            x.state.pending === null,
        ],
      ],
      "interrupted first cutover must resume the HTTP half",
    );
    assert.equal(exitCode(a), 0, "resume must exit 0");
  },
  planted: [
    {
      name: "pre-R1: refuses as deploy_state_invalid phase_mismatch",
      planner: replacing(() => ({
        actions: [
          {
            type: "evidence",
            text: "deploy_state_invalid: phase_mismatch: kargain has no base tables but state.live is null",
          },
          { type: "exit", code: 1 },
        ],
      })),
      expect: /interrupted first cutover must resume the HTTP half: missing step write_upstream blue/,
    },
    {
      name: "redoes the views switch",
      planner: mutated((a) => [
        {
          type: "switch_views",
          targetSchema: schema,
          kind: "first_cutover",
          renameLiveTo: otherSchema,
        },
        ...a,
      ]),
      expect: /must not redo the DB half: found switch_views/,
    },
    {
      name: "skips up_nginx",
      planner: mutated((a) => a.filter((x) => x.type !== "up_nginx")),
      expect: /interrupted first cutover must resume the HTTP half: missing step up_nginx/,
    },
  ],
};

const r1Rollback: PlanControl = {
  id: "R1-rollback",
  title:
    "interrupted first cutover: rollback takes first_cutover_rollback (stop new writer, restore legacy views)",
  run(plan) {
    const result = plan({
      state: interruptedFirstCutover(),
      operation: "rollback",
      deploySha: sha,
      observations: interruptedObs({ schemas: [otherSchema, schema] }),
    });
    const a = result.actions;
    assertOrder(
      a,
      [
        ["stop_slot blue", (x) => x.type === "stop_slot" && x.slot === "blue"],
        [
          "switch_views first_cutover_rollback",
          (x) =>
            x.type === "switch_views" &&
            x.kind === "first_cutover_rollback" &&
            x.targetSchema === otherSchema,
        ],
        ["start_legacy_writer", (x) => x.type === "start_legacy_writer"],
      ],
      "interrupted first cutover rollback",
    );
    assert.equal(exitCode(a), 0, "interrupted rollback must exit 0");
  },
  planted: [
    {
      name: "pre-R1: refuses as deploy_state_invalid",
      planner: replacing(() => ({
        actions: [
          {
            type: "evidence",
            text: "deploy_state_invalid: phase_mismatch",
          },
          { type: "exit", code: 1 },
        ],
      })),
      expect: /interrupted first cutover rollback: missing step stop_slot blue/,
    },
    {
      name: "rolls back with a normal switch instead",
      planner: mutated((a) =>
        a.map((x) =>
          x.type === "switch_views" ? { ...x, kind: "normal" as const } : x,
        ),
      ),
      expect: /missing step switch_views first_cutover_rollback/,
    },
  ],
};

// ---------------------------------------------------------------------------
// R2 — the observed kargain writer is the one that is stopped
// ---------------------------------------------------------------------------

function afterFirstCutoverRollbackState(plan: Planner): PonderDeployState {
  const rolledBack = plan({
    state: firstCutoverLive(),
    operation: "rollback",
    deploySha: sha,
    observations: rollbackObs(),
  });
  const state = lastWrittenState(rolledBack.actions);
  assert.ok(state, "first-cutover rollback must write state");
  assert.equal(state.phase, "pre_cutover", "rollback state must be pre_cutover");
  return state;
}

const r2Writer: PlanControl = {
  id: "R2",
  title:
    "rollback → redeploy: stop_legacy_writer names exactly the observed kargain writer (ponder-legacy after a rollback)",
  run(plan) {
    const state = afterFirstCutoverRollbackState(planPonderDeploy);
    const deploy = (writer: "ponder" | "ponder-legacy" | null) =>
      plan({
        state: { ...state, rollback_model: "keep_previous" },
        operation: "deploy",
        deploySha: newerSha,
        observations: baseObs({
          ready: { blue: status(200), green: noAnswer, nginx: status(200) },
          executableDigest: "execC",
          deploySha: newerSha,
          deployCommit: newerSha,
          kargainHasBaseTables: true,
          kargainWriter: writer,
        }),
      }).actions;

    const legacy = deploy("ponder-legacy");
    const stops = legacy.filter((x) => x.type === "stop_legacy_writer");
    assert.equal(stops.length, 1, "exactly one stop_legacy_writer");
    const only = stops[0]!;
    assert.ok(only.type === "stop_legacy_writer");
    assert.equal(
      only.writer,
      "ponder-legacy",
      "stop_legacy_writer must name the observed writer ponder-legacy",
    );
    assertOrder(
      legacy,
      [
        ["stop_legacy_writer", (x) => x.type === "stop_legacy_writer"],
        [
          "switch_views first_cutover",
          (x) => x.type === "switch_views" && x.kind === "first_cutover",
        ],
      ],
      "writer is stopped before the views switch",
    );

    const plain = deploy("ponder").find((x) => x.type === "stop_legacy_writer");
    assert.ok(
      plain && plain.type === "stop_legacy_writer" && plain.writer === "ponder",
      "stop_legacy_writer must name the observed writer ponder",
    );

    const none = deploy(null);
    assert.ok(
      !none.some((x) => x.type === "stop_legacy_writer"),
      "no observed writer → nothing to stop",
    );
    assert.ok(
      evidenceTexts({ actions: none }).includes(
        "deploy_evidence legacy_writer=none",
      ),
      "no observed writer must be named in evidence",
    );
  },
  planted: [
    {
      name: "always stops the pre-#71 service `ponder`",
      planner: mutated((a) =>
        a.map((x) =>
          x.type === "stop_legacy_writer"
            ? { ...x, writer: "ponder" as const }
            : x,
        ),
      ),
      expect: /stop_legacy_writer must name the observed writer ponder-legacy/,
    },
    {
      name: "forgets to stop any writer",
      planner: mutated((a) => a.filter((x) => x.type !== "stop_legacy_writer")),
      expect: /exactly one stop_legacy_writer/,
    },
  ],
};

// ---------------------------------------------------------------------------
// R3 / R5 — first-cutover rollback: legacy gates before the upstream flip
// ---------------------------------------------------------------------------

function firstCutoverRollbackActions(plan: Planner): PlanAction[] {
  return plan({
    state: firstCutoverLive(),
    operation: "rollback",
    deploySha: sha,
    observations: rollbackObs(),
  }).actions;
}

const r3Gates: PlanControl = {
  id: "R3",
  title:
    "first-cutover rollback waits answered then ready200 on ponder-legacy BEFORE the upstream flip; timeout is deploy_rollback_failed: waited Ns",
  run(plan) {
    const a = firstCutoverRollbackActions(plan);
    assertOrder(
      a,
      [
        [
          "start_legacy_writer",
          (x) => x.type === "start_legacy_writer",
        ],
        [
          "wait_answered legacy",
          (x) => x.type === "wait_answered" && x.target === "legacy",
        ],
        [
          "wait_ready200 legacy",
          (x) => x.type === "wait_ready200" && x.target === "legacy",
        ],
        [
          "write_upstream legacy",
          (x) => x.type === "write_upstream" && x.slot === "legacy",
        ],
        ["reload_nginx", (x) => x.type === "reload_nginx"],
      ],
      "legacy readiness gates precede the upstream flip",
    );
    for (const x of a) {
      if (
        (x.type === "wait_answered" || x.type === "wait_ready200") &&
        x.target === "legacy"
      ) {
        assert.equal(x.onTimeout, "fail", "legacy gate timeout must fail the run");
        assert.match(
          x.failEvidence ?? "",
          /^deploy_rollback_failed: waited \d+s$/,
          "legacy gate timeout evidence",
        );
      }
    }
  },
  planted: [
    {
      name: "no ready200 gate on ponder-legacy",
      planner: mutated((a) =>
        a.filter((x) => !(x.type === "wait_ready200" && x.target === "legacy")),
      ),
      expect: /missing step wait_ready200 legacy/,
    },
    {
      name: "no gates at all (flip immediately)",
      planner: mutated((a) =>
        a.filter(
          (x) =>
            !(
              (x.type === "wait_answered" || x.type === "wait_ready200") &&
              x.target === "legacy"
            ),
        ),
      ),
      expect: /missing step wait_answered legacy/,
    },
    {
      name: "upstream flipped before the gates",
      planner: mutated((a) => {
        const flip = a.filter(
          (x) =>
            (x.type === "write_upstream" && x.slot === "legacy") ||
            x.type === "reload_nginx",
        );
        const rest = a.filter((x) => !flip.includes(x));
        const at = rest.findIndex((x) => x.type === "start_legacy_writer");
        return [...rest.slice(0, at + 1), ...flip, ...rest.slice(at + 1)];
      }),
      expect: /wait_answered legacy must come after reload_nginx|write_upstream legacy must come after wait_ready200 legacy|wait_answered legacy must come after/,
    },
    {
      name: "gate timeout reports the wrong refusal",
      planner: mutated((a) =>
        a.map((x) =>
          x.type === "wait_ready200" && x.target === "legacy"
            ? { ...x, failEvidence: "ponder_did_not_become_ready" }
            : x,
        ),
      ),
      expect: /legacy gate timeout evidence/,
    },
  ],
};

const rollbackSequence: PlanControl = {
  id: "first-cutover-rollback-sequence",
  title:
    "first-cutover rollback sequence: stop new writer → restore views → record pre_cutover → legacy writer from state.legacy_image → gates → upstream",
  run(plan) {
    const a = firstCutoverRollbackActions(plan);
    assertOrder(
      a,
      [
        ["stop_slot blue", (x) => x.type === "stop_slot" && x.slot === "blue"],
        [
          "switch_views first_cutover_rollback",
          (x) =>
            x.type === "switch_views" &&
            x.kind === "first_cutover_rollback" &&
            x.targetSchema === otherSchema,
        ],
        [
          "write_state pre_cutover",
          (x) =>
            x.type === "write_state" &&
            x.state.phase === "pre_cutover" &&
            x.state.live === null,
        ],
        ["start_legacy_writer", (x) => x.type === "start_legacy_writer"],
        ["wait_ready200 legacy", (x) => x.type === "wait_ready200" && x.target === "legacy"],
        ["write_upstream legacy", (x) => x.type === "write_upstream" && x.slot === "legacy"],
        ["reload_nginx", (x) => x.type === "reload_nginx"],
      ],
      "first-cutover rollback sequence",
    );
    const start = a.find((x) => x.type === "start_legacy_writer");
    assert.ok(start && start.type === "start_legacy_writer");
    assert.equal(
      start.image,
      "sha256:legacy",
      "start_legacy_writer must carry state.legacy_image (the tag is verified against it)",
    );
    const state = lastWrittenState(a);
    assert.ok(state);
    assert.equal(state.legacy_schema, otherSchema, "rollback keeps legacy_schema");
    assert.equal(state.legacy_image, "sha256:legacy", "rollback keeps legacy_image");
    assert.equal(state.live, null);
    assert.equal(state.pending, null);
    assert.equal(exitCode(a), 0);
  },
  planted: [
    {
      name: "state written only after the legacy writer is up",
      planner: mutated((a) => {
        const w = a.find((x) => x.type === "write_state")!;
        const rest = a.filter((x) => x !== w);
        const at = rest.findIndex((x) => x.type === "reload_nginx");
        return [...rest.slice(0, at + 1), w, ...rest.slice(at + 1)];
      }),
      expect: /start_legacy_writer must come after write_state pre_cutover/,
    },
    {
      name: "legacy writer started without the recorded image",
      planner: mutated((a) =>
        a.map((x) =>
          x.type === "start_legacy_writer" ? { ...x, image: "" } : x,
        ),
      ),
      expect: /start_legacy_writer must carry state.legacy_image/,
    },
    {
      name: "legacy_* dropped from the rollback state",
      planner: mutated((a) =>
        a.map((x) =>
          x.type === "write_state"
            ? {
                ...x,
                state: { ...x.state, legacy_schema: null, legacy_image: null },
              }
            : x,
        ),
      ),
      expect: /rollback keeps legacy_schema/,
    },
  ],
};

// ---------------------------------------------------------------------------
// R4 — first-cutover rollback only while the legacy spare is valid; a switch clears it
// ---------------------------------------------------------------------------

const r4Gate: PlanControl = {
  id: "R4-gate",
  title:
    "first-cutover rollback requires legacy_schema ∈ observations.schemas; otherwise deploy_rollback_failed: no previous spare",
  run(plan) {
    const refuses = (
      state: PonderDeployState,
      schemas: string[],
      why: string,
    ) => {
      const result = plan({
        state,
        operation: "rollback",
        deploySha: sha,
        observations: rollbackObs({ schemas }),
      });
      assert.ok(
        evidenceTexts(result).includes("deploy_rollback_failed: no previous spare"),
        `${why}: must refuse with no previous spare`,
      );
      assert.ok(
        !result.actions.some((x) => x.type === "switch_views"),
        `${why}: must not switch views`,
      );
      assert.equal(exitCode(result.actions), 1, `${why}: must exit 1`);
    };
    // legacy_schema recorded but its schema is gone (retention dropped it)
    refuses(firstCutoverLive(), [schema], "legacy schema absent from observations");
    // no legacy_schema at all
    refuses(
      firstCutoverLive({ legacy_schema: null, legacy_image: null }),
      [otherSchema, schema],
      "legacy_schema null",
    );
    // valid → first_cutover_rollback
    const ok = plan({
      state: firstCutoverLive(),
      operation: "rollback",
      deploySha: sha,
      observations: rollbackObs(),
    });
    assert.ok(
      ok.actions.some(
        (x) => x.type === "switch_views" && x.kind === "first_cutover_rollback",
      ),
      "valid legacy spare must take first_cutover_rollback",
    );
  },
  planted: [
    {
      name: "ignores whether legacy_schema still exists",
      planner: observing((o) => ({ ...o, schemas: [...o.schemas, otherSchema] })),
      expect: /legacy schema absent from observations: must refuse with no previous spare/,
    },
    {
      name: "always rolls back to legacy when legacy_schema is set",
      planner: replacing((args) =>
        args.operation === "rollback" && args.state.legacy_schema === null
          ? planPonderDeploy({
              ...args,
              state: { ...args.state, legacy_schema: otherSchema, legacy_image: "sha256:legacy" },
              observations: {
                ...args.observations,
                schemas: [...args.observations.schemas, otherSchema],
              },
            })
          : null,
      ),
      expect: /legacy_schema null: must refuse with no previous spare/,
    },
  ],
};

function switchAwayFromFirstCutover(plan: Planner): PlanAction[] {
  return plan({
    state: firstCutoverLive({
      pending: slotRef("green", newerSchema, newerSha, "execB"),
    }),
    operation: "deploy",
    deploySha: newerSha,
    observations: baseObs({
      ready: { blue: status(200), green: status(200), nginx: status(200) },
      schemas: [otherSchema, schema, newerSchema, oldSchema],
      storedExecutable: "execA",
      executableDigest: "execB",
      deploySha: newerSha,
      deployCommit: newerSha,
      kargainHasBaseTables: false,
      kargainViewsTarget: schema,
    }),
  }).actions;
}

const r4Clear: PlanControl = {
  id: "R4-clear",
  title:
    "a switch away from the first-cutover deployment clears legacy_schema + legacy_image and removes the preserved image tag",
  run(plan) {
    const a = switchAwayFromFirstCutover(plan);
    const state = lastWrittenState(a);
    assert.ok(state, "switch must write state");
    assert.equal(state.live?.schema, newerSchema, "switch makes pending live");
    assert.equal(
      state.legacy_schema,
      null,
      "switch clears legacy_schema and legacy_image",
    );
    assert.equal(state.legacy_image, null, "switch clears legacy_image");
    assertOrder(
      a,
      [
        [
          "write_state (legacy cleared)",
          (x) => x.type === "write_state" && x.state.legacy_schema === null,
        ],
        ["remove_legacy_image_tag", (x) => x.type === "remove_legacy_image_tag"],
      ],
      "the preserved image tag is removed with the switch",
    );
    const retention = a.find((x) => x.type === "retention");
    assert.ok(
      retention &&
        retention.type === "retention" &&
        retention.drop.includes(otherSchema),
      "once cleared, the legacy schema is retention-droppable",
    );
  },
  planted: [
    {
      name: "legacy_* survive the switch",
      planner: mutated((a) =>
        a.map((x) =>
          x.type === "write_state"
            ? {
                ...x,
                state: {
                  ...x.state,
                  legacy_schema: otherSchema,
                  legacy_image: "sha256:legacy",
                },
              }
            : x,
        ),
      ),
      expect: /switch clears legacy_schema and legacy_image/,
    },
    {
      name: "preserved image tag is never removed",
      planner: mutated((a) => a.filter((x) => x.type !== "remove_legacy_image_tag")),
      expect: /missing step remove_legacy_image_tag/,
    },
  ],
};

// ---------------------------------------------------------------------------
// R6 / R7 — pending precedence in both phases
// ---------------------------------------------------------------------------

type Phase = "pre_cutover" | "post_cutover";

function stalePending(phase: Phase): { state: PonderDeployState; pendingSlot: "blue" | "green" } {
  if (phase === "pre_cutover") {
    return {
      pendingSlot: "blue",
      state: preCutoverState({
        pending: slotRef("blue", schema, sha, "execB"),
        legacy_schema: otherSchema,
        legacy_image: "sha256:legacy",
        rollback_model: null,
      }),
    };
  }
  return {
    pendingSlot: "green",
    state: firstCutoverLive({
      pending: slotRef("green", schema, sha, "execB"),
      live: slotRef("blue", oldSchema, otherSha, "execA"),
      rollback_model: null,
    }),
  };
}

function pendingObs(
  phase: Phase,
  probe: ProbeObservation,
  executableDigest: string,
): PonderDeployObservations {
  const pre = phase === "pre_cutover";
  return baseObs({
    ready: {
      blue: pre ? probe : status(200),
      green: pre ? noAnswer : probe,
      nginx: pre ? noAnswer : status(200),
    },
    schemas: [otherSchema, schema, oldSchema],
    storedExecutable: pre ? "" : "execA",
    executableDigest,
    deploySha: newerSha,
    deployCommit: newerSha,
    kargainHasBaseTables: pre,
    kargainViewsTarget: pre ? null : oldSchema,
  });
}

function supersedeControl(phase: Phase, id: string, title: string): PlanControl {
  return {
    id,
    title,
    run(plan) {
      for (const operation of ["hold", "deploy"] as const) {
        const { state, pendingSlot } = stalePending(phase);
        const result = plan({
          state,
          operation,
          deploySha: newerSha,
          observations: pendingObs(phase, status(503), "execC"),
        });
        const ctx = `${phase} ${operation}: incoming executable differs, pending not ready`;
        const pendingSchema = state.pending!.schema;
        assertOrder(
          result.actions,
          [
            [
              `stop_slot ${pendingSlot}`,
              (x) => x.type === "stop_slot" && x.slot === pendingSlot,
            ],
            [
              "write_state pending=null",
              (x) => x.type === "write_state" && x.state.pending === null,
            ],
            [
              `drop_schema ${pendingSchema}`,
              (x) => x.type === "drop_schema" && x.schema === pendingSchema,
            ],
            [
              "start_slot (incoming commit)",
              (x) => x.type === "start_slot",
            ],
            [
              "write_state pending=incoming",
              (x) =>
                x.type === "write_state" &&
                x.state.pending?.schema === newerSchema &&
                x.state.pending.executable === "execC",
            ],
          ],
          `${ctx}: must supersede and start the incoming commit`,
        );
      }
    },
    planted: [
      {
        name: "keeps the stale pending and exits (pre-R6 hold/deploy)",
        planner: replacing((args) =>
          args.state.pending
            ? evidenceOnly(
                `deploy_evidence switch=pending schema=${args.state.pending.schema}`,
              )
            : null,
        ),
        expect: /must supersede and start the incoming commit: missing step stop_slot/,
      },
      {
        name: "supersedes only for deploy, not hold",
        planner: replacing((args) =>
          args.state.pending && args.operation === "hold"
            ? evidenceOnly(
                `deploy_evidence switch=pending schema=${args.state.pending.schema}`,
              )
            : null,
        ),
        expect: /hold: incoming executable differs, pending not ready: must supersede/,
      },
      {
        name: "supersedes only for hold, not deploy",
        planner: replacing((args) =>
          args.state.pending && args.operation === "deploy"
            ? evidenceOnly(
                `deploy_evidence switch=pending schema=${args.state.pending.schema}`,
              )
            : null,
        ),
        expect: new RegExp(
          `${phase} deploy: incoming executable differs, pending not ready: must supersede`,
        ),
      },
      {
        name: `does not supersede in ${phase}`,
        planner: replacing((args) =>
          args.state.pending && args.state.phase === phase
            ? evidenceOnly(
                `deploy_evidence switch=pending schema=${args.state.pending.schema}`,
              )
            : null,
        ),
        expect: new RegExp(
          `${phase} (hold|deploy): incoming executable differs, pending not ready: must supersede`,
        ),
      },
      {
        name: "drops the pending schema without starting the incoming commit",
        planner: mutated((a) => a.filter((x) => x.type !== "start_slot")),
        expect: /missing step start_slot \(incoming commit\)/,
      },
    ],
  };
}

const r6PostSupersede = supersedeControl(
  "post_cutover",
  "R6-post",
  "post-cutover: a not-ready pending with a different incoming executable is superseded (hold and deploy; no rollback_model gate)",
);
const r6PreSupersede = supersedeControl(
  "pre_cutover",
  "R6-pre-stale",
  "stale pre-cutover pending: a not-ready pending with a different incoming executable is superseded (hold and deploy)",
);

const r6Reassert: PlanControl = {
  id: "R6-reassert",
  title:
    "a not-ready pending with the SAME incoming executable is re-asserted, not superseded (both phases)",
  run(plan) {
    for (const phase of ["pre_cutover", "post_cutover"] as const) {
      for (const operation of ["hold", "deploy"] as const) {
        const { state } = stalePending(phase);
        const result = plan({
          state,
          operation,
          deploySha: sha,
          observations: pendingObs(phase, status(503), "execB"),
        });
        const ctx = `${phase} ${operation}: equal executable`;
        for (const t of ["stop_slot", "drop_schema", "start_slot", "build_slot"] as const) {
          assert.ok(
            !result.actions.some((x) => x.type === t),
            `${ctx}: must not ${t}`,
          );
        }
        assert.ok(
          evidenceTexts(result).includes(
            `deploy_evidence switch=pending schema=${state.pending!.schema}`,
          ),
          `${ctx}: must re-assert switch=pending`,
        );
        assert.equal(exitCode(result.actions), 0, `${ctx}: must exit 0`);
      }
    }
  },
  planted: [
    {
      name: "supersedes even when the executable is equal",
      planner: mutated((a) => [
        { type: "drop_schema", schema },
        ...a,
      ]),
      expect: /equal executable: must not drop_schema/,
    },
  ],
};

const r7NoTeardown: PlanControl = {
  id: "R7",
  title:
    "an existing pending is never torn down: reported with its probe kind; teardown only for a slot started this run",
  run(plan) {
    for (const phase of ["pre_cutover", "post_cutover"] as const) {
      for (const [probe, kind] of [
        [noAnswer, "deploy_evidence pending_probe=no_answer"],
        [status(503), "deploy_evidence pending_probe=status code=503"],
      ] as const) {
        const { state } = stalePending(phase);
        const result = plan({
          state,
          operation: "deploy",
          deploySha: sha,
          observations: pendingObs(phase, probe, "execB"),
        });
        const ctx = `${phase} existing pending (${probe.kind})`;
        assert.ok(
          !result.actions.some(
            (x) =>
              x.type === "wait_answered" ||
              x.type === "stop_slot" ||
              x.type === "drop_schema",
          ),
          `${ctx}: must not wait on, stop or drop an existing pending`,
        );
        assert.ok(
          evidenceTexts(result).includes(kind),
          `${ctx}: must report the probe kind (${kind})`,
        );
      }
    }
    // A slot started this run is the only teardown target.
    const started = plan({
      state: postCutoverState(),
      operation: "deploy",
      deploySha: newerSha,
      observations: baseObs({
        ready: { blue: status(200), green: noAnswer, nginx: status(200) },
        storedExecutable: "exec0",
        executableDigest: "execC",
        deploySha: newerSha,
        deployCommit: newerSha,
        kargainHasBaseTables: false,
      }),
    });
    const wait = started.actions.find((x) => x.type === "wait_answered");
    assert.ok(
      wait && wait.type === "wait_answered",
      "a slot started this run must be waited on",
    );
    assert.equal(
      wait.onTimeout,
      "tear_down_new",
      "teardown only for the slot started this run",
    );
    assert.equal(wait.slot, "green");
  },
  planted: [
    {
      name: "tears down the existing pending on timeout",
      planner: mutated((a) => [
        {
          type: "wait_answered",
          target: "slot",
          slot: "green",
          timeoutMs: 90_000,
          onTimeout: "tear_down_new",
        },
        ...a,
      ]),
      expect: /must not wait on, stop or drop an existing pending/,
    },
    {
      name: "does not report the observed probe",
      planner: mutated((a) =>
        a.filter(
          (x) => !(x.type === "evidence" && x.text.includes("pending_probe=")),
        ),
      ),
      expect: /must report the probe kind/,
    },
    {
      name: "a slot started this run is not torn down on timeout",
      planner: mutated((a) =>
        a.map((x) =>
          x.type === "wait_answered" ? { ...x, onTimeout: "fail" as const } : x,
        ),
      ),
      expect: /teardown only for the slot started this run/,
    },
  ],
};

// ---------------------------------------------------------------------------
// B9 + changed executable — nginx digest drift must not swallow the deploy
// ---------------------------------------------------------------------------

const nginxDriftWithNewExecutable: PlanControl = {
  id: "nginx-drift-with-new-executable",
  title:
    "nginx digest drift WITH a changed executable: recreate the proxy once and continue into the start path; every state write carries the new digest",
  run(plan) {
    const result = plan({
      state: postCutoverState({
        live: slotRef("blue", schema, sha, "execA"),
        legacy_schema: null,
        legacy_image: null,
        nginx_config_digest: "nginx0",
      }),
      operation: "deploy",
      deploySha: newerSha,
      observations: baseObs({
        ready: { blue: status(200), green: noAnswer, nginx: status(200) },
        schemas: [schema],
        storedExecutable: "execA",
        executableDigest: "execC",
        deploySha: newerSha,
        deployCommit: newerSha,
        nginxConfigDigest: "nginx1",
        kargainHasBaseTables: false,
        kargainViewsTarget: schema,
      }),
    });
    const a = result.actions;
    assert.equal(
      a.filter((x) => x.type === "recreate_nginx").length,
      1,
      "recreate_nginx exactly once",
    );
    assertOrder(
      a,
      [
        ["recreate_nginx", (x) => x.type === "recreate_nginx"],
        ["build_slot", (x) => x.type === "build_slot"],
        ["start_slot", (x) => x.type === "start_slot"],
      ],
      "drift + changed executable continues into the start path",
    );
    assert.ok(
      evidenceTexts(result).includes("deploy_evidence proxy=recreated"),
      "proxy=recreated evidence",
    );
    const states = writtenStates(a);
    assert.ok(states.length > 0, "the start path writes state");
    for (const s of states) {
      assert.equal(
        s.nginx_config_digest,
        "nginx1",
        "every state write after the recreate carries the new nginx digest",
      );
    }
  },
  planted: [
    {
      name: "proxy-only: executable change ignored",
      planner: mutated((a) =>
        a.filter(
          (x) =>
            !["write_slot_env", "build_slot", "preflight_slot", "start_slot"].includes(
              x.type,
            ),
        ),
      ),
      expect: /missing step build_slot/,
    },
    {
      name: "stale nginx digest recorded",
      planner: mutated((a) =>
        a.map((x) =>
          x.type === "write_state"
            ? { ...x, state: { ...x.state, nginx_config_digest: "nginx0" } }
            : x,
        ),
      ),
      expect: /carries the new nginx digest/,
    },
    {
      name: "proxy never recreated",
      planner: mutated((a) => a.filter((x) => x.type !== "recreate_nginx")),
      expect: /recreate_nginx exactly once/,
    },
  ],
};

// ---------------------------------------------------------------------------
// R9 / R12 — the executor reads its keep set from the state file at execution
// ---------------------------------------------------------------------------

/** Drops never touch the keep set of the state file as last written before them. */
function assertDropsOutsideKeepSet(
  initial: PonderDeployState,
  actions: PlanAction[],
  ctx: string,
): void {
  let written = initial;
  for (const a of actions) {
    if (a.type === "write_state") {
      written = a.state;
      continue;
    }
    if (a.type !== "drop_schema" && a.type !== "retention") continue;
    const keep = keepSetFromState(written);
    const kept = new Set(
      [keep.live, keep.previous, keep.pending, keep.legacy].filter(
        (x): x is string => x !== null,
      ),
    );
    const drops = a.type === "drop_schema" ? [a.schema] : [...a.drop];
    for (const d of drops) {
      assert.ok(
        !kept.has(d),
        `${ctx}: ${a.type} drops ${d}, which the state file written before it still keeps`,
      );
    }
  }
}

/** Move each retention / drop_schema to just before the nearest preceding write_state. */
function dropsBeforeStateWrite(actions: PlanAction[]): PlanAction[] {
  const out = [...actions];
  for (let j = 0; j < out.length; j++) {
    const a = out[j]!;
    if (a.type !== "retention" && a.type !== "drop_schema") continue;
    let i = j - 1;
    while (i >= 0 && out[i]!.type !== "write_state") i--;
    if (i < 0) continue;
    out.splice(j, 1);
    out.splice(i, 0, a);
  }
  return out;
}

const keepSetOrdering: PlanControl = {
  id: "R9-keep-set-order",
  title:
    "every retention/drop_schema runs after the write_state that releases its schema (executor keep set = state file at execution)",
  run(plan) {
    // supersede
    {
      const { state } = stalePending("post_cutover");
      const result = plan({
        state,
        operation: "deploy",
        deploySha: newerSha,
        observations: pendingObs("post_cutover", status(503), "execC"),
      });
      assertDropsOutsideKeepSet(state, result.actions, "supersede");
    }
    // switch away from the first-cutover deployment (legacy released)
    {
      const state = firstCutoverLive({
        pending: slotRef("green", newerSchema, newerSha, "execB"),
      });
      assertDropsOutsideKeepSet(
        state,
        switchAwayFromFirstCutover(plan),
        "switch away from first cutover",
      );
    }
    // first cutover with a ready pending
    {
      const state = preCutoverState({
        pending: slotRef("blue", schema, sha, "execB"),
        legacy_schema: otherSchema,
        legacy_image: "sha256:legacy",
        rollback_model: "keep_previous",
      });
      const result = plan({
        state,
        operation: "deploy",
        deploySha: sha,
        observations: baseObs({
          ready: { blue: status(200), green: noAnswer, nginx: noAnswer },
          schemas: [oldSchema, otherSchema],
          executableDigest: "execB",
          kargainHasBaseTables: true,
        }),
      });
      assert.ok(
        result.actions.some((x) => x.type === "retention"),
        "first cutover must run retention (negative control for an empty set)",
      );
      assertDropsOutsideKeepSet(state, result.actions, "first cutover");
    }
    // first-cutover rollback
    {
      const state = firstCutoverLive();
      assertDropsOutsideKeepSet(
        state,
        plan({
          state,
          operation: "rollback",
          deploySha: sha,
          observations: rollbackObs({ schemas: [otherSchema, schema, oldSchema] }),
        }).actions,
        "first-cutover rollback",
      );
    }
    // keep_previous rollback
    {
      const state = postCutoverState({
        live: slotRef("green", schema, sha, "execNew"),
        previous: slotRef("blue", otherSchema, otherSha, "execOld"),
        legacy_schema: null,
        legacy_image: null,
      });
      assertDropsOutsideKeepSet(
        state,
        plan({
          state,
          operation: "rollback",
          deploySha: sha,
          observations: baseObs({
            ready: { blue: status(200), green: status(200), nginx: status(200) },
            schemas: [oldSchema, otherSchema, schema],
            storedExecutable: "execNew",
            executableDigest: "execNew",
            kargainHasBaseTables: false,
          }),
        }).actions,
        "keep_previous rollback",
      );
    }
  },
  planted: [
    {
      name: "retention / drop_schema ordered before the state write",
      planner: mutated(dropsBeforeStateWrite),
      expect: /drops k_[0-9a-f]{40}, which the state file written before it still keeps/,
    },
  ],
};

const r12LegacyKept: PlanControl = {
  id: "R12",
  title:
    "while a first-cutover rollback is valid, nothing drops legacy_schema and every state write keeps it",
  run(plan) {
    const { state } = stalePending("post_cutover");
    const result = plan({
      state,
      operation: "deploy",
      deploySha: newerSha,
      observations: pendingObs("post_cutover", status(503), "execC"),
    });
    for (const a of result.actions) {
      if (a.type === "drop_schema") {
        assert.notEqual(a.schema, otherSchema, "drop_schema must not drop legacy_schema");
      }
      if (a.type === "retention") {
        assert.ok(
          !a.drop.includes(otherSchema),
          "retention must not drop legacy_schema",
        );
      }
    }
    for (const s of writtenStates(result.actions)) {
      assert.equal(
        s.legacy_schema,
        otherSchema,
        "every state write keeps legacy_schema while the rollback is valid",
      );
    }
    assert.ok(writtenStates(result.actions).length > 0, "states were written");
  },
  planted: [
    {
      name: "retention drops legacy_schema",
      planner: mutated((a) => [...a, { type: "retention", drop: [otherSchema] }]),
      expect: /retention must not drop legacy_schema/,
    },
    {
      name: "state write forgets legacy_schema",
      planner: mutated((a) =>
        a.map((x) =>
          x.type === "write_state"
            ? { ...x, state: { ...x.state, legacy_schema: null } }
            : x,
        ),
      ),
      expect: /every state write keeps legacy_schema/,
    },
  ],
};

export const PLAN_CONTROLS: readonly PlanControl[] = [
  r1Resume,
  r1Rollback,
  r2Writer,
  r3Gates,
  rollbackSequence,
  r4Gate,
  r4Clear,
  r6PostSupersede,
  r6PreSupersede,
  r6Reassert,
  r7NoTeardown,
  nginxDriftWithNewExecutable,
  keepSetOrdering,
  r12LegacyKept,
];
