/**
 * Pure deploy planner (ADR 0015 §d–§i + Amendment / issue #73).
 * Sole encoder of pending precedence, start≠switch, first switch, rollback,
 * retention, and typed probe refusal.
 * Imports only Node builtins + ./ponder-deploy-state.js + ./ponder-deploy-retention.js.
 */
import {
  LEGACY_IMAGE,
  LEGACY_SCHEMA,
  freeSlot,
  isFirstSwitchInProgress,
  legacySpareRef,
  schemaForCommit,
  type PonderDeploySlot,
  type PonderDeployState,
  type PonderLiveOrPendingRef,
  type PonderPreCutoverState,
  type PonderSpareRef,
} from "./ponder-deploy-state.js";
import {
  keepSetFromState,
  retentionSchemasToDrop,
} from "./ponder-deploy-retention.js";

export type PonderDeployOperation = "deploy" | "hold" | "rollback";

/** Typed probe result. probe_failed refuses before mutation. */
export type ProbeObservation =
  | { kind: "status"; code: number }
  | { kind: "no_answer" }
  | { kind: "probe_failed"; detail: string };

export type SlotReadyObservation = {
  blue: ProbeObservation;
  green: ProbeObservation;
  nginx: ProbeObservation;
};

export type PonderDeployObservations = {
  ready: SlotReadyObservation;
  /** Schema names from pg_namespace. */
  schemas: string[];
  executableDigest: string;
  identityDigest: string;
  deploySha: string;
  deployCommit: string;
  nginxConfigDigest: string;
  eventName: "push" | "workflow_dispatch";
  /**
   * True when the labelled ponder container is the legacy writer (not pinned
   * nginx). Amendment rule 6.
   */
  preCutoverObserved: boolean;
  /**
   * True when the labelled ponder container's image is the pinned nginx image.
   * Amendment rule 6 post-cutover.
   */
  nginxPinnedUp: boolean;
  /** Image id of the running legacy writer before first switch; null after. */
  legacyImageId: string | null;
  /** True when `kargain-ponder:legacy` is already tagged. */
  legacyImageTagged: boolean;
  /** Running slot containers observed (service names). */
  runningSlots: readonly PonderDeploySlot[];
  /** Image id currently tagged on a slot service, if any. */
  slotImages: { blue: string | null; green: string | null };
};

export type PlanAction =
  | { type: "evidence"; text: string }
  | { type: "exit"; code: number }
  | { type: "write_slot_env"; slot: PonderDeploySlot; schema: string }
  | { type: "build_image"; commit: string }
  | { type: "tag_slot_image"; slot: PonderDeploySlot; commit: string }
  | { type: "preflight_slot"; slot: PonderDeploySlot }
  | { type: "start_slot"; slot: PonderDeploySlot }
  | { type: "stop_slot"; slot: PonderDeploySlot }
  | { type: "restart_slot"; slot: PonderDeploySlot }
  | { type: "preserve_legacy_image"; imageId: string }
  | {
      type: "wait_answered";
      target: "slot" | "nginx";
      slot?: PonderDeploySlot;
      timeoutMs: number;
      /**
       * tear_down_new — schema created this run (ADR 0015 §d.3).
       * restore_reused — spare/legacy/in-place reused schema; never drop.
       */
      onTimeout: "tear_down_new" | "restore_reused" | "fail";
      /** Required when onTimeout is restore_reused. */
      failureText?: string;
    }
  | {
      type: "wait_ready200";
      target: "slot" | "nginx";
      slot?: PonderDeploySlot;
      schema: string;
      timeoutMs: number;
      onTimeout: "pending_exit0" | "restore_reused" | "fail";
      failureText?: string;
    }
  | {
      type: "write_upstream";
      slot: PonderDeploySlot;
      previousUpstream: PonderDeploySlot | null;
    }
  | { type: "reload_nginx" }
  | { type: "up_nginx" }
  | { type: "recreate_nginx" }
  | { type: "stop_legacy_ponder" }
  | { type: "retention"; drop: readonly string[] }
  | { type: "remove_images"; images: readonly string[] }
  | { type: "write_state"; state: PonderDeployState }
  | { type: "assert_spare_image"; image: string };

export type PlanResult = { actions: PlanAction[] };

export type PlanInput = {
  loaded:
    | { kind: "post_cutover"; state: PonderDeployState }
    | { kind: "pre_cutover"; state: PonderPreCutoverState }
    | { kind: "missing" };
  operation: PonderDeployOperation;
  observations: PonderDeployObservations;
};

const ANSWERED_TIMEOUT_MS = 90_000;
const READY200_TIMEOUT_MS = 600_000;

function slotService(slot: PonderDeploySlot): string {
  return `ponder-${slot}`;
}

function probeOf(
  observations: PonderDeployObservations,
  slot: PonderDeploySlot,
): ProbeObservation {
  return slot === "blue" ? observations.ready.blue : observations.ready.green;
}

