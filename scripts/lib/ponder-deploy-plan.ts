/**
 * Pure deploy planner (ADR 0014 §a/d/e/f/j / issue #69 / PR #71).
 * Sole encoder of collision, pending precedence, start≠switch, rollback models,
 * retention, first cutover, and typed probe refusal. Imports only Node builtins
 * + ./ponder-deploy-state.js + ./ponder-deploy-retention.js.
 */
import type {
  PonderDeploySlot,
  PonderDeployState,
  PonderRollbackModel,
  PonderSlotRef,
} from "./ponder-deploy-state.js";
import { schemaNameForDeploySha } from "./ponder-deploy-state.js";
import { retentionSchemasToDrop } from "./ponder-deploy-retention.js";

export type PonderDeployOperation = "deploy" | "hold" | "rollback";

/** Typed probe result (A3). Only no_answer / non-200 status count as not-ready. */
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
  /** Stored executable digest from state file (may be empty). */
  storedExecutable: string;
  /** Incoming executable digest for this run. */
  executableDigest: string;
  identityDigest: string;
  /** Deploy SHA (schema = k_<sha>). Usually equals deployCommit. */
  deploySha: string;
  /** Commit labelled onto slot images / recorded on slot refs. */
  deployCommit: string;
  /** git HEAD of the server checkout before this run's checkout (first cutover). */
  priorCheckoutSha: string | null;
  /** Digest of the current ops/nginx/ponder.conf file (B9). */
  nginxConfigDigest: string;
  /** GitHub event / rehearsal trigger (A9). */
  eventName: "push" | "workflow_dispatch" | "rehearsal" | string;
  /** Running legacy ponder image id before cutover (A8). */
  legacyImageId: string | null;
  /**
   * DB fact: schema kargain holds base tables (relkind r|p).
   * Plan CLI reconciles phase from this (A1); not a file flag.
   */
  kargainHasBaseTables: boolean;
};

export type UpstreamTarget = PonderDeploySlot | "legacy";

export type PlanAction =
  | { type: "evidence"; text: string }
  | { type: "exit"; code: number }
  | {
      type: "write_slot_env";
      slot: PonderDeploySlot;
      schema: string;
    }
  | {
      type: "build_slot";
      slot: PonderDeploySlot;
      /** Commit label baked into the image (B4). */
      label: string;
    }
  | { type: "preflight_slot"; slot: PonderDeploySlot }
  | { type: "start_slot"; slot: PonderDeploySlot }
  | { type: "stop_slot"; slot: PonderDeploySlot }
  | { type: "stop_legacy_writer" }
  | {
      type: "preserve_legacy_image";
      imageId: string;
    }
  | {
      type: "start_legacy_writer";
      image: string;
    }
  | {
      type: "wait_answered";
      target: "slot" | "nginx";
      slot?: PonderDeploySlot;
      timeoutMs: number;
      /** On fail: shell stops new, drops schema, clears pending, exits 1 (B7). */
      onTimeout: "tear_down_new" | "fail";
      failEvidence?: string;
    }
  | {
      type: "wait_ready200";
      target: "slot" | "nginx";
      slot?: PonderDeploySlot;
      schema: string;
      timeoutMs: number;
      onTimeout: "pending_exit0" | "fail";
      failEvidence?: string;
    }
  | {
      type: "switch_views";
      targetSchema: string;
      kind: "normal" | "first_cutover" | "first_cutover_rollback";
      renameLiveTo: string;
    }
  | {
      type: "write_upstream";
      slot: UpstreamTarget;
      /** Prior upstream for restore on HTTP fail (B8). */
      previousUpstream: UpstreamTarget | null;
    }
  | { type: "reload_nginx" }
  | { type: "up_nginx" }
  | { type: "recreate_nginx" }
  | { type: "drop_schema"; schema: string }
  | {
      type: "retention";
      drop: readonly string[];
    }
  | { type: "write_state"; state: PonderDeployState }
  | { type: "check_schema_absent"; schema: string }
  | {
      type: "assert_slot_image_label";
      slot: PonderDeploySlot;
      commit: string;
      onMismatch: "deploy_rollback_failed: previous_image_mismatch";
    }
  | {
      type: "probe_answered";
      target: "nginx" | "slot";
      slot?: PonderDeploySlot;
    };

export type PlanResult = {
  actions: PlanAction[];
};

