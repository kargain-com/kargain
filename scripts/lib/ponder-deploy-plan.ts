/**
 * Pure deploy planner (ADR 0014 §a/d/e/f/j / issue #69 / PR #71).
 * Sole encoder of collision, pending precedence, start≠switch, rollback models,
 * retention, first cutover (incl. an interrupted one), and typed probe refusal.
 * Imports only Node builtins + ./ponder-deploy-state.js + ./ponder-deploy-retention.js.
 */
import type {
  PonderDeploySlot,
  PonderDeployState,
  PonderRollbackModel,
  PonderSlotRef,
} from "./ponder-deploy-state.js";
import { schemaNameForDeploySha } from "./ponder-deploy-state.js";
import {
  keepSetFromState,
  retentionSchemasToDrop,
} from "./ponder-deploy-retention.js";

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
  /** GitHub event (A9 / R8). The executor refuses any other value. */
  eventName: "push" | "workflow_dispatch";
  /** Running legacy ponder image id before cutover (A8). */
  legacyImageId: string | null;
  /**
   * DB fact: schema kargain holds base tables (relkind r|p).
   * Plan CLI reconciles phase from this (A1); not a file flag.
   */
  kargainHasBaseTables: boolean;
  /**
   * DB fact (R1): the one schema the kargain views read from
   * (information_schema.view_table_usage); null when kargain has no views.
   */
  kargainViewsTarget: string | null;
  /**
   * Container that writes schema kargain before cutover (R2): the pre-#71 `ponder`
   * service, or `ponder-legacy` after a first-cutover rollback; null when none runs.
   */
  kargainWriter: KargainWriter | null;
};