function isReady200(probe: ProbeObservation): boolean {
  return probe.kind === "status" && probe.code === 200;
}

function slotRunning(
  observations: PonderDeployObservations,
  slot: PonderDeploySlot,
): boolean {
  return observations.runningSlots.includes(slot);
}

function refuseProbeFailed(
  observations: PonderDeployObservations,
): PlanAction[] | null {
  for (const [target, probe] of [
    ["blue", observations.ready.blue],
    ["green", observations.ready.green],
    ["nginx", observations.ready.nginx],
  ] as const) {
    if (probe.kind === "probe_failed") {
      return [
        {
          type: "evidence",
          text: `deploy_observation_failed: ${target}`,
        },
        { type: "exit", code: 1 },
      ];
    }
  }
  return null;
}

function refuseBadEvent(observations: PonderDeployObservations): PlanAction[] | null {
  if (
    observations.eventName !== "push" &&
    observations.eventName !== "workflow_dispatch"
  ) {
    return [
      { type: "evidence", text: "deploy_observation_failed: event_name" },
      { type: "exit", code: 1 },
    ];
  }
  return null;
}

function applyRetention(
  state: PonderDeployState,
  schemas: readonly string[],
): PlanAction[] {
  const drop = retentionSchemasToDrop(schemas, keepSetFromState(state));
  if (drop.length === 0) return [];
  return [{ type: "retention", drop }];
}

/** State write then stop + retention for a cleared pending (rule 4 / item 2). */
function clearPendingActions(
  actions: PlanAction[],
  state: PonderDeployState,
  schemas: readonly string[],
): PonderDeployState {
  if (!state.pending) return state;
  const withoutPending: PonderDeployState = { ...state, pending: null };
  actions.push(
    { type: "write_state", state: withoutPending },
    { type: "stop_slot", slot: state.pending.slot },
    ...applyRetention(withoutPending, schemas),
  );
  return withoutPending;
}

function waitAnsweredReused(
  slot: PonderDeploySlot,
  failureText: string,
): Extract<PlanAction, { type: "wait_answered" }> {
  return {
    type: "wait_answered",
    target: "slot",
    slot,
    timeoutMs: ANSWERED_TIMEOUT_MS,
    onTimeout: "restore_reused",
    failureText,
  };
}

function waitReady200Reused(
  slot: PonderDeploySlot,
  schema: string,
  failureText: string,
): Extract<PlanAction, { type: "wait_ready200" }> {
  return {
    type: "wait_ready200",
    target: "slot",
    slot,
    schema,
    timeoutMs: READY200_TIMEOUT_MS,
    onTimeout: "restore_reused",
    failureText,
  };
}

function switchEvidence(slot: PonderDeploySlot): PlanAction[] {
  return [
    { type: "evidence", text: "deploy_evidence switch=ready status=200" },
    { type: "evidence", text: "deploy_evidence switch=http" },
    {
      type: "evidence",
      text: `deploy_evidence proxy=upstream ${slotService(slot)}:42069`,
    },
  ];
}

function outcomeEvidence(args: {
  outcome: "recreated" | "unchanged";
  commit: string | null;
}): PlanAction[] {
  // commit= is printed once by the executor from DEPLOYED_COMMIT=$(git rev-parse HEAD).
  void args.commit;
  return [
    { type: "evidence", text: `deploy_evidence outcome=${args.outcome}` },
  ];
}

function ensurePendingRunning(
  actions: PlanAction[],
  pending: PonderLiveOrPendingRef,
  observations: PonderDeployObservations,
): void {
  // Amendment rule 4: recorded pending whose writer is not running is started
  // again, idempotently, before waiting.
  if (!slotRunning(observations, pending.slot)) {
    actions.push({ type: "start_slot", slot: pending.slot });
  }
}

/**
 * Plan the next deploy operation.
 */
export function planPonderDeploy(input: PlanInput): PlanResult {
  const { loaded, operation, observations } = input;
  const actions: PlanAction[] = [
    { type: "evidence", text: `deploy_evidence operation=${operation}` },
  ];

  const badEvent = refuseBadEvent(observations);
  if (badEvent) return { actions: [...actions, ...badEvent] };

  const probeFail = refuseProbeFailed(observations);
  if (probeFail) return { actions: [...actions, ...probeFail] };

  if (loaded.kind === "missing") {
    if (!observations.preCutoverObserved) {
      return {
        actions: [
          ...actions,
          {
            type: "evidence",
            text: "deploy_state_invalid: missing file",
          },
          { type: "exit", code: 1 },
        ],
      };
    }
    return planFromPreCutover(
      actions,
      { identity: "", executable: "" },
      operation,
      observations,
    );
  }

  if (loaded.kind === "pre_cutover") {
    if (!observations.preCutoverObserved) {
      return {
        actions: [
          ...actions,
          {
            type: "evidence",
            text: "deploy_state_invalid: pre_cutover file shape while post-cutover observed",
          },
          { type: "exit", code: 1 },
        ],
      };
    }
    return planFromPreCutover(
      actions,
      loaded.state,
      operation,
      observations,
    );
  }

  // Disagreement: pre-cutover observed but post-cutover state present with live.
  if (observations.preCutoverObserved && loaded.state.live !== null) {
    return {
      actions: [
        ...actions,
        {
          type: "evidence",
          text: "deploy_state_invalid: live set while pre-cutover observed",
        },
        { type: "exit", code: 1 },
      ],
    };
  }

  return planPostCutover(actions, loaded.state, operation, observations);
}

