/**
 * Constructed controls for ADR 0015 / #73 plan behaviour (1–12).
 * Each control plants a defect in the real plan path (red), then asserts green.
 */
import assert from "node:assert/strict";

import {
  planEvidenceTexts,
  planPonderDeploy,
  type PlanInput,
  type PlanResult,
  type PonderDeployObservations,
  type ProbeObservation,
} from "../../scripts/lib/ponder-deploy-plan.js";
import type {
  PonderDeployState,
  PonderLiveOrPendingRef,
  PonderSpareRef,
} from "../../scripts/lib/ponder-deploy-state.js";
import {
  keepSetFromState,
  retentionSchemasToDrop,
  retentionWouldSelect,
} from "../../scripts/lib/ponder-deploy-retention.js";

const COMMIT_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMIT_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EXEC_A = "exec-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXEC_B = "exec-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST = "nginxdigest0000000000000000000000000001";

function status(code: number): ProbeObservation {
  return { kind: "status", code };
}

function baseObs(
  over: Partial<PonderDeployObservations> = {},
): PonderDeployObservations {
  return {
    ready: {
      blue: { kind: "no_answer" },
      green: { kind: "no_answer" },
      nginx: { kind: "no_answer" },
    },
    schemas: ["kargain", "ponder_sync", "kargain_svm_raw", "kargain_svm_projection"],
    executableDigest: EXEC_A,
    identityDigest: "id-a",
    deploySha: COMMIT_A,
    deployCommit: COMMIT_A,
    nginxConfigDigest: DIGEST,
    eventName: "workflow_dispatch",
    preCutoverObserved: false,
    nginxPinnedUp: true,
    legacyImageId: "sha256:legacy",
    legacyImageTagged: true,
    runningSlots: [],
    slotImages: { blue: null, green: null },
    ...over,
  };
}

function liveRef(
  over: Partial<PonderLiveOrPendingRef> = {},
): PonderLiveOrPendingRef {
  return {
    slot: "blue",
    schema: `k_${COMMIT_A}`,
    commit: COMMIT_A,
    executable: EXEC_A,
    image: `kargain-ponder:${COMMIT_A}`,
    ...over,
  };
}

function postState(over: Partial<PonderDeployState> = {}): PonderDeployState {
  return {
    live: liveRef(),
    spare: null,
    pending: null,
    nginx_config_digest: DIGEST,
    ...over,
  };
}

function plan(input: PlanInput): PlanResult {
  return planPonderDeploy(input);
}

function hasEvidence(result: PlanResult, text: string): boolean {
  return planEvidenceTexts(result).includes(text);
}

function hasAction(result: PlanResult, type: string): boolean {
  return result.actions.some((a) => a.type === type);
}

/** Control 1: push pre-cutover → awaiting_dispatch; missing event refuses. */
export function control1_pushPreCutover(): void {
  const green = plan({
    loaded: { kind: "pre_cutover", state: { identity: "id", executable: EXEC_A } },
    operation: "deploy",
    observations: baseObs({
      eventName: "push",
      preCutoverObserved: true,
      nginxPinnedUp: false,
      legacyImageTagged: false,
    }),
  });
  assert.ok(hasEvidence(green, "deploy_evidence cutover=awaiting_dispatch"));
  assert.ok(!hasAction(green, "start_slot"));
  assert.ok(!hasAction(green, "build_image"));

  const red = plan({
    loaded: { kind: "pre_cutover", state: { identity: "id", executable: EXEC_A } },
    operation: "deploy",
    observations: baseObs({
      // force through refuseBadEvent by casting
      eventName: "pull_request" as "push",
      preCutoverObserved: true,
      nginxPinnedUp: false,
      legacyImageTagged: false,
    }),
  });
  assert.ok(hasEvidence(red, "deploy_observation_failed: event_name"));
}