export type KargainWriter = "ponder" | "ponder-legacy";

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
  | { type: "stop_legacy_writer"; writer: KargainWriter }
  | {
      type: "preserve_legacy_image";
      imageId: string;
    }
  | { type: "remove_legacy_image_tag" }
  | {
      type: "start_legacy_writer";
      /** state.legacy_image — the tag must resolve to exactly this image (R5). */
      image: string;
    }
  | {
      type: "wait_answered";
      target: "slot" | "nginx" | "legacy";
      slot?: PonderDeploySlot;
      timeoutMs: number;
      /** On fail: shell stops new, drops schema, clears pending, exits 1 (B7). */
      onTimeout: "tear_down_new" | "fail";
      failEvidence?: string;
    }
  | {
      type: "wait_ready200";
      target: "slot" | "nginx" | "legacy";
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
const LEGACY_ANSWERED_WAIT = `deploy_rollback_failed: waited ${ANSWERED_TIMEOUT_MS / 1000}s`;
const LEGACY_READY_WAIT = `deploy_rollback_failed: waited ${READY200_TIMEOUT_MS / 1000}s`;

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

function mayMutatePreCutover(eventName: string): boolean {
  return eventName === "workflow_dispatch";
}

function probeEvidence(probe: ProbeObservation): string {
  if (probe.kind === "status") {
    return `deploy_evidence pending_probe=status code=${probe.code}`;
  }
  return `deploy_evidence pending_probe=${probe.kind}`;
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
  const drop = retentionSchemasToDrop(schemas, keepSetFromState(state));
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
  /** Observed probe of an existing pending (R7); absent for a slot started this run. */
  probe?: ProbeObservation,
): PlanResult {
  actions.push({
    type: "evidence",
    text: `deploy_evidence switch=pending schema=${pending.schema}`,
  });
  if (probe) {
    actions.push({ type: "evidence", text: probeEvidence(probe) });
  }
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

/**
 * Wait for a slot STARTED IN THIS RUN. Teardown (stop + drop schema + clear pending)
 * applies only to that slot (ADR §d table, R7); an existing pending is never waited
 * on here — it is reported with its observed probe and nothing is dropped.
 * `teardown: false` is for the in-place recreate of the live schema: never dropped.
 */
function emitWaitStartedSlot(args: {
  actions: PlanAction[];
  slot: PonderDeploySlot;
  schema: string;
  teardown: boolean;
}): void {
  const { actions, slot, schema, teardown } = args;
  actions.push({
    type: "wait_answered",
    target: "slot",
    slot,
    timeoutMs: ANSWERED_TIMEOUT_MS,
    onTimeout: teardown ? "tear_down_new" : "fail",
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

/**
 * Supersede: stop the pending writer, record pending=null, THEN drop its schema, so the
 * keep set the executor reads from the state file at execution no longer holds it (R9).
 */
function emitSupersedePending(
  actions: PlanAction[],
  state: PonderDeployState,
): PonderDeployState {
  const pending = state.pending!;
  const next: PonderDeployState = { ...state, pending: null };
  actions.push({ type: "stop_slot", slot: pending.slot });
  actions.push({ type: "write_state", state: next });
  actions.push({ type: "drop_schema", schema: pending.schema });
  return next;
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

  // A9: push must not start or finish the first cutover (an interrupted one included).
  if (
    (state.phase === "pre_cutover" ||
      state.phase === "first_cutover_interrupted") &&
    !mayMutatePreCutover(observations.eventName)
  ) {
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

  // R1: the views transaction committed but the HTTP half never wrote state.
  if (state.phase === "first_cutover_interrupted") {
    return planResumeFirstCutover({ state, observations, actions, operation });
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

  // Pending precedence (§d) — both phases.
  if (working.pending) {
    const handled = planExistingPending({
      state: working,
      observations,
      actions,
      operation,
      deploySha,
      deployCommit,
      schema,
    });
    if ("actions" in handled) return handled;
    working = handled.state;
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

/**
 * Pending precedence (ADR §d, R6/R7), identical in both phases.
 * - ready 200: switch it first (rollback_model gate only here, at the switch);
 * - not ready, same executable as the incoming run: re-assert switch=pending with the
 *   observed probe kind; nothing is waited on, dropped, or torn down;
 * - not ready, incoming executable differs: supersede (stop, clear, drop) and let the
 *   caller start the incoming commit — for hold and deploy alike.
 */
function planExistingPending(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
  operation: PonderDeployOperation;
  deploySha: string;
  deployCommit: string;
  schema: string;
}): PlanResult | { state: PonderDeployState } {
  const { state, observations, actions, operation } = args;
  const pending = state.pending!;
  const probe = probeOf(observations, pending.slot);

  if (isReady200(probe)) {
    if (operation === "hold") {
      return pendingEvidenceExit(actions, pending, probe);
    }
    if (state.rollback_model === null) {
      return blockedRollbackModel(actions, pending.schema);
    }
    if (state.phase === "pre_cutover") {
      return planFirstCutoverSwitch({
        state,
        observations,
        actions,
        pending,
        model: state.rollback_model,
      });
    }
    return planSwitchPendingThenMaybeStart({
      state,
      observations,
      actions,
      operation,
      deploySha: args.deploySha,
      deployCommit: args.deployCommit,
      schema: args.schema,
      continueStart: observations.executableDigest !== pending.executable,
    });
  }

  if (observations.executableDigest === pending.executable) {
    return pendingEvidenceExit(actions, pending, probe);
  }
  return { state: emitSupersedePending(actions, state) };
}

function planRollback(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
}): PlanResult {
  const { state, observations, actions } = args;

  // A8 / R4: first-cutover rollback only while the first-cutover deployment is live
  // (any later switch clears legacy_schema) AND the legacy schema still exists.
  const legacyRollbackValid =
    state.legacy_schema !== null &&
    observations.schemas.includes(state.legacy_schema);
  if (
    legacyRollbackValid &&
    (state.phase === "first_cutover_interrupted" ||
      (state.phase === "post_cutover" &&
        state.live !== null &&
        state.previous === null))
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
    working = emitSupersedePending(actions, working);
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
    actions.push({ type: "write_state", state: nextState });
    actions.push(...applyRetention(nextState, observations.schemas));
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
    actions.push({ type: "write_state", state: nextState });
    actions.push(...applyRetention(nextState, observations.schemas));
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

/**
 * First-cutover rollback (ADR §j, R3/R4): stop the new writer, restore the table schema
 * `kargain`, record that fact in state, start the legacy writer from the preserved image,
 * and flip HTTP only after the legacy writer answered and is /ready 200. On a gate
 * timeout the run fails (`deploy_rollback_failed: waited <n>s`) and leaves views and
 * upstream as they are.
 */
function planFirstCutoverRollback(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
}): PlanResult {
  const { state, observations, actions } = args;
  const interrupted = state.phase === "first_cutover_interrupted";
  // Interrupted: the views already read pending; state.live is still null.
  const newWriter = interrupted ? state.pending! : state.live!;
  const legacySchema = state.legacy_schema!;
  const legacyImage = state.legacy_image;
  if (!legacyImage) {
    actions.push({
      type: "evidence",
      text: "deploy_rollback_failed: legacy_image_missing",
    });
    actions.push({ type: "exit", code: 1 });
    return { actions };
  }

  // B5: supersede pending before rollback
  let working: PonderDeployState = { ...state };
  if (!interrupted && working.pending) {
    working = emitSupersedePending(actions, working);
  }

  actions.push({ type: "stop_slot", slot: newWriter.slot });
  actions.push({
    type: "switch_views",
    targetSchema: legacySchema,
    kind: "first_cutover_rollback",
    renameLiveTo: legacySchema,
  });

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
  // The views transaction committed: state agrees with the database before the legacy
  // writer is gated, so a gate timeout leaves a recoverable (pre-cutover) state.
  actions.push({ type: "write_state", state: nextState });
  actions.push({ type: "start_legacy_writer", image: legacyImage });
  actions.push({
    type: "wait_answered",
    target: "legacy",
    timeoutMs: ANSWERED_TIMEOUT_MS,
    onTimeout: "fail",
    failEvidence: LEGACY_ANSWERED_WAIT,
  });
  actions.push({
    type: "wait_ready200",
    target: "legacy",
    schema: legacySchema,
    timeoutMs: READY200_TIMEOUT_MS,
    onTimeout: "fail",
    failEvidence: LEGACY_READY_WAIT,
  });
  actions.push({
    type: "write_upstream",
    slot: "legacy",
    previousUpstream: newWriter.slot,
  });
  actions.push({ type: "reload_nginx" });
  actions.push(...applyRetention(nextState, observations.schemas));
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
  // R4: this switch lets retention drop the first-cutover spare (live is no longer the
  // first-cutover deployment), so legacy_schema/legacy_image are cleared in the same
  // state write and the preserved image tag is removed.
  const clearsLegacy =
    state.legacy_schema !== null || state.legacy_image !== null;
  const nextState: PonderDeployState = {
    ...state,
    live: newLive,
    previous: previousLive,
    pending: null,
    identity: observations.identityDigest,
    executable: newLive.executable,
    legacy_schema: null,
    legacy_image: null,
    phase: "post_cutover",
  };

  // State first: the retention executor reads its keep set from the state file (R9).
  actions.push({ type: "write_state", state: nextState });
  actions.push(...applyRetention(nextState, observations.schemas));
  if (clearsLegacy) {
    actions.push({ type: "remove_legacy_image_tag" });
  }
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
  // The recreated schema IS the live schema: a missing answer fails, never tears down.
  emitWaitStartedSlot({ actions, slot: live.slot, schema, teardown: false });

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

  emitWaitStartedSlot({ actions, slot: startSlot, schema, teardown: true });

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

  emitWaitStartedSlot({ actions, slot: startSlot, schema, teardown: true });

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
  // R2: stop exactly the observed writer of kargain (ponder, or ponder-legacy after a
  // first-cutover rollback). No observed writer → nothing to stop, named.
  if (observations.kargainWriter === null) {
    actions.push({
      type: "evidence",
      text: "deploy_evidence legacy_writer=none",
    });
  } else {
    actions.push({
      type: "stop_legacy_writer",
      writer: observations.kargainWriter,
    });
  }
  actions.push({
    type: "switch_views",
    targetSchema: pending.schema,
    kind: "first_cutover",
    renameLiveTo: legacySchema,
  });
  return finishFirstCutover({
    state,
    observations,
    actions,
    pending,
    model,
    legacySchema,
    legacyImage,
  });
}

/**
 * R1: the views transaction committed, state.live is still null. Resume the HTTP half
 * (upstream → nginx → 200 gate → state) of the first cutover.
 */
function planResumeFirstCutover(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
  operation: PonderDeployOperation;
}): PlanResult {
  const { state, observations, actions, operation } = args;
  const pending = state.pending!;
  if (operation === "hold") {
    // hold never switches; the switch already happened — report, change nothing.
    actions.push({
      type: "evidence",
      text: "deploy_evidence cutover=interrupted",
    });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }
  if (state.rollback_model === null) {
    return refuseInvalid(actions, "interrupted_first_cutover: rollback_model unset");
  }
  if (state.legacy_schema === null) {
    return refuseInvalid(actions, "legacy_schema_unknown");
  }
  actions.push({
    type: "evidence",
    text: "deploy_evidence cutover=resumed",
  });
  return finishFirstCutover({
    state,
    observations,
    actions,
    pending,
    model: state.rollback_model,
    legacySchema: state.legacy_schema,
    legacyImage: state.legacy_image ?? observations.legacyImageId ?? null,
  });
}

/** First-cutover HTTP half + state write (shared by the full run and the resume). */
function finishFirstCutover(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
  pending: PonderSlotRef;
  model: PonderRollbackModel;
  legacySchema: string;
  legacyImage: string | null;
}): PlanResult {
  const { state, observations, actions, pending, model } = args;
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
    legacy_schema: args.legacySchema,
    legacy_image: args.legacyImage,
    nginx_config_digest: observations.nginxConfigDigest,
    phase: "post_cutover",
  };

  actions.push({ type: "write_state", state: nextState });
  actions.push(...applyRetention(nextState, observations.schemas));
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
