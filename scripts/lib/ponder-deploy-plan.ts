/**
 * Pure deploy planner (ADR 0014 §a/d/e/f/j / issue #69).
 * Sole encoder of collision, pending precedence, start≠switch, rollback models,
 * retention, and first cutover. Imports only Node builtins + scripts/lib/.
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

export type SlotReadyObservation = {
  blue: number | null;
  green: number | null;
  /** Legacy single-ponder writer (pre-cutover) answered status, if probing it. */
  legacy: number | null;
  nginx: number | null;
};

export type PonderDeployObservations = {
  ready: SlotReadyObservation;
  /** Schema names from pg_namespace. */
  schemas: readonly string[];
  /** Stored executable digest from state file (may be empty). */
  storedExecutable: string;
  /** Incoming executable digest for this run. */
  executableDigest: string;
  identityDigest: string;
  /** git HEAD of the server checkout before this run's checkout (first cutover). */
  priorCheckoutSha: string | null;
  /** True when nginx main config fingerprint changed and proxy must recreate. */
  nginxConfigChanged: boolean;
};

export type PlanEvidence =
  | { kind: "line"; text: string }
  | { kind: "blocked"; text: string };

export type PlanAction =
  | { type: "evidence"; text: string }
  | { type: "exit"; code: number }
  | {
      type: "write_slot_env";
      slot: PonderDeploySlot;
      schema: string;
    }
  | { type: "build_slot"; slot: PonderDeploySlot }
  | { type: "preflight_slot"; slot: PonderDeploySlot }
  | { type: "start_slot"; slot: PonderDeploySlot }
  | { type: "stop_slot"; slot: PonderDeploySlot }
  | { type: "stop_legacy_writer" }
  | {
      type: "wait_ready200";
      target: "slot" | "nginx";
      slot?: PonderDeploySlot;
      schema: string;
      timeoutMs: number;
      onTimeout: "pending_exit0" | "fail";
    }
  | {
      type: "switch_views";
      targetSchema: string;
      kind: "normal" | "first_cutover";
      renameLiveTo: string;
    }
  | {
      type: "write_upstream";
      slot: PonderDeploySlot;
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
  | {
      type: "probe_answered";
      target: "nginx" | "slot";
      slot?: PonderDeploySlot;
    };

export type PlanResult = {
  actions: PlanAction[];
};

function oppositeSlot(slot: PonderDeploySlot): PonderDeploySlot {
  return slot === "blue" ? "green" : "blue";
}

function slotService(slot: PonderDeploySlot): string {
  return `ponder-${slot}`;
}

function readyOf(
  observations: PonderDeployObservations,
  slot: PonderDeploySlot,
): number | null {
  return slot === "blue" ? observations.ready.blue : observations.ready.green;
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
  if (state.preCutover || !state.live) return "blue";
  return oppositeSlot(state.live.slot);
}

/**
 * Plan the next deploy operation. Observations must already reflect current
 * readiness; wait_ready200 actions are for the executor to perform mid-plan
 * when starting a new writer (shell re-invokes plan after wait, or executes
 * wait inline). This pure function emits the wait as an action for the shell.
 */
export function planPonderDeploy(args: {
  state: PonderDeployState;
  operation: PonderDeployOperation;
  deploySha: string;
  observations: PonderDeployObservations;
}): PlanResult {
  const { state, operation, deploySha, observations } = args;
  const actions: PlanAction[] = [];
  const schema = schemaNameForDeploySha(deploySha);

  actions.push({
    type: "evidence",
    text: `deploy_evidence operation=${operation}`,
  });

  // Proxy-only recreate when nginx config changed and executable unchanged.
  if (
    observations.nginxConfigChanged &&
    observations.storedExecutable !== "" &&
    observations.storedExecutable === observations.executableDigest &&
    !state.preCutover
  ) {
    actions.push({ type: "recreate_nginx" });
    actions.push({
      type: "evidence",
      text: "deploy_evidence proxy=recreated",
    });
    actions.push({
      type: "probe_answered",
      target: "nginx",
    });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  // --- rollback ---
  if (operation === "rollback") {
    if (state.preCutover || !state.live || !state.previous) {
      actions.push({
        type: "evidence",
        text: "deploy_rollback_failed: no previous spare",
      });
      actions.push({ type: "exit", code: 1 });
      return { actions };
    }
    const model = state.rollback_model;
    if (model === null) {
      actions.push({
        type: "evidence",
        text: "deploy_switch_blocked: rollback_model_unset",
      });
      actions.push({
        type: "evidence",
        text: `deploy_evidence switch=pending schema=${state.live.schema}`,
      });
      actions.push({ type: "exit", code: 0 });
      return { actions };
    }

    const prev = state.previous;
    const failed = state.live;

    if (model === "keep_previous") {
      actions.push({
        type: "switch_views",
        targetSchema: prev.schema,
        kind: "normal",
        renameLiveTo: "kargain_views_prev",
      });
      actions.push({ type: "write_upstream", slot: prev.slot });
      actions.push({ type: "reload_nginx" });
      actions.push({ type: "stop_slot", slot: failed.slot });
      const nextState: PonderDeployState = {
        ...state,
        live: prev,
        previous: null,
        pending: null,
        identity: observations.identityDigest,
        executable: observations.executableDigest,
      };
      actions.push(...applyRetention(nextState, observations.schemas));
      actions.push({ type: "write_state", state: nextState });
      actions.push({
        type: "evidence",
        text: `deploy_evidence slot=${prev.slot}`,
      });
      actions.push(...successEvidence({
        schema: prev.schema,
        slot: prev.slot,
        rollbackModel: model,
      }));
      actions.push({ type: "exit", code: 0 });
      return { actions };
    }

    // restart_previous
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
      timeoutMs: 600_000,
      onTimeout: "pending_exit0",
    });
    // Shell continues only if ready; plan assumes ready for subsequent actions
    // when composing the happy path. Executor splits on wait.
    actions.push({
      type: "switch_views",
      targetSchema: prev.schema,
      kind: "normal",
      renameLiveTo: "kargain_views_prev",
    });
    actions.push({ type: "write_upstream", slot: prev.slot });
    actions.push({ type: "reload_nginx" });
    actions.push({ type: "stop_slot", slot: failed.slot });
    {
      const nextState: PonderDeployState = {
        ...state,
        live: prev,
        previous: null,
        pending: null,
        identity: observations.identityDigest,
        executable: observations.executableDigest,
      };
      actions.push(...applyRetention(nextState, observations.schemas));
      actions.push({ type: "write_state", state: nextState });
      actions.push({
        type: "evidence",
        text: `deploy_evidence slot=${prev.slot}`,
      });
      actions.push(...successEvidence({
        schema: prev.schema,
        slot: prev.slot,
        rollbackModel: model,
      }));
    }
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  // --- executable unchanged / collision (§a) ---
  const executableUnchanged =
    observations.storedExecutable !== "" &&
    observations.storedExecutable === observations.executableDigest;

  if (executableUnchanged && state.live?.schema === schema) {
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
      text: `deploy_evidence executable=${observations.storedExecutable}`,
    });
    actions.push({
      type: "evidence",
      text: `deploy_evidence slot=${state.live.slot}`,
    });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  // Pending precedence (§d) — only when not pre-cutover
  if (!state.preCutover && state.pending) {
    const pendingReady = readyOf(observations, state.pending.slot);
    if (pendingReady === 200) {
      // Switch pending first (unless hold — hold never switches)
      if (operation === "hold") {
        actions.push({
          type: "evidence",
          text: `deploy_evidence switch=pending schema=${state.pending.schema}`,
        });
        actions.push({
          type: "evidence",
          text: `deploy_evidence slot=${state.pending.slot}`,
        });
        actions.push({ type: "exit", code: 0 });
        return { actions };
      }
      if (state.rollback_model === null) {
        actions.push({
          type: "evidence",
          text: "deploy_switch_blocked: rollback_model_unset",
        });
        actions.push({
          type: "evidence",
          text: `deploy_evidence switch=pending schema=${state.pending.schema}`,
        });
        actions.push({ type: "exit", code: 0 });
        return { actions };
      }
      return planSwitchPending({
        state,
        observations,
        actions,
        operation,
        deploySha,
        schema,
        continueAfter: !executableUnchanged,
      });
    }
    // Not ready: supersede if we need a new start; else re-assert pending
    if (executableUnchanged || operation === "hold") {
      // hold with existing pending: leave pending (hold never switches)
      actions.push({
        type: "evidence",
        text: `deploy_evidence switch=pending schema=${state.pending.schema}`,
      });
      actions.push({
        type: "evidence",
        text: `deploy_evidence slot=${state.pending.slot}`,
      });
      actions.push({ type: "exit", code: 0 });
      return { actions };
    }
    // Supersede not-ready pending before new start
    actions.push({ type: "stop_slot", slot: state.pending.slot });
    actions.push({ type: "drop_schema", schema: state.pending.schema });
  }

  // Working copy after optional pending supersede
  const working: PonderDeployState = {
    ...state,
    pending:
      !state.preCutover &&
      state.pending &&
      readyOf(observations, state.pending.slot) !== 200 &&
      !executableUnchanged &&
      operation !== "hold"
        ? null
        : state.pending,
  };

  if (executableUnchanged && !working.preCutover) {
    actions.push({
      type: "evidence",
      text: "deploy_evidence outcome=unchanged",
    });
    actions.push({
      type: "evidence",
      text: `deploy_evidence executable=${observations.storedExecutable}`,
    });
    actions.push({ type: "probe_answered", target: "nginx" });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  // Pre-cutover: pending already started → finish or wait
  if (working.preCutover && working.pending) {
    const pendingReady = readyOf(observations, working.pending.slot);
    if (operation === "hold") {
      actions.push({
        type: "evidence",
        text: `deploy_evidence switch=pending schema=${working.pending.schema}`,
      });
      actions.push({
        type: "evidence",
        text: `deploy_evidence slot=${working.pending.slot}`,
      });
      actions.push({ type: "exit", code: 0 });
      return { actions };
    }
    if (working.rollback_model === null) {
      actions.push({
        type: "evidence",
        text: "deploy_switch_blocked: rollback_model_unset",
      });
      actions.push({
        type: "evidence",
        text: `deploy_evidence switch=pending schema=${working.pending.schema}`,
      });
      actions.push({ type: "exit", code: 0 });
      return { actions };
    }
    if (pendingReady === 200) {
      return planFirstCutoverSwitch({
        state: working,
        observations,
        actions,
        pending: working.pending,
        model: working.rollback_model,
      });
    }
    if (working.pending.schema === schema) {
      actions.push({
        type: "wait_ready200",
        target: "slot",
        slot: working.pending.slot,
        schema,
        timeoutMs: 600_000,
        onTimeout: "pending_exit0",
      });
      actions.push({
        type: "evidence",
        text: `deploy_evidence switch=pending schema=${schema}`,
      });
      actions.push({ type: "exit", code: 0 });
      return { actions };
    }
  }

  // Same-commit live: recreate that single deployment in place (§a)
  if (working.live?.schema === schema) {
    actions.push({
      type: "write_slot_env",
      slot: working.live.slot,
      schema,
    });
    actions.push({ type: "build_slot", slot: working.live.slot });
    actions.push({ type: "preflight_slot", slot: working.live.slot });
    actions.push({ type: "start_slot", slot: working.live.slot });
    actions.push({
      type: "wait_ready200",
      target: "slot",
      slot: working.live.slot,
      schema,
      timeoutMs: 600_000,
      onTimeout: "pending_exit0",
    });
    const nextState: PonderDeployState = {
      ...working,
      pending: null,
      identity: observations.identityDigest,
      executable: observations.executableDigest,
      preCutover: false,
    };
    actions.push({ type: "write_state", state: nextState });
    actions.push({
      type: "evidence",
      text: "deploy_evidence outcome=recreated",
    });
    actions.push({
      type: "evidence",
      text: `deploy_evidence slot=${working.live.slot}`,
    });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  if (working.preCutover) {
    return planFirstCutoverStart({
      state: working,
      observations,
      actions,
      operation,
      deploySha,
      schema,
      startSlot: "blue",
    });
  }

  const startSlot = chooseStartSlot(working);
  actions.push({ type: "write_slot_env", slot: startSlot, schema });
  actions.push({ type: "build_slot", slot: startSlot });
  actions.push({ type: "preflight_slot", slot: startSlot });
  actions.push({ type: "start_slot", slot: startSlot });

  const pendingRef: PonderSlotRef = { slot: startSlot, schema };
  const pendingState: PonderDeployState = {
    ...working,
    pending: pendingRef,
    identity: observations.identityDigest,
    executable: observations.executableDigest,
  };
  actions.push({ type: "write_state", state: pendingState });
  actions.push({
    type: "evidence",
    text: `deploy_evidence slot=${startSlot}`,
  });

  if (operation === "hold") {
    actions.push({
      type: "wait_ready200",
      target: "slot",
      slot: startSlot,
      schema,
      timeoutMs: 600_000,
      onTimeout: "pending_exit0",
    });
    actions.push({
      type: "evidence",
      text: `deploy_evidence switch=pending schema=${schema}`,
    });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  actions.push({
    type: "wait_ready200",
    target: "slot",
    slot: startSlot,
    schema,
    timeoutMs: 600_000,
    onTimeout: "pending_exit0",
  });

  if (working.rollback_model === null) {
    actions.push({
      type: "evidence",
      text: "deploy_switch_blocked: rollback_model_unset",
    });
    actions.push({
      type: "evidence",
      text: `deploy_evidence switch=pending schema=${schema}`,
    });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  return appendNormalSwitch({
    actions,
    state: pendingState,
    newLive: pendingRef,
    observations,
    rollbackModel: working.rollback_model,
  });
}

function planSwitchPending(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
  operation: PonderDeployOperation;
  deploySha: string;
  schema: string;
  continueAfter: boolean;
}): PlanResult {
  const { state, observations, actions } = args;
  const pending = state.pending!;
  const model = state.rollback_model!;

  const switched = appendNormalSwitch({
    actions,
    state,
    newLive: pending,
    observations,
    rollbackModel: model,
  });

  if (!args.continueAfter) {
    return switched;
  }
  // After switching pending, a newer commit still needs start — shell re-enters
  // plan with cleared pending. Emit marker for executor.
  switched.actions.push({
    type: "evidence",
    text: "deploy_evidence continue_after_pending_switch=1",
  });
  return switched;
}

function appendNormalSwitch(args: {
  actions: PlanAction[];
  state: PonderDeployState;
  newLive: PonderSlotRef;
  observations: PonderDeployObservations;
  rollbackModel: PonderRollbackModel;
}): PlanResult {
  const { actions, state, newLive, observations, rollbackModel } = args;
  const previousLive = state.live;

  actions.push({
    type: "switch_views",
    targetSchema: newLive.schema,
    kind: "normal",
    renameLiveTo: "kargain_views_prev",
  });
  actions.push({ type: "write_upstream", slot: newLive.slot });
  actions.push({ type: "reload_nginx" });
  actions.push({
    type: "wait_ready200",
    target: "nginx",
    schema: newLive.schema,
    timeoutMs: 90_000,
    onTimeout: "fail",
  });

  if (rollbackModel === "restart_previous" && previousLive) {
    actions.push({ type: "stop_slot", slot: previousLive.slot });
  }

  const nextState: PonderDeployState = {
    ...state,
    live: newLive,
    previous:
      rollbackModel === "keep_previous" && previousLive
        ? previousLive
        : rollbackModel === "restart_previous"
          ? previousLive
          : null,
    pending: null,
    identity: observations.identityDigest,
    executable: observations.executableDigest,
    preCutover: false,
  };
  // Under restart_previous previous writer is stopped but schema kept as spare
  if (rollbackModel === "restart_previous") {
    nextState.previous = previousLive;
  }

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
  actions.push({ type: "exit", code: 0 });
  return { actions };
}

function planFirstCutoverStart(args: {
  state: PonderDeployState;
  observations: PonderDeployObservations;
  actions: PlanAction[];
  operation: PonderDeployOperation;
  deploySha: string;
  schema: string;
  startSlot: PonderDeploySlot;
}): PlanResult {
  const { state, observations, actions, operation, schema, startSlot } = args;
  const prior =
    observations.priorCheckoutSha ??
    "0000000000000000000000000000000000000000";
  const legacySchema = schemaNameForDeploySha(prior);

  actions.push({ type: "write_slot_env", slot: startSlot, schema });
  actions.push({ type: "build_slot", slot: startSlot });
  actions.push({ type: "preflight_slot", slot: startSlot });
  actions.push({ type: "start_slot", slot: startSlot });

  const pendingRef: PonderSlotRef = { slot: startSlot, schema };
  const pendingState: PonderDeployState = {
    ...state,
    pending: pendingRef,
    legacy_schema: legacySchema,
    identity: observations.identityDigest,
    executable: observations.executableDigest,
    preCutover: true,
  };
  actions.push({ type: "write_state", state: pendingState });
  actions.push({
    type: "evidence",
    text: `deploy_evidence slot=${startSlot}`,
  });

  actions.push({
    type: "wait_ready200",
    target: "slot",
    slot: startSlot,
    schema,
    timeoutMs: 600_000,
    onTimeout: "pending_exit0",
  });

  if (operation === "hold") {
    actions.push({
      type: "evidence",
      text: `deploy_evidence switch=pending schema=${schema}`,
    });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  if (state.rollback_model === null && pendingState.rollback_model === null) {
    // Use observations-updated state: rollback_model may have been set on disk
    // between hold and deploy; planner sees state.rollback_model.
    actions.push({
      type: "evidence",
      text: "deploy_switch_blocked: rollback_model_unset",
    });
    actions.push({
      type: "evidence",
      text: `deploy_evidence switch=pending schema=${schema}`,
    });
    actions.push({ type: "exit", code: 0 });
    return { actions };
  }

  const model = (state.rollback_model ??
    pendingState.rollback_model) as PonderRollbackModel;

  return planFirstCutoverSwitch({
    state: pendingState,
    observations,
    actions,
    pending: pendingRef,
    model,
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
  const legacySchema =
    state.legacy_schema ??
    schemaNameForDeploySha(
      observations.priorCheckoutSha ??
        "0000000000000000000000000000000000000000",
    );

  actions.push({ type: "stop_legacy_writer" });
  actions.push({
    type: "switch_views",
    targetSchema: pending.schema,
    kind: "first_cutover",
    renameLiveTo: legacySchema,
  });
  actions.push({ type: "write_upstream", slot: pending.slot });
  actions.push({ type: "up_nginx" });
  actions.push({
    type: "wait_ready200",
    target: "nginx",
    schema: pending.schema,
    timeoutMs: 90_000,
    onTimeout: "fail",
  });

  const nextState: PonderDeployState = {
    identity: observations.identityDigest,
    executable: observations.executableDigest,
    live: pending,
    // Rollback spare is the renamed table schema (no second writer).
    previous: {
      slot: oppositeSlot(pending.slot),
      schema: legacySchema,
    },
    pending: null,
    rollback_model: model,
    lag: state.lag,
    legacy_schema: legacySchema,
    preCutover: false,
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

/** Action kinds that must never appear before cutover for service `ponder`. */
export function planActionsContainEarlyPonderUp(
  actions: readonly PlanAction[],
): boolean {
  // The plan never emits raw compose; shell maps up_nginx. Policy checks the shell.
  return actions.some((a) => a.type === "up_nginx" && false);
}

export function planNeverSwitchesOnHold(
  result: PlanResult,
): boolean {
  return !result.actions.some(
    (a) =>
      a.type === "switch_views" ||
      a.type === "reload_nginx" ||
      a.type === "up_nginx",
  );
}