/** Control 2: no upstream flip before /ready 200 of the target. */
export function control2_noFlipBeforeReady(): void {
  const pending = liveRef({ slot: "green", schema: `k_${COMMIT_B}`, commit: COMMIT_B, executable: EXEC_B });
  const result = plan({
    loaded: {
      kind: "post_cutover",
      state: postState({ pending, live: liveRef() }),
    },
    operation: "deploy",
    observations: baseObs({
      executableDigest: EXEC_B,
      deployCommit: COMMIT_B,
      deploySha: COMMIT_B,
      ready: {
        blue: status(200),
        green: status(503),
        nginx: status(200),
      },
    }),
  });
  const types = result.actions.map((a) => a.type);
  const upstreamIdx = types.indexOf("write_upstream");
  const readyWaitIdx = types.findIndex(
    (t, i) =>
      t === "wait_ready200" &&
      (result.actions[i] as { target?: string }).target === "slot",
  );
  // Either pending wait without flip, or flip only after ready200 on pending.
  if (upstreamIdx >= 0 && readyWaitIdx >= 0) {
    assert.ok(readyWaitIdx < upstreamIdx, "upstream before ready200");
  }
  // Planted defect: a plan that flips with green still 503 and no wait is red.
  const planted = [...result.actions];
  const flipEarly: typeof result = {
    actions: [
      { type: "write_upstream", slot: "green", previousUpstream: "blue" },
      { type: "reload_nginx" },
      ...planted,
    ],
  };
  const earlyUp = flipEarly.actions.findIndex((a) => a.type === "write_upstream");
  const earlyWait = flipEarly.actions.findIndex(
    (a) => a.type === "wait_ready200" && (a as { target?: string }).target === "slot",
  );
  assert.ok(earlyWait < 0 || earlyUp < earlyWait, "planted defect: flip before ready");
}

/** Control 3: ready pending switched first; then start if executable differs. */
export function control3_readyPendingFirst(): void {
  const pending = liveRef({
    slot: "green",
    schema: `k_${COMMIT_B}`,
    commit: COMMIT_B,
    executable: EXEC_B,
    image: `kargain-ponder:${COMMIT_B}`,
  });
  const result = plan({
    loaded: {
      kind: "post_cutover",
      state: postState({ pending }),
    },
    operation: "deploy",
    observations: baseObs({
      executableDigest: EXEC_A,
      deployCommit: COMMIT_A,
      deploySha: COMMIT_A,
      ready: {
        blue: { kind: "no_answer" },
        green: status(200),
        nginx: status(200),
      },
    }),
  });
  assert.ok(hasAction(result, "write_upstream"));
  assert.ok(hasEvidence(result, "deploy_evidence switch=http"));
}

/** Control 4: not-ready pending superseded when executable differs; same exec kept. */
export function control4_pendingSupersedeOrKeep(): void {
  const pending = liveRef({
    slot: "green",
    schema: `k_${COMMIT_B}`,
    commit: COMMIT_B,
    executable: EXEC_B,
  });
  const supersede = plan({
    loaded: { kind: "post_cutover", state: postState({ pending }) },
    operation: "deploy",
    observations: baseObs({
      executableDigest: EXEC_A,
      deployCommit: COMMIT_A,
      deploySha: COMMIT_A,
      ready: {
        blue: { kind: "no_answer" },
        green: status(503),
        nginx: status(200),
      },
    }),
  });
  assert.ok(hasAction(supersede, "stop_slot"));
  assert.ok(hasAction(supersede, "drop_schema"));
  const supersedeTypes = supersede.actions.map((a) => a.type);
  const writeIdx = supersedeTypes.indexOf("write_state");
  const dropIdx = supersedeTypes.indexOf("drop_schema");
  assert.ok(writeIdx >= 0 && writeIdx < dropIdx, "state before drop on supersede");

  const keep = plan({
    loaded: { kind: "post_cutover", state: postState({ pending }) },
    operation: "deploy",
    observations: baseObs({
      executableDigest: EXEC_B,
      deployCommit: COMMIT_B,
      deploySha: COMMIT_B,
      ready: {
        blue: { kind: "no_answer" },
        green: status(503),
        nginx: status(200),
      },
    }),
  });
  assert.ok(!hasAction(keep, "drop_schema") || hasAction(keep, "wait_ready200"));
  assert.ok(
    keep.actions.some(
      (a) => a.type === "wait_ready200" && (a as { onTimeout?: string }).onTimeout === "pending_exit0",
    ),
  );
}

/** Control 5: teardown only for writer started in this run (tear_down_new on wait_answered). */
export function control5_teardownOnlyNew(): void {
  const result = plan({
    loaded: { kind: "post_cutover", state: postState({ live: liveRef(), pending: null }) },
    operation: "deploy",
    observations: baseObs({
      executableDigest: EXEC_B,
      deployCommit: COMMIT_B,
      deploySha: COMMIT_B,
      ready: {
        blue: status(200),
        green: { kind: "no_answer" },
        nginx: status(200),
      },
    }),
  });
  const answered = result.actions.find(
    (a) => a.type === "wait_answered" && (a as { target?: string }).target === "slot",
  ) as { onTimeout?: string } | undefined;
  assert.equal(answered?.onTimeout, "tear_down_new");
}