const ANSWERED_TIMEOUT_MS = 90_000;
const READY200_TIMEOUT_MS = 600_000;
const ROLLBACK_READY_TIMEOUT_MS = 60_000;

function oppositeSlot(slot: PonderDeploySlot): PonderDeploySlot {
  return slot === "blue" ? "green" : "blue";
}

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

/** Not-ready for supersede: only no_answer or non-200 status (A3). */
function isNotReady(probe: ProbeObservation): boolean {
  return (
    probe.kind === "no_answer" ||
    (probe.kind === "status" && probe.code !== 200)
  );
}

function mayMutatePreCutover(eventName: string): boolean {
  return eventName === "workflow_dispatch" || eventName === "rehearsal";
}

/**
 * Live executable for skip/unchanged (A6): prefer live.executable when set;
 * otherwise top-level state.executable / storedExecutable.
 */
function liveExecutableDigest(
  state: PonderDeployState,
  observations: PonderDeployObservations,
): string {
  if (state.live) return state.live.executable;
  if (observations.storedExecutable !== "") {
    return observations.storedExecutable;
  }
  return state.executable;
}

function executableUnchanged(
  state: PonderDeployState,
  observations: PonderDeployObservations,
): boolean {
  const liveExec = liveExecutableDigest(state, observations);
  return liveExec !== "" && liveExec === observations.executableDigest;
}

function nginxConfigChanged(
  state: PonderDeployState,
  observations: PonderDeployObservations,
): boolean {
  return state.nginx_config_digest !== observations.nginxConfigDigest;
}

function successEvidence(args: {
  schema: string;
  slot: PonderDeploySlot;
  rollbackModel: PonderRollbackModel;
}): PlanAction[] {
  return [
    { type: "evidence", text: `deploy_evidence schema=${args.schema}` },
    { type: "evidence", text: "deploy_evidence views=kargain" },
    { type: "evidence", text: "deploy_evidence switch=ready status=200" },
    { type: "evidence", text: "deploy_evidence switch=views" },
    { type: "evidence", text: "deploy_evidence switch=http" },
    {
      type: "evidence",
      text: `deploy_evidence proxy=upstream ${slotService(args.slot)}:42069`,
    },
    {
      type: "evidence",
      text: `deploy_evidence rollback_model=${args.rollbackModel}`,
    },
  ];
}

function applyRetention(
  state: PonderDeployState,
  schemas: readonly string[],
): PlanAction[] {
  const drop = retentionSchemasToDrop(schemas, {
    live: state.live?.schema ?? null,
    previous: state.previous?.schema ?? null,
    pending: state.pending?.schema ?? null,
  });
  if (drop.length === 0) return [];
  return [{ type: "retention", drop }];
}

function chooseStartSlot(state: PonderDeployState): PonderDeploySlot {
  if (state.phase === "pre_cutover" || !state.live) return "blue";
  return oppositeSlot(state.live.slot);
}

function slotRef(args: {
  slot: PonderDeploySlot;
  schema: string;
  commit: string;
  executable: string;
}): PonderSlotRef {
  return {
    slot: args.slot,
    schema: args.schema,
    commit: args.commit,
    executable: args.executable,
  };
}

function refuseProbeFailed(
  actions: PlanAction[],
  target: string,
): PlanResult {
  actions.push({
    type: "evidence",
    text: `deploy_observation_failed: ${target}`,
  });
  actions.push({ type: "exit", code: 1 });
  return { actions };
}

function refuseInvalid(
  actions: PlanAction[],
  detail: string,
): PlanResult {
  actions.push({
    type: "evidence",
    text: `deploy_state_invalid: ${detail}`,
  });
  actions.push({ type: "exit", code: 1 });
  return { actions };
}

function blockedRollbackModel(
  actions: PlanAction[],
  pendingSchema: string,
): PlanResult {
  actions.push({
    type: "evidence",
    text: "deploy_switch_blocked: rollback_model_unset",
  });
  actions.push({
    type: "evidence",
    text: `deploy_evidence switch=pending schema=${pendingSchema}`,
  });
  actions.push({ type: "exit", code: 0 });
  return { actions };
}

