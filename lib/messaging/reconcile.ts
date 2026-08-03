import type { ReconcilingOp, SessionReason, XmtpLocalClient } from "./ports";
import type { IntentValue, MachineState, RegistrationStatus } from "./machine";

export type ReconcileEffect = ReconcilingOp;

export type ReconcilePlan =
  | { kind: "idle" }
  | { kind: "run"; effect: ReconcileEffect; publishValue?: boolean }
  | { kind: "await_signature"; reason: SessionReason };

export type ReconcileInput = {
  state: MachineState;
  nowMs: number;
  /** SDK module loaded — build/create require this. */
  moduleReady: boolean;
};

function wantsMessaging(state: MachineState): boolean {
  if (state.disableRequested) return false;
  if (state.enableRequested) return true;
  return state.intent === true;
}

function hasClientDemand(state: MachineState): boolean {
  return state.clientDemand > 0;
}

function shouldBuild(state: MachineState): boolean {
  if (!wantsMessaging(state)) return false;
  if (!hasClientDemand(state)) return false;
  if (state.localClient) return false;
  if (state.localBuildReason !== null) return false;
  if (state.awaitingSignature || state.lastError) return false;
  // Prefer build whenever registration is unknown or already known registered.
  // Unregistered → create path (enable / reset), not another build.
  if (state.registrationStatus === "unregistered") return false;
  return true;
}

/** Create only on explicit enable / reset recovery — never auto on cutover. */
function shouldCreate(state: MachineState): boolean {
  if (!hasClientDemand(state)) return false;
  if (state.localClient) return false;

  // Storage busy — never mint an installation while the local DB cannot open.
  if (state.lastError === "opfs_lock" || state.localBuildReason === "opfs_lock") {
    return false;
  }

  // Full-revoke publishes intent false before revoke; create must still run.
  if (state.resetChain === "create") return true;

  if (!wantsMessaging(state)) return false;
  if (!state.enableRequested) return false;
  // Prefer silent build first when not yet attempted.
  if (
    state.registrationStatus !== "unregistered" &&
    state.localBuildReason === null
  ) {
    return false;
  }
  return true;
}

function shouldPublishTrue(state: MachineState): boolean {
  if (state.publishPending) return true;
  if (state.enableRequested && state.localClient && state.intent !== true) return true;
  return false;
}

function shouldPublishFalse(state: MachineState): boolean {
  return state.disableRequested;
}

export function reconcile(input: ReconcileInput): ReconcilePlan {
  const { state, moduleReady } = input;

  if (state.inFlight) {
    return { kind: "idle" };
  }

  if (state.resetRequested || state.resetChain) {
    if (state.resetChain === "revoke" || (state.resetRequested && !state.resetChain)) {
      return { kind: "run", effect: "revoke" };
    }
    if (state.resetChain === "create") {
      if (!moduleReady) return { kind: "run", effect: "sdk" };
      return { kind: "run", effect: "create" };
    }
  }

  if (shouldPublishFalse(state)) {
    return { kind: "run", effect: "publish", publishValue: false };
  }

  // Publish-only retry: idle until user dispatches retry (clears publishError).
  if (state.publishError && state.localClient) {
    return { kind: "idle" };
  }

  if (shouldPublishTrue(state)) {
    return { kind: "run", effect: "publish", publishValue: true };
  }

  if (!state.intentLoaded || !state.intentKnown) {
    return { kind: "idle" };
  }

  if (state.intent === null && !state.enableRequested) {
    return { kind: "idle" };
  }

  if (state.intent === false && !state.enableRequested) {
    return { kind: "idle" };
  }

  if (state.awaitingSignature && !state.enableRequested) {
    return { kind: "idle" };
  }

  if (state.lastError && !state.localClient) {
    return { kind: "idle" };
  }

  // Storage failure sticks via localBuildReason even if lastError was cleared.
  if (state.localBuildReason === "opfs_lock" && !state.localClient) {
    return { kind: "idle" };
  }

  if (shouldBuild(state) || shouldCreate(state)) {
    if (!moduleReady) {
      return { kind: "run", effect: "sdk" };
    }
  }

  if (shouldBuild(state)) {
    return { kind: "run", effect: "build" };
  }

  if (shouldCreate(state)) {
    return { kind: "run", effect: "create" };
  }

  if (
    wantsMessaging(state) &&
    state.registrationStatus === "unregistered" &&
    !state.localClient &&
    state.intent === true &&
    !state.enableRequested
  ) {
    return { kind: "await_signature", reason: "not_registered" };
  }

  if (
    wantsMessaging(state) &&
    state.localBuildReason === "build_failed" &&
    !state.localClient &&
    !state.enableRequested
  ) {
    return { kind: "await_signature", reason: "build_failed" };
  }

  return { kind: "idle" };
}

export function applyBuildResult(
  result:
    | { ok: true; client: XmtpLocalClient }
    | { ok: false; reason: SessionReason },
): {
  client: XmtpLocalClient | null;
  reason: SessionReason | null;
  awaiting: SessionReason | null;
  lastError: SessionReason | null;
  registrationStatus: RegistrationStatus | null;
} {
  if (result.ok) {
    return {
      client: result.client,
      reason: null,
      awaiting: null,
      lastError: null,
      registrationStatus: "registered",
    };
  }
  if (result.reason === "not_registered") {
    return {
      client: null,
      reason: "not_registered",
      awaiting: "not_registered",
      lastError: null,
      registrationStatus: "unregistered",
    };
  }
  if (result.reason === "opfs_lock") {
    return {
      client: null,
      reason: "opfs_lock",
      awaiting: null,
      lastError: "opfs_lock",
      registrationStatus: null,
    };
  }
  return {
    client: null,
    reason: "build_failed",
    awaiting: "build_failed",
    lastError: null,
    registrationStatus: null,
  };
}

type CreateFailureReason =
  | "installation_limit"
  | "opfs_lock"
  | "create_cancelled"
  | "build_failed";

export function applyCreateResult(
  result:
    | { ok: true; client: XmtpLocalClient }
    | { ok: false; reason: CreateFailureReason },
): {
  client: XmtpLocalClient | null;
  awaiting: SessionReason | null;
  lastError: SessionReason | null;
  resetChain: MachineState["resetChain"];
  registrationStatus: RegistrationStatus | null;
} {
  if (result.ok) {
    return {
      client: result.client,
      awaiting: null,
      lastError: null,
      resetChain: null,
      registrationStatus: "registered",
    };
  }
  if (result.reason === "installation_limit") {
    // User must choose free-slot vs full revoke — no automatic recovery.
    return {
      client: null,
      awaiting: "installation_limit",
      lastError: null,
      resetChain: null,
      registrationStatus: null,
    };
  }
  if (result.reason === "create_cancelled") {
    return {
      client: null,
      awaiting: "create_cancelled",
      lastError: null,
      resetChain: null,
      registrationStatus: null,
    };
  }
  if (result.reason === "opfs_lock") {
    return {
      client: null,
      awaiting: null,
      lastError: "opfs_lock",
      resetChain: null,
      registrationStatus: null,
    };
  }
  return {
    client: null,
    awaiting: "build_failed",
    lastError: null,
    resetChain: null,
    registrationStatus: null,
  };
}

export function intentAfterDisable(): IntentValue {
  return false;
}

export function intentAfterEnablePublish(): IntentValue {
  return true;
}