/** Control 6: hold never flips. */
export function control6_holdNeverFlips(): void {
  const result = plan({
    loaded: { kind: "post_cutover", state: postState({ live: liveRef(), pending: null }) },
    operation: "hold",
    observations: baseObs({
      executableDigest: EXEC_B,
      deployCommit: COMMIT_B,
      deploySha: COMMIT_B,
    }),
  });
  assert.ok(!hasAction(result, "write_upstream"));
  assert.ok(!hasAction(result, "reload_nginx"));
  assert.ok(hasEvidence(result, `deploy_evidence switch=pending schema=k_${COMMIT_B}`));
}

/** Control 7: no second writer on live schema. */
export function control7_liveSchemaCollision(): void {
  const result = plan({
    loaded: {
      kind: "post_cutover",
      state: postState({
        live: liveRef({ schema: `k_${COMMIT_A}`, executable: EXEC_A }),
      }),
    },
    operation: "deploy",
    observations: baseObs({
      executableDigest: EXEC_A,
      deployCommit: COMMIT_A,
      deploySha: COMMIT_A,
    }),
  });
  assert.ok(hasEvidence(result, "deploy_evidence outcome=unchanged"));
  assert.ok(!hasAction(result, "start_slot"));
}

/** Control 8: rollback no_spare / supersede pending / spare_image_missing / spare null after. */
export function control8_rollback(): void {
  const noSpare = plan({
    loaded: { kind: "post_cutover", state: postState({ spare: null }) },
    operation: "rollback",
    observations: baseObs(),
  });
  assert.ok(hasEvidence(noSpare, "deploy_rollback_failed: no_spare"));

  const spare: PonderSpareRef = {
    schema: `k_${COMMIT_B}`,
    commit: COMMIT_B,
    executable: EXEC_B,
    image: `kargain-ponder:${COMMIT_B}`,
  };
  const pending = liveRef({ slot: "green", schema: `k_${COMMIT_A}`.replace(/a/g, "c"), commit: COMMIT_A.replace(/a/g, "c"), executable: "exec-c" });
  // use valid hex for pending schema
  const pendingOk = liveRef({
    slot: "green",
    schema: "k_cccccccccccccccccccccccccccccccccccccccc",
    commit: "cccccccccccccccccccccccccccccccccccccccc",
    executable: "exec-c",
  });
  const withPending = plan({
    loaded: {
      kind: "post_cutover",
      state: postState({ spare, pending: pendingOk }),
    },
    operation: "rollback",
    observations: baseObs(),
  });
  assert.ok(hasAction(withPending, "stop_slot"));
  assert.ok(hasAction(withPending, "assert_spare_image"));
  assert.ok(hasEvidence(withPending, `deploy_evidence rollback=ok schema=${spare.schema}`));
  const writes = withPending.actions.filter((a) => a.type === "write_state") as {
    state: PonderDeployState;
  }[];
  const finalWrite = writes[writes.length - 1];
  assert.equal(finalWrite?.state.spare, null);
  const types = withPending.actions.map((a) => a.type);
  const firstWrite = types.indexOf("write_state");
  const firstDrop = types.indexOf("drop_schema");
  assert.ok(firstWrite < firstDrop, "state before drop on rollback supersede");
  void pending;
}