function planFromPreCutover(
  actions: PlanAction[],
  pre: PonderPreCutoverState,
  operation: PonderDeployOperation,
  observations: PonderDeployObservations,
): PlanResult {
  if (operation === "rollback") {
    return {
      actions: [
        ...actions,
        {
          type: "evidence",
          text: "deploy_rollback_failed: no_spare",
        },
        { type: "exit", code: 1 },
      ],
    };
  }

  if (observations.eventName === "push") {
    return {
      actions: [
        ...actions,
        {
          type: "evidence",
          text: "deploy_evidence cutover=awaiting_dispatch",
        },
        { type: "exit", code: 0 },
      ],
    };
  }

  // First hold/deploy: start pending; write {live:null,spare:null,pending}.
  // Do not tag legacy or set spare until switch starts (Amendment rules 2–3).
  const slot: PonderDeploySlot = "blue";
  const schema = schemaForCommit(observations.deployCommit);
  const image = `kargain-ponder:${observations.deployCommit}`;

  const pending: PonderLiveOrPendingRef = {
    slot,
    schema,
    commit: observations.deployCommit,
    executable: observations.executableDigest,
    image,
  };

  const afterStart: PonderDeployState = {
    live: null,
    spare: null,
    pending,
    nginx_config_digest: observations.nginxConfigDigest,
  };

  actions.push(
    {
      type: "evidence",
      text: `deploy_evidence slot=${slot} schema=${schema}`,
    },
    { type: "write_slot_env", slot, schema },
    { type: "build_image", commit: observations.deployCommit },
    { type: "tag_slot_image", slot, commit: observations.deployCommit },
    { type: "preflight_slot", slot },
    { type: "evidence", text: "deploy_evidence preflight=ok" },
    { type: "start_slot", slot },
    {
      type: "wait_answered",
      target: "slot",
      slot,
      timeoutMs: ANSWERED_TIMEOUT_MS,
      onTimeout: "tear_down_new",
    },
    {
      type: "wait_ready200",
      target: "slot",
      slot,
      schema,
      timeoutMs: READY200_TIMEOUT_MS,
      onTimeout: "pending_exit0",
    },
    { type: "write_state", state: afterStart },
  );

  if (operation === "hold") {
    actions.push(
      {
        type: "evidence",
        text: `deploy_evidence switch=pending schema=${schema}`,
      },
      { type: "exit", code: 0 },
    );
    return { actions };
  }

  // deploy: first switch a–h after the spare:null write.
  return appendFirstSwitch(
    actions,
    afterStart,
    pending,
    pre.executable || observations.identityDigest,
    observations,
  );
}

/**
 * First switch steps (a)–(h). Resumes from the first step not observed done.
 */
function appendFirstSwitch(
  actions: PlanAction[],
  state: PonderDeployState,
  pending: PonderLiveOrPendingRef,
  legacyExecutable: string,
  observations: PonderDeployObservations,
): PlanResult {
  const spare = legacySpareRef(legacyExecutable);
  const mid: PonderDeployState = {
    live: null,
    spare,
    pending,
    nginx_config_digest: observations.nginxConfigDigest,
  };
  const liveAfter: PonderDeployState = {
    live: pending,
    spare,
    pending: null,
    nginx_config_digest: observations.nginxConfigDigest,
  };

  const legacyRunning = observations.preCutoverObserved;
  const nginxUp = observations.nginxPinnedUp;
  const tagged = observations.legacyImageTagged;
  const spareRecorded =
    state.spare !== null && state.spare.image === LEGACY_IMAGE;

  // (a) tag the legacy image
  if (!tagged || !spareRecorded) {
    const legacyImageId = observations.legacyImageId;
    if (!legacyImageId && !tagged) {
      return {
        actions: [
          ...actions,
          {
            type: "evidence",
            text: "deploy_observation_failed: legacy_image",
          },
          { type: "exit", code: 1 },
        ],
      };
    }
    if (!tagged) {
      actions.push({
        type: "preserve_legacy_image",
        imageId: legacyImageId ?? "",
      });
    }
  }

  // (b) write {live:null, spare:legacy, pending}
  if (!spareRecorded) {
    actions.push({ type: "write_state", state: mid });
  }

  // (c) stop the legacy container
  if (legacyRunning) {
    actions.push({ type: "stop_legacy_ponder" });
  }

  // (d) write upstream for pending slot
  // (e) up nginx
  if (!nginxUp) {
    actions.push(
      { type: "write_upstream", slot: pending.slot, previousUpstream: null },
      { type: "up_nginx" },
      {
        type: "wait_answered",
        target: "nginx",
        timeoutMs: ANSWERED_TIMEOUT_MS,
        onTimeout: "fail",
      },
    );
  }

  // (f) 200 through nginx
  actions.push({
    type: "wait_ready200",
    target: "nginx",
    schema: pending.schema,
    timeoutMs: ANSWERED_TIMEOUT_MS,
    onTimeout: "fail",
  });
  actions.push(...switchEvidence(pending.slot));

  // (g) write live — right after 200 (rule 4)
  actions.push({ type: "write_state", state: liveAfter });

  // (h) retention (legacy already stopped in (c); no old slot to stop)
  actions.push(...applyRetention(liveAfter, observations.schemas));
  actions.push(
    ...outcomeEvidence({
      outcome: "recreated",
      commit: pending.commit,
    }),
    {
      type: "evidence",
      text: "deploy_evidence ready=ponder status=200",
    },
    { type: "exit", code: 0 },
  );
  return { actions };
}