function pendingEvidenceExit(
  actions: PlanAction[],
  pending: PonderSlotRef,
): PlanResult {
  actions.push({
    type: "evidence",
    text: `deploy_evidence switch=pending schema=${pending.schema}`,
  });
  actions.push({
    type: "evidence",
    text: `deploy_evidence slot=${pending.slot}`,
  });
  actions.push({ type: "exit", code: 0 });
  return { actions };
}

function emitNginxRecreate(
  actions: PlanAction[],
  state: PonderDeployState,
  observations: PonderDeployObservations,
): PonderDeployState {
  actions.push({ type: "recreate_nginx" });
  actions.push({
    type: "evidence",
    text: "deploy_evidence proxy=recreated",
  });
  return {
    ...state,
    nginx_config_digest: observations.nginxConfigDigest,
  };
}

function emitWaitNewSlot(args: {
  actions: PlanAction[];
  slot: PonderDeploySlot;
  schema: string;
}): void {
  const { actions, slot, schema } = args;
  actions.push({
    type: "wait_answered",
    target: "slot",
    slot,
    timeoutMs: ANSWERED_TIMEOUT_MS,
    onTimeout: "tear_down_new",
    failEvidence: "ponder_did_not_become_ready",
  });
  actions.push({
    type: "wait_ready200",
    target: "slot",
    slot,
    schema,
    timeoutMs: READY200_TIMEOUT_MS,
    onTimeout: "pending_exit0",
  });
}

function emitSupersedePending(
  actions: PlanAction[],
  pending: PonderSlotRef,
): void {
  actions.push({ type: "stop_slot", slot: pending.slot });
  actions.push({ type: "drop_schema", schema: pending.schema });
}

/**
 * Plan the next deploy operation. State must already be loaded and phase-reconciled
 * (A2 is shell). Observations use typed probes (A3).
 */