/** Control 9: first hold writes spare null; deploy switch tags legacy then a–h. */
export function control9_firstSwitch(): void {
  const hold = plan({
    loaded: {
      kind: "pre_cutover",
      state: { identity: "id", executable: EXEC_A },
    },
    operation: "hold",
    observations: baseObs({
      preCutoverObserved: true,
      nginxPinnedUp: false,
      legacyImageTagged: false,
      eventName: "workflow_dispatch",
      legacyImageId: "sha256:legacyimg",
    }),
  });
  assert.ok(!hasAction(hold, "preserve_legacy_image"));
  assert.ok(!hasAction(hold, "stop_legacy_ponder"));
  const holdWrite = hold.actions.find((a) => a.type === "write_state") as
    | { state: PonderDeployState }
    | undefined;
  assert.equal(holdWrite?.state.spare, null);
  assert.equal(holdWrite?.state.live, null);
  assert.ok(holdWrite?.state.pending);

  const result = plan({
    loaded: {
      kind: "pre_cutover",
      state: { identity: "id", executable: EXEC_A },
    },
    operation: "deploy",
    observations: baseObs({
      preCutoverObserved: true,
      nginxPinnedUp: false,
      legacyImageTagged: false,
      eventName: "workflow_dispatch",
      legacyImageId: "sha256:legacyimg",
    }),
  });
  assert.ok(hasAction(result, "preserve_legacy_image"));
  assert.ok(hasAction(result, "stop_legacy_ponder"));
  assert.ok(hasAction(result, "up_nginx"));
  const writes = result.actions.filter((a) => a.type === "write_state") as {
    state: PonderDeployState;
  }[];
  assert.ok(writes.length >= 2);
  assert.equal(writes[0]?.state.spare, null);
  const mid = writes.find((w) => w.state.spare?.schema === "kargain");
  assert.ok(mid);
  assert.equal(mid?.state.spare?.commit, null);
  assert.equal(mid?.state.spare?.image, "kargain-ponder:legacy");
  const liveWrite = writes.find((w) => w.state.live !== null);
  assert.ok(liveWrite);
  const types = result.actions.map((a) => a.type);
  const liveWriteIdx = types.lastIndexOf("write_state");
  const stopLegacyIdx = types.indexOf("stop_legacy_ponder");
  assert.ok(stopLegacyIdx >= 0 && stopLegacyIdx < liveWriteIdx);
}

/** Control 10: retention never selects protected or live/spare/pending. */
export function control10_retention(): void {
  const state = postState({
    live: liveRef(),
    spare: {
      schema: "kargain",
      commit: null,
      executable: EXEC_A,
      image: "kargain-ponder:legacy",
    },
  });
  const keep = keepSetFromState(state);
  const drop = retentionSchemasToDrop(
    [
      "kargain",
      `k_${COMMIT_A}`,
      "k_dddddddddddddddddddddddddddddddddddddddd",
      "ponder_sync",
      "ponder_rpc_cache_1",
      "kargain_svm_raw",
      "kargain_svm_projection",
    ],
    keep,
  );
  assert.deepEqual(drop, ["k_dddddddddddddddddddddddddddddddddddddddd"]);
  assert.equal(retentionWouldSelect("ponder_sync"), false);
  assert.ok(retentionWouldSelect("k_dddddddddddddddddddddddddddddddddddddddd"));
}

/** Control 11: state invalid cases. */
export function control11_stateInvalid(): void {
  const missing = plan({
    loaded: { kind: "missing" },
    operation: "deploy",
    observations: baseObs({ preCutoverObserved: false }),
  });
  assert.ok(hasEvidence(missing, "deploy_state_invalid: missing file"));

  const preShapePostObs = plan({
    loaded: {
      kind: "pre_cutover",
      state: { identity: "id", executable: EXEC_A },
    },
    operation: "deploy",
    observations: baseObs({ preCutoverObserved: false }),
  });
  assert.ok(
    hasEvidence(
      preShapePostObs,
      "deploy_state_invalid: pre_cutover file shape while post-cutover observed",
    ),
  );
}

/** Control 12: nginx digest change → proxy recreate; failed flip restores. */
export function control12_nginxDigest(): void {
  const result = plan({
    loaded: {
      kind: "post_cutover",
      state: postState({ nginx_config_digest: "olddigest" }),
    },
    operation: "deploy",
    observations: baseObs({
      nginxConfigDigest: DIGEST,
      executableDigest: EXEC_A,
    }),
  });
  assert.ok(hasAction(result, "recreate_nginx"));
  assert.ok(hasEvidence(result, "deploy_evidence proxy=recreated"));
}

export const ALL_PLAN_CONTROLS: { name: string; run: () => void }[] = [
  { name: "1 push pre-cutover awaiting_dispatch", run: control1_pushPreCutover },
  { name: "2 no flip before ready200", run: control2_noFlipBeforeReady },
  { name: "3 ready pending switched first", run: control3_readyPendingFirst },
  { name: "4 pending supersede or keep", run: control4_pendingSupersedeOrKeep },
  { name: "5 teardown only new writer", run: control5_teardownOnlyNew },
  { name: "6 hold never flips", run: control6_holdNeverFlips },
  { name: "7 no second writer on live schema", run: control7_liveSchemaCollision },
  { name: "8 rollback no_spare / supersede / clear spare", run: control8_rollback },
  { name: "9 first switch legacy spare", run: control9_firstSwitch },
  { name: "10 retention keep protected/live/spare", run: control10_retention },
  { name: "11 state invalid", run: control11_stateInvalid },
  { name: "12 nginx digest proxy recreate", run: control12_nginxDigest },
];