function planPostCutover(
  actions: PlanAction[],
  state: PonderDeployState,
  operation: PonderDeployOperation,
  observations: PonderDeployObservations,
): PlanResult {
  let working: PonderDeployState = {
    live: state.live,
    spare: state.spare,
    pending: state.pending,
    nginx_config_digest: state.nginx_config_digest,
  };

  // First-switch-in-progress (Amendment rule 3).
  if (isFirstSwitchInProgress(working)) {
    if (operation === "rollback") {
      return planRollbackDuringFirstSwitch(actions, working, observations);
    }
    if (operation === "hold") {
      const schema = working.pending?.schema ?? LEGACY_SCHEMA;
      return {
        actions: [
          ...actions,
          {
            type: "evidence",
            text: `deploy_evidence switch=pending schema=${schema}`,
          },
          { type: "exit", code: 0 },
        ],
      };
    }
    if (!working.pending) {
      return {
        actions: [
          ...actions,
          {
            type: "evidence",
            text: "deploy_state_invalid: first_switch_missing_pending",
          },
          { type: "exit", code: 1 },
        ],
      };
    }
    ensurePendingRunning(actions, working.pending, observations);
    return appendFirstSwitch(
      actions,
      working,
      working.pending,
      working.spare?.executable ?? observations.identityDigest,
      observations,
    );
  }

  // live null + spare null: abandon result or first-hold write (pending optional).
  if (working.live === null && working.spare === null) {
    if (operation === "rollback") {
      return {
        actions: [
          ...actions,
          {
            type: "evidence",
            text: "deploy_rollback_failed: no_spare",
          },
          { type: "exit", code: 1 },
        ],
      };
    }
    if (working.pending) {
      // Resume pending from first hold; deploy continues to first switch.
      return planPendingThenMaybeFirstSwitch(
        actions,
        working,
        operation,
        observations,
      );
    }
    // Empty abandoned state — treat like missing pre-cutover only if still pre.
    if (observations.preCutoverObserved) {
      return planFromPreCutover(
        actions,
        { identity: "", executable: "" },
        operation,
        observations,
      );
    }
    return {
      actions: [
        ...actions,
        {
          type: "evidence",
          text: "deploy_state_invalid: empty post_cutover without live",
        },
        { type: "exit", code: 1 },
      ],
    };
  }

  // Proxy-only recreate when nginx digest changed (control 12).
  if (
    working.nginx_config_digest !== null &&
    working.nginx_config_digest !== observations.nginxConfigDigest &&
    working.live
  ) {
    actions.push(
      { type: "recreate_nginx" },
      { type: "evidence", text: "deploy_evidence proxy=recreated" },
    );
    working = {
      ...working,
      nginx_config_digest: observations.nginxConfigDigest,
    };
    actions.push({ type: "write_state", state: working });
  }

  if (operation === "rollback") {
    return planRollback(actions, working, observations);
  }

  const pendingPlan = planPendingPrecedence(
    actions,
    working,
    operation,
    observations,
  );
  if (pendingPlan) return pendingPlan;

  const liveExec = working.live?.executable ?? "";
  const unchanged =
    liveExec !== "" && liveExec === observations.executableDigest;

  if (unchanged && !working.pending) {
    actions.push(
      ...outcomeEvidence({
        outcome: "unchanged",
        commit: working.live?.commit ?? observations.deployCommit,
      }),
      {
        type: "evidence",
        text: `deploy_evidence ready=ponder status=${
          observations.ready.nginx.kind === "status"
            ? observations.ready.nginx.code
            : "no_answer"
        }`,
      },
      { type: "exit", code: 0 },
    );
    return { actions };
  }

  const targetSchema = schemaForCommit(observations.deployCommit);

  // Amendment rule 5: deploying the spare's commit — spare:null first, reuse schema.
  if (working.spare && working.spare.schema === targetSchema) {
    return planSpareAsPending(actions, working, operation, observations);
  }

  // Live collision: same schema, different executable → restart in place.
  if (
    working.live &&
    working.live.schema === targetSchema &&
    working.live.executable !== observations.executableDigest
  ) {
    const slot = working.live.slot;
    const image = `kargain-ponder:${observations.deployCommit}`;
    const nextLive: PonderLiveOrPendingRef = {
      ...working.live,
      commit: observations.deployCommit,
      executable: observations.executableDigest,
      image,
    };
    actions.push(
      { type: "write_slot_env", slot, schema: targetSchema },
      { type: "build_image", commit: observations.deployCommit },
      { type: "tag_slot_image", slot, commit: observations.deployCommit },
      { type: "restart_slot", slot },
      {
        type: "wait_answered",
        target: "slot",
        slot,
        timeoutMs: ANSWERED_TIMEOUT_MS,
        onTimeout: "fail",
      },
      {
        type: "wait_ready200",
        target: "slot",
        slot,
        schema: targetSchema,
        timeoutMs: READY200_TIMEOUT_MS,
        onTimeout: "fail",
      },
      {
        type: "write_state",
        state: { ...working, live: nextLive, pending: null },
      },
      ...outcomeEvidence({
        outcome: "recreated",
        commit: observations.deployCommit,
      }),
      { type: "exit", code: 0 },
    );
    return { actions };
  }

  if (working.live && working.live.schema === targetSchema) {
    actions.push(
      ...outcomeEvidence({
        outcome: "unchanged",
        commit: working.live.commit,
      }),
      { type: "exit", code: 0 },
    );
    return { actions };
  }

  return startNewPending(actions, working, operation, observations, targetSchema);
}