export function planPonderDeploy(args: {
  state: PonderDeployState;
  operation: PonderDeployOperation;
  deploySha: string;
  observations: PonderDeployObservations;
}): PlanResult {
  const { state, operation, observations } = args;
  const deploySha = (args.deploySha || observations.deploySha).toLowerCase();
  const deployCommit = (observations.deployCommit || deploySha).toLowerCase();
  const actions: PlanAction[] = [];
  const schema = schemaNameForDeploySha(deploySha);

  actions.push({
    type: "evidence",
    text: `deploy_evidence operation=${operation}`,
  });

  // A9: push must not start or finish the first cutover.
  if (state.phase === "pre_cutover" && !mayMutatePreCutover(observations.eventName)) {
    actions.push({
      type: "evidence",
      text: "deploy_evidence cutover=awaiting_dispatch",
    });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  // A3: probe_failed refuses before any mutation.
  for (const target of ["blue", "green", "nginx"] as const) {
    const probe = observations.ready[target];
    if (probe.kind === "probe_failed") {
      return refuseProbeFailed(actions, target);
    }
  }

  // --- rollback ---
  if (operation === "rollback") {
    return planRollback({ state, observations, actions });
  }

  let working: PonderDeployState = { ...state };

  // B9: nginx digest drift is independent of executable. Proxy-only when
  // executable unchanged (post-cutover); otherwise recreate continues into start.
  const nginxDrift =
    working.phase === "post_cutover" && nginxConfigChanged(working, observations);

  const unchanged = executableUnchanged(working, observations);

  // Same-commit live collision (§a)
  if (unchanged && working.live?.schema === schema) {
    if (nginxDrift) {
      working = emitNginxRecreate(actions, working, observations);
      actions.push({ type: "write_state", state: working });
      actions.push({ type: "probe_answered", target: "nginx" });
      actions.push({ type: "exit", code: 0 });
      return { actions };
    }
    actions.push({
      type: "evidence",
      text: "deploy_evidence outcome=unchanged",
    });
    actions.push({
      type: "evidence",
      text: `deploy_evidence schema=${schema}`,
    });
    actions.push({
      type: "evidence",
      text: "deploy_evidence reason=live_schema",
    });
    actions.push({
      type: "evidence",
      text: `deploy_evidence executable=${liveExecutableDigest(working, observations)}`,
    });
    actions.push({
      type: "evidence",
      text: `deploy_evidence slot=${working.live.slot}`,
    });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  // Proxy-only recreate when executable unchanged (post-cutover).
  if (unchanged && working.phase === "post_cutover" && !working.pending) {
    if (nginxDrift) {
      working = emitNginxRecreate(actions, working, observations);
      actions.push({ type: "write_state", state: working });
      actions.push({ type: "probe_answered", target: "nginx" });
      actions.push({ type: "exit", code: 0 });
      return { actions };
    }
    actions.push({
      type: "evidence",
      text: "deploy_evidence outcome=unchanged",
    });
    actions.push({
      type: "evidence",
      text: `deploy_evidence executable=${liveExecutableDigest(working, observations)}`,
    });
    actions.push({ type: "probe_answered", target: "nginx" });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  if (nginxDrift) {
    working = emitNginxRecreate(actions, working, observations);
  }

  // Pending precedence (§d) — post-cutover
  if (working.phase === "post_cutover" && working.pending) {
    const pendingProbe = probeOf(observations, working.pending.slot);
    if (isReady200(pendingProbe)) {
      if (operation === "hold") {
        return pendingEvidenceExit(actions, working.pending);
      }
      if (working.rollback_model === null) {
        return blockedRollbackModel(actions, working.pending.schema);
      }
      const continueStart =
        observations.executableDigest !== working.pending.executable;
      return planSwitchPendingThenMaybeStart({
        state: working,
        observations,
        actions,
        operation,
        deploySha,
        deployCommit,
        schema,
        continueStart,
      });
    }
    // Not ready
    if (unchanged || operation === "hold") {
      return pendingEvidenceExit(actions, working.pending);
    }
    if (working.pending.schema === schema) {
      // Same pending schema still backfilling — wait, do not supersede.
      emitWaitNewSlot({
        actions,
        slot: working.pending.slot,
        schema,
      });
      return pendingEvidenceExit(actions, working.pending);
    }
    // Supersede not-ready pending before new start (A3: only not-ready, not probe_failed)
    if (isNotReady(pendingProbe)) {
      emitSupersedePending(actions, working.pending);
      working = { ...working, pending: null };
    }
  }

  // Pre-cutover pending already started → finish or wait
  if (working.phase === "pre_cutover" && working.pending) {
    const pendingProbe = probeOf(observations, working.pending.slot);
    if (operation === "hold") {
      return pendingEvidenceExit(actions, working.pending);
    }
    if (working.rollback_model === null) {
      return blockedRollbackModel(actions, working.pending.schema);
    }
    if (isReady200(pendingProbe)) {
      return planFirstCutoverSwitch({
        state: working,
        observations,
        actions,
        pending: working.pending,
        model: working.rollback_model,
      });
    }
    if (working.pending.schema === schema) {
      emitWaitNewSlot({
        actions,
        slot: working.pending.slot,
        schema,
      });
      return pendingEvidenceExit(actions, working.pending);
    }
    // Stale pre-cutover pending of another commit — supersede like any not-ready (A7)
    if (isNotReady(pendingProbe)) {
      emitSupersedePending(actions, working.pending);
      working = { ...working, pending: null };
    }
  }

  // Executable unchanged after pending handling (e.g. switched nothing, no start)
  if (unchanged && working.phase === "post_cutover") {
    actions.push({
      type: "evidence",
      text: "deploy_evidence outcome=unchanged",
    });
    actions.push({
      type: "evidence",
      text: `deploy_evidence executable=${liveExecutableDigest(working, observations)}`,
    });
    actions.push({ type: "probe_answered", target: "nginx" });
    if (nginxDrift) {
      actions.push({ type: "write_state", state: working });
    }
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  // Same-commit live: recreate that single deployment in place (§a)
  if (working.live?.schema === schema) {
    return planInPlaceRecreate({
      state: working,
      observations,
      actions,
      deployCommit,
      schema,
    });
  }

  if (working.phase === "pre_cutover") {
    return planFirstCutoverStart({
      state: working,
      observations,
      actions,
      operation,
      deploySha,
      deployCommit,
      schema,
      startSlot: "blue",
    });
  }

  return planNormalStart({
    state: working,
    observations,
    actions,
    operation,
    deploySha,
    deployCommit,
    schema,
  });
}

function planRollback(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
}): PlanResult {
  const { state, observations, actions } = args;

  // A8: first-cutover rollback — previous is null; legacy_* restore the table writer.
  if (
    state.phase === "post_cutover" &&
    state.live !== null &&
    state.previous === null &&
    state.legacy_schema !== null
  ) {
    return planFirstCutoverRollback({ state, observations, actions });
  }

  if (state.phase === "pre_cutover" || !state.live || !state.previous) {
    actions.push({
      type: "evidence",
      text: "deploy_rollback_failed: no previous spare",
    });
    actions.push({ type: "exit", code: 1 });
    return { actions };
  }

  const model = state.rollback_model;
  if (model === null) {
    return blockedRollbackModel(actions, state.live.schema);
  }

  let working: PonderDeployState = { ...state };

  // B5: rollback with pending → supersede pending first
  if (working.pending) {
    const pendingProbe = probeOf(observations, working.pending.slot);
    if (pendingProbe.kind === "probe_failed") {
      return refuseProbeFailed(actions, working.pending.slot);
    }
    emitSupersedePending(actions, working.pending);
    working = { ...working, pending: null };
  }

  const prev = working.previous!;
  const failed = working.live!;

  if (model === "keep_previous") {
    // B3: verify previous /ready 200 within 60s before flip
    actions.push({
      type: "wait_ready200",
      target: "slot",
      slot: prev.slot,
      schema: prev.schema,
      timeoutMs: ROLLBACK_READY_TIMEOUT_MS,
      onTimeout: "fail",
      failEvidence: "deploy_rollback_failed: waited 60s",
    });
    actions.push({
      type: "switch_views",
      targetSchema: prev.schema,
      kind: "normal",
      renameLiveTo: "kargain_views_prev",
    });
    actions.push({
      type: "write_upstream",
      slot: prev.slot,
      previousUpstream: failed.slot,
    });
    actions.push({ type: "reload_nginx" });
    actions.push({
      type: "wait_ready200",
      target: "nginx",
      schema: prev.schema,
      timeoutMs: ROLLBACK_READY_TIMEOUT_MS,
      onTimeout: "fail",
      failEvidence: "deploy_rollback_failed: waited 60s",
    });
    actions.push({ type: "stop_slot", slot: failed.slot });
    const nextState: PonderDeployState = {
      ...working,
      live: prev,
      previous: null,
      pending: null,
      // Rollback restores previously running code — keep prev digests (A6).
      identity: observations.identityDigest,
      executable: prev.executable,
      phase: "post_cutover",
    };
    actions.push(...applyRetention(nextState, observations.schemas));
    actions.push({ type: "write_state", state: nextState });
    actions.push({
      type: "evidence",
      text: `deploy_evidence slot=${prev.slot}`,
    });
    actions.push(
      ...successEvidence({
        schema: prev.schema,
        slot: prev.slot,
        rollbackModel: model,
      }),
    );
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  // restart_previous (B4): refuse unless image label matches previous.commit
  actions.push({
    type: "assert_slot_image_label",
    slot: prev.slot,
    commit: prev.commit,
    onMismatch: "deploy_rollback_failed: previous_image_mismatch",
  });
  actions.push({
    type: "write_slot_env",
    slot: prev.slot,
    schema: prev.schema,
  });
  actions.push({ type: "start_slot", slot: prev.slot });
  actions.push({
    type: "wait_ready200",
    target: "slot",
    slot: prev.slot,
    schema: prev.schema,
    timeoutMs: READY200_TIMEOUT_MS,
    onTimeout: "pending_exit0",
    failEvidence: "deploy_rollback_failed: waited 600s",
  });
  actions.push({
    type: "switch_views",
    targetSchema: prev.schema,
    kind: "normal",
    renameLiveTo: "kargain_views_prev",
  });
  actions.push({
    type: "write_upstream",
    slot: prev.slot,
    previousUpstream: failed.slot,
  });
  actions.push({ type: "reload_nginx" });
  actions.push({
    type: "wait_ready200",
    target: "nginx",
    schema: prev.schema,
    timeoutMs: ROLLBACK_READY_TIMEOUT_MS,
    onTimeout: "fail",
    failEvidence: "deploy_rollback_failed: waited 60s",
  });
  actions.push({ type: "stop_slot", slot: failed.slot });
  {
    const nextState: PonderDeployState = {
      ...working,
      live: prev,
      previous: null,
      pending: null,
      identity: observations.identityDigest,
      executable: prev.executable,
      phase: "post_cutover",
    };
    actions.push(...applyRetention(nextState, observations.schemas));
    actions.push({ type: "write_state", state: nextState });
    actions.push({
      type: "evidence",
      text: `deploy_evidence slot=${prev.slot}`,
    });
    actions.push(
      ...successEvidence({
        schema: prev.schema,
        slot: prev.slot,
        rollbackModel: model,
      }),
    );
  }
  actions.push({ type: "exit", code: 0 });
  return { actions };
}

function planFirstCutoverRollback(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
}): PlanResult {
  const { state, observations, actions } = args;
  const live = state.live!;
  const legacySchema = state.legacy_schema!;
  const legacyImage = state.legacy_image ?? observations.legacyImageId;
  if (!legacyImage) {
    return refuseInvalid(actions, "legacy_image_unknown");
  }

  // B5: supersede pending before rollback
  let working: PonderDeployState = { ...state };
  if (working.pending) {
    emitSupersedePending(actions, working.pending);
    working = { ...working, pending: null };
  }

  actions.push({ type: "stop_slot", slot: live.slot });
  actions.push({
    type: "switch_views",
    targetSchema: legacySchema,
    kind: "first_cutover_rollback",
    renameLiveTo: legacySchema,
  });
  actions.push({ type: "start_legacy_writer", image: legacyImage });
  actions.push({
    type: "write_upstream",
    slot: "legacy",
    previousUpstream: live.slot,
  });
  actions.push({ type: "reload_nginx" });

  const nextState: PonderDeployState = {
    ...working,
    live: null,
    previous: null,
    pending: null,
    // Back to fingerprints-only; legacy_* kept for a later cutover retry.
    identity: observations.identityDigest,
    executable: working.executable,
    legacy_schema: legacySchema,
    legacy_image: legacyImage,
    phase: "pre_cutover",
  };
  actions.push(...applyRetention(nextState, observations.schemas));
  actions.push({ type: "write_state", state: nextState });
  actions.push({
    type: "evidence",
    text: "deploy_evidence outcome=first_cutover_rollback",
  });
  actions.push({ type: "exit", code: 0 });
  return { actions };
}

function planSwitchPendingThenMaybeStart(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
  operation: PonderDeployOperation;
  deploySha: string;
  deployCommit: string;
  schema: string;
  continueStart: boolean;
}): PlanResult {
  const { state, observations, actions, continueStart } = args;
  const pending = state.pending!;
  const model = state.rollback_model!;

  const switched = appendNormalSwitch({
    actions,
    state,
    newLive: pending,
    observations,
    rollbackModel: model,
    exit: !continueStart,
  });

  if (!continueStart) {
    return { actions: switched.actions };
  }

  // A6: same run continues the start path for the newer commit (no continue_after evidence).
  return planNormalStart({
    state: switched.nextState,
    observations,
    actions: switched.actions,
    operation: args.operation,
    deploySha: args.deploySha,
    deployCommit: args.deployCommit,
    schema: args.schema,
  });
}

function appendNormalSwitch(args: {
  actions: PlanAction[];
  state: PonderDeployState;
  newLive: PonderSlotRef;
  observations: PonderDeployObservations;
  rollbackModel: PonderRollbackModel;
  exit: boolean;
}): { actions: PlanAction[]; nextState: PonderDeployState } {
  const { actions, state, newLive, observations, rollbackModel } = args;
  const previousLive = state.live;

  actions.push({
    type: "switch_views",
    targetSchema: newLive.schema,
    kind: "normal",
    renameLiveTo: "kargain_views_prev",
  });
  actions.push({
    type: "write_upstream",
    slot: newLive.slot,
    previousUpstream: previousLive?.slot ?? null,
  });
  actions.push({ type: "reload_nginx" });
  actions.push({
    type: "wait_ready200",
    target: "nginx",
    schema: newLive.schema,
    timeoutMs: ANSWERED_TIMEOUT_MS,
    onTimeout: "fail",
    failEvidence: "deploy_switch_failed: http",
  });

  if (rollbackModel === "restart_previous" && previousLive) {
    actions.push({ type: "stop_slot", slot: previousLive.slot });
  }

  // A6: record digests of code that is now live — never the incoming newer digest.
  const nextState: PonderDeployState = {
    ...state,
    live: newLive,
    previous: previousLive,
    pending: null,
    identity: observations.identityDigest,
    executable: newLive.executable,
    phase: "post_cutover",
  };

  actions.push(...applyRetention(nextState, observations.schemas));
  actions.push({ type: "write_state", state: nextState });
  actions.push({
    type: "evidence",
    text: "deploy_evidence outcome=recreated",
  });
  actions.push({
    type: "evidence",
    text: `deploy_evidence slot=${newLive.slot}`,
  });
  actions.push(
    ...successEvidence({
      schema: newLive.schema,
      slot: newLive.slot,
      rollbackModel,
    }),
  );
  if (args.exit) {
    actions.push({ type: "exit", code: 0 });
  }
  return { actions, nextState };
}

function planInPlaceRecreate(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
  deployCommit: string;
  schema: string;
}): PlanResult {
  const { state, observations, actions, deployCommit, schema } = args;
  const live = state.live!;
  actions.push({
    type: "write_slot_env",
    slot: live.slot,
    schema,
  });
  actions.push({
    type: "build_slot",
    slot: live.slot,
    label: deployCommit,
  });
  actions.push({ type: "preflight_slot", slot: live.slot });
  actions.push({ type: "start_slot", slot: live.slot });
  emitWaitNewSlot({ actions, slot: live.slot, schema });

  const newLive = slotRef({
    slot: live.slot,
    schema,
    commit: deployCommit,
    executable: observations.executableDigest,
  });
  const nextState: PonderDeployState = {
    ...state,
    live: newLive,
    pending: null,
    identity: observations.identityDigest,
    executable: observations.executableDigest,
    phase: "post_cutover",
  };
  actions.push({ type: "write_state", state: nextState });
  actions.push({
    type: "evidence",
    text: "deploy_evidence outcome=recreated",
  });
  actions.push({
    type: "evidence",
    text: `deploy_evidence slot=${live.slot}`,
  });
  actions.push({ type: "exit", code: 0 });
  return { actions };
}

function planNormalStart(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
  operation: PonderDeployOperation;
  deploySha: string;
  deployCommit: string;
  schema: string;
}): PlanResult {
  const {
    state,
    observations,
    actions,
    operation,
    deployCommit,
    schema,
  } = args;
  const startSlot = chooseStartSlot(state);

  // B5: starting on previous's slot clears previous in the same state write.
  let working: PonderDeployState = { ...state };
  if (working.previous?.slot === startSlot) {
    actions.push({ type: "stop_slot", slot: working.previous.slot });
    working = { ...working, previous: null };
  }

  actions.push({ type: "write_slot_env", slot: startSlot, schema });
  actions.push({
    type: "build_slot",
    slot: startSlot,
    label: deployCommit,
  });
  actions.push({ type: "preflight_slot", slot: startSlot });
  actions.push({ type: "start_slot", slot: startSlot });

  const pendingRef = slotRef({
    slot: startSlot,
    schema,
    commit: deployCommit,
    executable: observations.executableDigest,
  });
  // A6: do not write incoming executable onto state.executable until it is live.
  const pendingState: PonderDeployState = {
    ...working,
    pending: pendingRef,
    identity: observations.identityDigest,
    phase: "post_cutover",
  };
  actions.push({ type: "write_state", state: pendingState });
  actions.push({
    type: "evidence",
    text: `deploy_evidence slot=${startSlot}`,
  });

  emitWaitNewSlot({ actions, slot: startSlot, schema });

  if (operation === "hold") {
    return pendingEvidenceExit(actions, pendingRef);
  }

  if (working.rollback_model === null) {
    return blockedRollbackModel(actions, schema);
  }

  const switched = appendNormalSwitch({
    actions,
    state: pendingState,
    newLive: pendingRef,
    observations,
    rollbackModel: working.rollback_model,
    exit: true,
  });
  return { actions: switched.actions };
}

