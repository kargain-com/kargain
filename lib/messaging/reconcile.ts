import type { ReconcilingOp, SessionReason, XmtpLocalClient } from "./ports";
import type { IntentValue, MachineState } from "./machine";

export type ReconcileEffect = ReconcilingOp;

export type ReconcilePlan =
  | { kind: "idle" }
  | { kind: "run"; effect: ReconcileEffect; publishValue?: boolean }
  | { kind: "await_signature"; reason: SessionReason };

export type ReconcileInput = {
  state: MachineState;
  nowMs: number;
};

function wantsMessaging(state: MachineState): boolean {
  if (state.disableRequested) return false;
  if (state.enableRequested) return true;
  return state.intent === true;
}

function shouldProbe(state: MachineState): boolean {
  if (!wantsMessaging(state)) return false;
  if (state.networkRegistered !== null) return false;
  return state.intentLoaded;
}

function shouldBuild(state: MachineState): boolean {
  if (!wantsMessaging(state)) return false;
  if (state.localClient) return false;
  if (state.networkRegistered !== true) return false;
  if (state.localBuildReason !== null) return false;
  if (state.awaitingSignature || state.lastError) return false;
  return true;
}

/** Create only on explicit enable / reset recovery — never auto on cutover. */
function shouldCreate(state: MachineState): boolean {
  if (!wantsMessaging(state)) return false;
  if (state.localClient) return false;
  if (state.resetChain === "create") return true;
  if (!state.enableRequested) return false;
  // Wait for probe to settle before creating.
  if (state.networkRegistered === null) return false;
  // Prefer silent build when registered and not yet attempted.
  if (state.networkRegistered === true && state.localBuildReason === null) return false;
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
  const { state } = input;

  if (state.inFlight) {
    return { kind: "idle" };
  }

  if (state.resetRequested || state.resetChain) {
    if (state.resetChain === "revoke" || (state.resetRequested && !state.resetChain)) {
      return { kind: "run", effect: "revoke" };
    }
    if (state.resetChain === "reset") {
      return { kind: "run", effect: "reset" };
    }
    if (state.resetChain === "create") {
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

  if (!state.intentLoaded) {
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

  if (shouldProbe(state)) {
    return { kind: "run", effect: "probe" };
  }

  if (shouldBuild(state)) {
    return { kind: "run", effect: "build" };
  }

  if (shouldCreate(state)) {
    return { kind: "run", effect: "create" };
  }

  if (
    wantsMessaging(state) &&
    state.networkRegistered === false &&
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
} {
  if (result.ok) {
    return { client: result.client, reason: null, awaiting: null, lastError: null };
  }
  if (result.reason === "not_registered") {
    return {
      client: null,
      reason: "not_registered",
      awaiting: "not_registered",
      lastError: null,
    };
  }
  if (result.reason === "opfs_lock") {
    return { client: null, reason: "opfs_lock", awaiting: null, lastError: "opfs_lock" };
  }
  return {
    client: null,
    reason: "build_failed",
    awaiting: "build_failed",
    lastError: null,
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
} {
  if (result.ok) {
    return { client: result.client, awaiting: null, lastError: null, resetChain: null };
  }
  if (result.reason === "installation_limit") {
    return {
      client: null,
      awaiting: null,
      lastError: null,
      // Auto-start recovery chain; UI may also show resetIdentity.
      resetChain: "revoke",
    };
  }
  if (result.reason === "create_cancelled") {
    return { client: null, awaiting: "create_cancelled", lastError: null, resetChain: null };
  }
  if (result.reason === "opfs_lock") {
    return { client: null, awaiting: null, lastError: "opfs_lock", resetChain: null };
  }
  return { client: null, awaiting: "build_failed", lastError: null, resetChain: null };
}

export function intentAfterDisable(): IntentValue {
  return false;
}

export function intentAfterEnablePublish(): IntentValue {
  return true;
}