function planSpareAsPending(
  actions: PlanAction[],
  state: PonderDeployState,
  operation: PonderDeployOperation,
  observations: PonderDeployObservations,
): PlanResult {
  const spare = state.spare!;
  const slot = freeSlot(state.live);
  const pending: PonderLiveOrPendingRef = {
    slot,
    schema: spare.schema,
    commit: spare.commit,
    executable: observations.executableDigest,
    image: spare.image,
  };
  // Reused spare schema: consume spare in state only after the 200 gate.
  const cleared: PonderDeployState = {
    ...state,
    spare: null,
    pending,
    nginx_config_digest: observations.nginxConfigDigest,
  };
  actions.push(
    { type: "write_slot_env", slot, schema: spare.schema },
    { type: "tag_slot_image", slot, commit: spare.commit ?? "legacy" },
    { type: "start_slot", slot },
    waitAnsweredReused(slot, "ponder_did_not_become_ready"),
    waitReady200Reused(slot, spare.schema, "ponder_did_not_become_ready"),
    { type: "write_state", state: cleared },
  );
  if (operation === "hold") {
    actions.push(
      {
        type: "evidence",
        text: `deploy_evidence switch=pending schema=${spare.schema}`,
      },
      { type: "exit", code: 0 },
    );
    return { actions };
  }
  return finishSwitch(actions, cleared, pending, observations);
}

function startNewPending(
  actions: PlanAction[],
  working: PonderDeployState,
  operation: PonderDeployOperation,
  observations: PonderDeployObservations,
  targetSchema: string,
): PlanResult {
  const slot = freeSlot(working.live);
  const image = `kargain-ponder:${observations.deployCommit}`;
  const pending: PonderLiveOrPendingRef = {
    slot,
    schema: targetSchema,
    commit: observations.deployCommit,
    executable: observations.executableDigest,
    image,
  };

  actions.push(
    {
      type: "evidence",
      text: `deploy_evidence slot=${slot} schema=${targetSchema}`,
    },
    { type: "write_slot_env", slot, schema: targetSchema },
    { type: "build_image", commit: observations.deployCommit },
    { type: "tag_slot_image", slot, commit: observations.deployCommit },
    { type: "preflight_slot", slot },
    { type: "evidence", text: "deploy_evidence preflight=ok" },
    { type: "start_slot", slot },
    {
      type: "wait_answered",
      target: "slot",
      slot,
      timeoutMs: ANSWERED_TIMEOUT_MS,
      onTimeout: "tear_down_new",
    },
    {
      type: "wait_ready200",
      target: "slot",
      slot,
      schema: targetSchema,
      timeoutMs: READY200_TIMEOUT_MS,
      onTimeout: "pending_exit0",
    },
  );

  const afterStart: PonderDeployState = {
    ...working,
    pending,
    nginx_config_digest: observations.nginxConfigDigest,
  };

  if (operation === "hold") {
    actions.push(
      { type: "write_state", state: afterStart },
      {
        type: "evidence",
        text: `deploy_evidence switch=pending schema=${targetSchema}`,
      },
      { type: "exit", code: 0 },
    );
    return { actions };
  }

  return finishSwitch(actions, afterStart, pending, observations);
}