function planFirstCutoverStart(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
  operation: PonderDeployOperation;
  deploySha: string;
  deployCommit: string;
  schema: string;
  startSlot: PonderDeploySlot;
}): PlanResult {
  const {
    state,
    observations,
    actions,
    operation,
    deployCommit,
    schema,
    startSlot,
  } = args;

  // A7: legacy_schema set once; never overwrite. Absent prior + null → invalid.
  let legacySchema = state.legacy_schema;
  if (legacySchema === null) {
    if (observations.priorCheckoutSha === null) {
      return refuseInvalid(actions, "legacy_schema_unknown");
    }
    legacySchema = schemaNameForDeploySha(observations.priorCheckoutSha);
  }

  const legacyImage =
    state.legacy_image ?? observations.legacyImageId ?? null;
  if (legacyImage) {
    actions.push({
      type: "preserve_legacy_image",
      imageId: legacyImage,
    });
  }

  actions.push({ type: "write_slot_env", slot: startSlot, schema });
  actions.push({
    type: "build_slot",
    slot: startSlot,
    label: deployCommit,
  });
  actions.push({ type: "preflight_slot", slot: startSlot });
  actions.push({ type: "start_slot", slot: startSlot });

  const pendingRef = slotRef({
    slot: startSlot,
    schema,
    commit: deployCommit,
    executable: observations.executableDigest,
  });
  const pendingState: PonderDeployState = {
    ...state,
    pending: pendingRef,
    // A7: write legacy_schema only when it was null
    legacy_schema: legacySchema,
    legacy_image: legacyImage,
    identity: observations.identityDigest,
    // Still pre-cutover; executable stays the fingerprint skip digest, not pending.
    phase: "pre_cutover",
  };
  actions.push({ type: "write_state", state: pendingState });
  actions.push({
    type: "evidence",
    text: `deploy_evidence slot=${startSlot}`,
  });

  emitWaitNewSlot({ actions, slot: startSlot, schema });

  if (operation === "hold") {
    return pendingEvidenceExit(actions, pendingRef);
  }

  if (pendingState.rollback_model === null) {
    return blockedRollbackModel(actions, schema);
  }

  return planFirstCutoverSwitch({
    state: pendingState,
    observations,
    actions,
    pending: pendingRef,
    model: pendingState.rollback_model,
  });
}

