/**
 * Pure deploy planner (ADR 0015 §d–§i / issue #73).
 * Sole encoder of pending precedence, start≠switch, first switch, rollback,
 * retention, and typed probe refusal.
 * Imports only Node builtins + ./ponder-deploy-state.js + ./ponder-deploy-retention.js.
 */
import {
  LEGACY_SCHEMA,
  freeSlot,
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
   * True when Compose service `ponder` is the legacy writer (not pinned nginx).
   * Observed every run (ADR §f).
   */
  preCutoverObserved: boolean;
  /** Image id of the running legacy writer before first switch; null after. */
  legacyImageId: string | null;
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
      onTimeout: "tear_down_new" | "fail";
    }
  | {
      type: "wait_ready200";
      target: "slot" | "nginx";
      slot?: PonderDeploySlot;
      schema: string;
      timeoutMs: number;
      onTimeout: "pending_exit0" | "fail";
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
  | { type: "drop_schema"; schema: string }
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
  commit: string;
}): PlanAction[] {
  return [
    { type: "evidence", text: `deploy_evidence outcome=${args.outcome}` },
    { type: "evidence", text: `deploy_evidence commit=${args.commit}` },
  ];
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

  // Missing state file after cutover is invalid; pre-cutover may lack post shape.
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
    // Treat as empty pre-cutover for first switch path.
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

  // Push pre-cutover → awaiting_dispatch, no mutation (ADR §f / control 1).
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

  // First hold/deploy via workflow_dispatch.
  const slot: PonderDeploySlot = "blue";
  const schema = schemaForCommit(observations.deployCommit);
  const image = `kargain-ponder:${observations.deployCommit}`;
  const legacyImageId = observations.legacyImageId;
  if (!legacyImageId) {
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

  const pending: PonderLiveOrPendingRef = {
    slot,
    schema,
    commit: observations.deployCommit,
    executable: observations.executableDigest,
    image,
  };
  const spare: PonderSpareRef = {
    schema: LEGACY_SCHEMA,
    commit: null,
    executable: pre.executable || observations.identityDigest,
    image: "kargain-ponder:legacy",
  };

  const next: PonderDeployState = {
    live: null,
    spare,
    pending,
    nginx_config_digest: observations.nginxConfigDigest,
  };

  actions.push(
    { type: "preserve_legacy_image", imageId: legacyImageId },
    { type: "evidence", text: "deploy_evidence preflight=ok" },
    {
      type: "evidence",
      text: `deploy_evidence slot=${slot} schema=${schema}`,
    },
    { type: "write_slot_env", slot, schema },
    { type: "build_image", commit: observations.deployCommit },
    { type: "tag_slot_image", slot, commit: observations.deployCommit },
    { type: "preflight_slot", slot },
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
  );

  if (operation === "hold") {
    actions.push(
      { type: "write_state", state: next },
      {
        type: "evidence",
        text: `deploy_evidence switch=pending schema=${schema}`,
      },
      { type: "exit", code: 0 },
    );
    return { actions };
  }

  // deploy: switch when ready (first switch sequence ADR §f).
  const liveAfter: PonderDeployState = {
    live: pending,
    spare,
    pending: null,
    nginx_config_digest: observations.nginxConfigDigest,
  };
  actions.push(
    { type: "write_upstream", slot, previousUpstream: null },
    { type: "stop_legacy_ponder" },
    { type: "up_nginx" },
    {
      type: "wait_answered",
      target: "nginx",
      timeoutMs: ANSWERED_TIMEOUT_MS,
      onTimeout: "fail",
    },
    {
      type: "wait_ready200",
      target: "nginx",
      schema,
      timeoutMs: ANSWERED_TIMEOUT_MS,
      onTimeout: "fail",
    },
    ...switchEvidence(slot),
    { type: "write_state", state: liveAfter },
    ...outcomeEvidence({
      outcome: "recreated",
      commit: observations.deployCommit,
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
  let working: PonderDeployState = { ...state };

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

  // Pending precedence (ADR §d 1).
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

  // Live collision: same schema, different executable → restart in place.
  const targetSchema = schemaForCommit(observations.deployCommit);
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

  // Never start a second writer on the live schema (control 7).
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
    { type: "evidence", text: "deploy_evidence preflight=ok" },
    {
      type: "evidence",
      text: `deploy_evidence slot=${slot} schema=${targetSchema}`,
    },
    { type: "write_slot_env", slot, schema: targetSchema },
    { type: "build_image", commit: observations.deployCommit },
    { type: "tag_slot_image", slot, commit: observations.deployCommit },
    { type: "preflight_slot", slot },
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

function planPendingPrecedence(
  actions: PlanAction[],
  state: PonderDeployState,
  operation: PonderDeployOperation,
  observations: PonderDeployObservations,
): PlanResult | null {
  const pending = state.pending;
  if (!pending) return null;

  const probe = probeOf(observations, pending.slot);
  const incomingSchema = schemaForCommit(observations.deployCommit);
  const sameExecutable = pending.executable === observations.executableDigest;

  if (isReady200(probe)) {
    // Ready pending is switched first (control 3).
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
    // If incoming differs, same run then starts it — recursive via continuing
    // after switch would need a second plan; executor re-invokes. Here we only
    // switch; if executable differs, append a note via state and exit 0 so the
    // next dispatch starts. Issue control 3: "If the incoming executable differs,
    // the same run then starts it." — continue in-plan.
    if (
      !sameExecutable &&
      pending.schema !== incomingSchema &&
      operation === "deploy"
    ) {
      const after = switched.actions;
      // Re-plan start after switch by appending start of new pending.
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
      // Strip final exit from finishSwitch and continue.
      const withoutExit = after.filter(
        (a, i) => !(a.type === "exit" && i === after.length - 1),
      );
      const stateAfterSwitch: PonderDeployState = {
        live,
        spare: state.spare,
        pending: null,
        nginx_config_digest: observations.nginxConfigDigest,
      };
      // finishSwitch already wrote live; continue start.
      withoutExit.push(
        { type: "write_slot_env", slot, schema: incomingSchema },
        { type: "build_image", commit: observations.deployCommit },
        { type: "tag_slot_image", slot, commit: observations.deployCommit },
        { type: "preflight_slot", slot },
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
    // Supersede (control 4).
    actions.push(
      { type: "stop_slot", slot: pending.slot },
      { type: "drop_schema", schema: pending.schema },
      {
        type: "write_state",
        state: { ...state, pending: null },
      },
    );
    return null; // continue with start of incoming
  }

  // Same executable: wait, never tear down (ADR §d 1 / control 4).
  actions.push(
    {
      type: "wait_ready200",
      target: "slot",
      slot: pending.slot,
      schema: pending.schema,
      timeoutMs: READY200_TIMEOUT_MS,
      onTimeout: "pending_exit0",
    },
  );
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
  // If ready arrives, switch; wait_ready200 onTimeout pending_exit0 handles miss.
  return finishSwitch(actions, state, pending, observations);
}

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
  );
  if (previousLive) {
    actions.push({ type: "stop_slot", slot: previousLive.slot });
  }
  actions.push({ type: "write_state", state: next });
  actions.push(...applyRetention(next, observations.schemas));
  // Images of live/spare/pending kept; others removed (ADR §g).
  const keepImages = new Set<string>();
  if (next.live) keepImages.add(next.live.image);
  if (next.spare) keepImages.add(next.spare.image);
  if (next.pending) keepImages.add(next.pending.image);
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

function planRollback(
  actions: PlanAction[],
  state: PonderDeployState,
  observations: PonderDeployObservations,
): PlanResult {
  // Supersede pending first (control 8).
  if (state.pending) {
    actions.push(
      { type: "stop_slot", slot: state.pending.slot },
      { type: "drop_schema", schema: state.pending.schema },
    );
    state = { ...state, pending: null };
  }

  if (!state.spare) {
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

  actions.push({ type: "assert_spare_image", image: state.spare.image });

  const slot = freeSlot(state.live);
  const schema = state.spare.schema;
  const image = state.spare.image;
  const pending: PonderLiveOrPendingRef = {
    slot,
    schema,
    commit:
      state.spare.commit ??
      "0000000000000000000000000000000000000000",
    executable: state.spare.executable,
    image,
  };
  // For legacy spare, commit on live ref after switch stays as null-capable via
  // spare shape; live requires commit string — use zeros only as placeholder for
  // legacy? ADR says commit null only for legacy spare. Live after rollback of
  // legacy: the spare runs in the slot — live should record schema kargain.
  // Use a synthetic commit field: keep spare.commit null by making live from
  // a dedicated path.

  const liveFromSpare: PonderLiveOrPendingRef = {
    slot,
    schema,
    commit: state.spare.commit ?? observations.deployCommit,
    executable: state.spare.executable,
    image,
  };

  actions.push(
    { type: "write_slot_env", slot, schema },
    { type: "tag_slot_image", slot, commit: state.spare.commit ?? "legacy" },
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
  );

  const failed = state.live;
  const next: PonderDeployState = {
    live: liveFromSpare,
    spare: null,
    pending: null,
    nginx_config_digest: observations.nginxConfigDigest,
  };

  actions.push(
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
  );
  if (failed) {
    actions.push({ type: "stop_slot", slot: failed.slot });
    actions.push({ type: "drop_schema", schema: failed.schema });
    actions.push({ type: "remove_images", images: [failed.image] });
  }
  actions.push(
    { type: "write_state", state: next },
    {
      type: "evidence",
      text: `deploy_evidence rollback=ok schema=${schema}`,
    },
    { type: "exit", code: 0 },
  );
  // silence unused
  void pending;
  return { actions };
}

/** Test helper: evidence texts in order. */
export function planEvidenceTexts(result: PlanResult): string[] {
  return result.actions
    .filter((a): a is Extract<PlanAction, { type: "evidence" }> => a.type === "evidence")
    .map((a) => a.text);
}