function planPendingThenMaybeFirstSwitch(
  actions: PlanAction[],
  state: PonderDeployState,
  operation: PonderDeployOperation,
  observations: PonderDeployObservations,
): PlanResult {
  const pending = state.pending!;
  ensurePendingRunning(actions, pending, observations);
  const probe = probeOf(observations, pending.slot);

  if (operation === "hold") {
    if (!isReady200(probe)) {
      actions.push({
        type: "wait_ready200",
        target: "slot",
        slot: pending.slot,
        schema: pending.schema,
        timeoutMs: READY200_TIMEOUT_MS,
        onTimeout: "pending_exit0",
      });
    }
    actions.push(
      {
        type: "evidence",
        text: `deploy_evidence switch=pending schema=${pending.schema}`,
      },
      { type: "exit", code: 0 },
    );
    return { actions };
  }

  // deploy: wait for ready if needed, then first switch a–h.
  if (!isReady200(probe)) {
    actions.push({
      type: "wait_ready200",
      target: "slot",
      slot: pending.slot,
      schema: pending.schema,
      timeoutMs: READY200_TIMEOUT_MS,
      onTimeout: "pending_exit0",
    });
  }
  return appendFirstSwitch(
    actions,
    state,
    pending,
    observations.identityDigest,
    observations,
  );
}

function planPendingPrecedence(
  actions: PlanAction[],
  state: PonderDeployState,
  operation: PonderDeployOperation,
  observations: PonderDeployObservations,
): PlanResult | null {
  const pending = state.pending;
  if (!pending) return null;

  // Pre-first-switch pending (live null, spare null) handled elsewhere.
  if (state.live === null) return null;

  ensurePendingRunning(actions, pending, observations);

  const probe = probeOf(observations, pending.slot);
  const incomingSchema = schemaForCommit(observations.deployCommit);
  const sameExecutable = pending.executable === observations.executableDigest;

  if (isReady200(probe)) {
    if (operation === "hold") {
      return {
        actions: [
          ...actions,
          {
            type: "evidence",
            text: `deploy_evidence switch=pending schema=${pending.schema}`,
          },
          {
            type: "evidence",
            text: "deploy_evidence switch=ready status=200",
          },
          { type: "exit", code: 0 },
        ],
      };
    }
    const switched = finishSwitch(
      [...actions],
      state,
      pending,
      observations,
    );
    if (
      !sameExecutable &&
      pending.schema !== incomingSchema &&
      operation === "deploy"
    ) {
      const after = switched.actions;
      const live = pending;
      const slot = freeSlot(live);
      const image = `kargain-ponder:${observations.deployCommit}`;
      const newPending: PonderLiveOrPendingRef = {
        slot,
        schema: incomingSchema,
        commit: observations.deployCommit,
        executable: observations.executableDigest,
        image,
      };
      const withoutExit = after.filter(
        (a, i) => !(a.type === "exit" && i === after.length - 1),
      );
      const stateAfterSwitch: PonderDeployState = {
        live,
        spare: state.spare,
        pending: null,
        nginx_config_digest: observations.nginxConfigDigest,
      };
      withoutExit.push(
        { type: "write_slot_env", slot, schema: incomingSchema },
        { type: "build_image", commit: observations.deployCommit },
        { type: "tag_slot_image", slot, commit: observations.deployCommit },
        { type: "preflight_slot", slot },
        { type: "evidence", text: "deploy_evidence preflight=ok" },
        { type: "start_slot", slot },
        {
          type: "wait_answered",
          target: "slot",
          slot,
          timeoutMs: ANSWERED_TIMEOUT_MS,
          onTimeout: "tear_down_new",
        },
        {
          type: "wait_ready200",
          target: "slot",
          slot,
          schema: incomingSchema,
          timeoutMs: READY200_TIMEOUT_MS,
          onTimeout: "pending_exit0",
        },
        {
          type: "write_state",
          state: { ...stateAfterSwitch, pending: newPending },
        },
        {
          type: "evidence",
          text: `deploy_evidence switch=pending schema=${incomingSchema}`,
        },
        { type: "exit", code: 0 },
      );
      return { actions: withoutExit };
    }
    return switched;
  }

  // Not-ready pending.
  if (!sameExecutable) {
    // Supersede: state before destructive (rule 4); DROP via retention only.
    clearPendingActions(actions, state, observations.schemas);
    return null;
  }

  actions.push({
    type: "wait_ready200",
    target: "slot",
    slot: pending.slot,
    schema: pending.schema,
    timeoutMs: READY200_TIMEOUT_MS,
    onTimeout: "pending_exit0",
  });
  if (operation === "hold") {
    actions.push(
      {
        type: "evidence",
        text: `deploy_evidence switch=pending schema=${pending.schema}`,
      },
      { type: "exit", code: 0 },
    );
    return { actions };
  }
  return finishSwitch(actions, state, pending, observations);
}