function planFirstCutoverSwitch(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
  pending: PonderSlotRef;
  model: PonderRollbackModel;
}): PlanResult {
  const { state, observations, actions, pending, model } = args;
  const legacySchema = state.legacy_schema;
  if (legacySchema === null) {
    return refuseInvalid(actions, "legacy_schema_unknown");
  }

  const legacyImage =
    state.legacy_image ?? observations.legacyImageId ?? null;
  if (legacyImage && state.legacy_image === null) {
    actions.push({
      type: "preserve_legacy_image",
      imageId: legacyImage,
    });
  }

  // A7: rename target must not already exist
  actions.push({ type: "check_schema_absent", schema: legacySchema });
  actions.push({ type: "stop_legacy_writer" });
  actions.push({
    type: "switch_views",
    targetSchema: pending.schema,
    kind: "first_cutover",
    renameLiveTo: legacySchema,
  });
  actions.push({
    type: "write_upstream",
    slot: pending.slot,
    previousUpstream: "legacy",
  });
  actions.push({ type: "up_nginx" });
  actions.push({
    type: "wait_ready200",
    target: "nginx",
    schema: pending.schema,
    timeoutMs: ANSWERED_TIMEOUT_MS,
    onTimeout: "fail",
    failEvidence: "deploy_switch_failed: http",
  });

  // A8: previous = null — legacy rollback uses first_cutover_rollback, not keep_previous.
  const nextState: PonderDeployState = {
    identity: observations.identityDigest,
    executable: pending.executable,
    live: pending,
    previous: null,
    pending: null,
    rollback_model: model,
    lag: state.lag,
    legacy_schema: legacySchema,
    legacy_image: legacyImage,
    nginx_config_digest: observations.nginxConfigDigest,
    phase: "post_cutover",
  };

  actions.push(...applyRetention(nextState, observations.schemas));
  actions.push({ type: "write_state", state: nextState });
  actions.push({
    type: "evidence",
    text: "deploy_evidence outcome=recreated",
  });
  actions.push({
    type: "evidence",
    text: `deploy_evidence slot=${pending.slot}`,
  });
  actions.push(
    ...successEvidence({
      schema: pending.schema,
      slot: pending.slot,
      rollbackModel: model,
    }),
  );
  actions.push({ type: "exit", code: 0 });
  return { actions };
}

/** Hold must never emit a views/HTTP switch (ADR §d / hold). */
export function planNeverSwitchesOnHold(result: PlanResult): boolean {
  return !result.actions.some(
    (a) =>
      a.type === "switch_views" ||
      a.type === "reload_nginx" ||
      a.type === "up_nginx" ||
      a.type === "write_upstream",
  );
}