/**
 * Post-cutover switch: 200 → write live → stop old → retention (rule 4).
 */
function finishSwitch(
  actions: PlanAction[],
  state: PonderDeployState,
  pending: PonderLiveOrPendingRef,
  observations: PonderDeployObservations,
): PlanResult {
  const previousLive = state.live;
  const previousUpstream = previousLive?.slot ?? null;
  const newSpare: PonderSpareRef | null = previousLive
    ? {
        schema: previousLive.schema,
        commit: previousLive.commit,
        executable: previousLive.executable,
        image: previousLive.image,
      }
    : state.spare;

  const next: PonderDeployState = {
    live: pending,
    spare: newSpare,
    pending: null,
    nginx_config_digest: observations.nginxConfigDigest,
  };

  actions.push(
    {
      type: "write_upstream",
      slot: pending.slot,
      previousUpstream,
    },
    { type: "reload_nginx" },
    {
      type: "wait_ready200",
      target: "nginx",
      schema: pending.schema,
      timeoutMs: ANSWERED_TIMEOUT_MS,
      onTimeout: "fail",
    },
    ...switchEvidence(pending.slot),
    { type: "write_state", state: next },
  );
  if (previousLive) {
    actions.push({ type: "stop_slot", slot: previousLive.slot });
  }
  actions.push(...applyRetention(next, observations.schemas));
  actions.push(
    ...outcomeEvidence({
      outcome: "recreated",
      commit: pending.commit,
    }),
    {
      type: "evidence",
      text: "deploy_evidence ready=ponder status=200",
    },
    { type: "exit", code: 0 },
  );
  return { actions };
}

function planRollbackDuringFirstSwitch(
  actions: PlanAction[],
  state: PonderDeployState,
  observations: PonderDeployObservations,
): PlanResult {
  const pending = state.pending;
  // Legacy container still running → abandon (rule 3).
  if (observations.preCutoverObserved) {
    const cleared: PonderDeployState = {
      live: null,
      spare: null,
      pending: null,
      nginx_config_digest: state.nginx_config_digest,
    };
    actions.push({ type: "write_state", state: cleared });
    if (pending) {
      actions.push(
        { type: "stop_slot", slot: pending.slot },
        ...applyRetention(cleared, observations.schemas),
      );
    }
    actions.push(
      {
        type: "evidence",
        text: "deploy_evidence rollback=abandoned",
      },
      { type: "exit", code: 0 },
    );
    return { actions };
  }

  // Legacy already stopped: clear pending, start legacy in a slot on kargain.
  return planRollbackToLegacy(actions, state, observations);
}

function planRollback(
  actions: PlanAction[],
  state: PonderDeployState,
  observations: PonderDeployObservations,
): PlanResult {
  const spare = state.spare;
  if (!spare) {
    return {
      actions: [
        ...actions,
        {
          type: "evidence",
          text: "deploy_rollback_failed: no_spare",
        },
        { type: "exit", code: 1 },
      ],
    };
  }

  // If somehow still in first-switch shape, use that path.
  if (isFirstSwitchInProgress(state)) {
    return planRollbackDuringFirstSwitch(actions, state, observations);
  }

  // Clear pending first: state write then retention (rule 4 / item 2).
  state = clearPendingActions(actions, state, observations.schemas);

  if (spare.schema === LEGACY_SCHEMA) {
    return planRollbackToLegacy(actions, state, observations);
  }

  actions.push({ type: "assert_spare_image", image: spare.image });

  const slot = freeSlot(state.live);
  const schema = spare.schema;
  const image = spare.image;
  const liveFromSpare: PonderLiveOrPendingRef = {
    slot,
    schema,
    commit: spare.commit,
    executable: spare.executable,
    image,
  };

  const failed = state.live;
  const next: PonderDeployState = {
    live: liveFromSpare,
    spare: null,
    pending: null,
    nginx_config_digest: observations.nginxConfigDigest,
  };

  actions.push(
    { type: "write_slot_env", slot, schema },
    { type: "tag_slot_image", slot, commit: spare.commit ?? "legacy" },
    { type: "start_slot", slot },
    waitAnsweredReused(slot, "deploy_rollback_failed: spare_not_answering"),
    waitReady200Reused(slot, schema, "deploy_rollback_failed: spare_not_answering"),
    {
      type: "write_upstream",
      slot,
      previousUpstream: failed?.slot ?? null,
    },
    { type: "reload_nginx" },
    {
      type: "wait_ready200",
      target: "nginx",
      schema,
      timeoutMs: ANSWERED_TIMEOUT_MS,
      onTimeout: "fail",
    },
    ...switchEvidence(slot),
    // Write live (consumes spare) only after 200, then stop old (rule 4).
    { type: "write_state", state: next },
  );
  if (failed) {
    actions.push(
      { type: "stop_slot", slot: failed.slot },
      ...applyRetention(next, observations.schemas),
      { type: "remove_images", images: [failed.image] },
    );
  }
  actions.push(
    {
      type: "evidence",
      text: `deploy_evidence rollback=ok schema=${schema}`,
    },
    { type: "exit", code: 0 },
  );
  return { actions };
}

/**
 * Rollback to legacy image in a slot on kargain (commit null). Never invents
 * a commit (Amendment rule 1 / 3).
 */
function planRollbackToLegacy(
  actions: PlanAction[],
  state: PonderDeployState,
  observations: PonderDeployObservations,
): PlanResult {
  state = clearPendingActions(actions, state, observations.schemas);

  actions.push({ type: "assert_spare_image", image: LEGACY_IMAGE });

  const slot = freeSlot(state.live);
  const liveFromLegacy: PonderLiveOrPendingRef = {
    slot,
    schema: LEGACY_SCHEMA,
    commit: null,
    executable: state.spare?.executable ?? observations.identityDigest,
    image: LEGACY_IMAGE,
  };
  const failed = state.live;
  const next: PonderDeployState = {
    live: liveFromLegacy,
    spare: null,
    pending: null,
    nginx_config_digest: observations.nginxConfigDigest,
  };

  actions.push(
    { type: "write_slot_env", slot, schema: LEGACY_SCHEMA },
    { type: "tag_slot_image", slot, commit: "legacy" },
    { type: "start_slot", slot },
    waitAnsweredReused(slot, "deploy_rollback_failed: spare_not_answering"),
    waitReady200Reused(
      slot,
      LEGACY_SCHEMA,
      "deploy_rollback_failed: spare_not_answering",
    ),
  );

  if (!observations.nginxPinnedUp) {
    actions.push(
      { type: "write_upstream", slot, previousUpstream: failed?.slot ?? null },
      { type: "up_nginx" },
    );
  } else {
    actions.push({
      type: "write_upstream",
      slot,
      previousUpstream: failed?.slot ?? null,
    });
    actions.push({ type: "reload_nginx" });
  }

  actions.push(
    {
      type: "wait_ready200",
      target: "nginx",
      schema: LEGACY_SCHEMA,
      timeoutMs: ANSWERED_TIMEOUT_MS,
      onTimeout: "fail",
    },
    ...switchEvidence(slot),
    { type: "write_state", state: next },
  );
  if (failed) {
    actions.push(
      { type: "stop_slot", slot: failed.slot },
      ...applyRetention(next, observations.schemas),
      { type: "remove_images", images: [failed.image] },
    );
  }
  actions.push(
    {
      type: "evidence",
      text: `deploy_evidence rollback=ok schema=${LEGACY_SCHEMA}`,
    },
    { type: "exit", code: 0 },
  );
  return { actions };
}

/** Test helper: evidence texts in order. */
export function planEvidenceTexts(result: PlanResult): string[] {
  return result.actions
    .filter((a): a is Extract<PlanAction, { type: "evidence" }> => a.type === "evidence")
    .map((a) => a.text);
}

/**
 * Planted ordering defect helpers for the model test (must fail invariants).
 * Not used by production plan paths.
 */
export function plantedDefectStateAfterDrop(
  state: PonderDeployState,
  dropSchema: string,
): PlanAction[] {
  return [
    { type: "retention", drop: [dropSchema] },
    { type: "write_state", state },
  ];
}

/**
 * Independent model of the pre-fix rule: wait_answered tear_down_new drops the
 * reused spare schema. Reproduces `spare schema missing kargain after wait_answered`.
 */
export function modelCurrentRuleSpareDroppedOnWaitTimeout(args: {
  schemas: Set<string>;
  spareSchema: string;
  onTimeout: "tear_down_new" | "restore_reused";
}): { schemas: Set<string>; violation: string | null } {
  const schemas = new Set(args.schemas);
  if (args.onTimeout === "tear_down_new") {
    schemas.delete(args.spareSchema);
  }
  const violation =
    args.spareSchema === LEGACY_SCHEMA && !schemas.has(LEGACY_SCHEMA)
      ? "spare schema missing kargain after wait_answered"
      : !schemas.has(args.spareSchema)
        ? `spare schema missing ${args.spareSchema} after wait_answered`
        : null;
  return { schemas, violation };
}

export function plantedDefectRollbackWhileLegacyRuns(
  state: PonderDeployState,
  slot: PonderDeploySlot,
): PlanAction[] {
  return [
    { type: "tag_slot_image", slot, commit: "legacy" },
    { type: "start_slot", slot },
    {
      type: "write_state",
      state: {
        live: {
          slot,
          schema: LEGACY_SCHEMA,
          commit: null,
          executable: state.spare?.executable ?? "x",
          image: LEGACY_IMAGE,
        },
        spare: null,
        pending: null,
        nginx_config_digest: state.nginx_config_digest,
      },
    },
  ];
}
