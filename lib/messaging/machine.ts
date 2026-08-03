import type {
  DisabledIntent,
  MessagingWalletKind,
  ReconcilingOp,
  SessionReason,
  SessionSnapshot,
  XmtpLocalClient,
} from "./ports";
import { PROBE_DEADLINE_MS } from "./ports";

export type IntentValue = boolean | null;

export type InFlightOp = {
  op: ReconcilingOp;
  deadlineMs: number;
  generation: number;
};

export type RevokeMode = "others" | "all";

export type MachineState = {
  generation: number;
  address: string;
  intent: IntentValue;
  intentLoaded: boolean;
  networkRegistered: boolean | null;
  localClient: XmtpLocalClient | null;
  localBuildReason: SessionReason | null;
  inFlight: InFlightOp | null;
  publishPending: boolean;
  publishError: "publish_failed" | null;
  awaitingSignature: SessionReason | null;
  lastError: SessionReason | null;
  resetChain: null | "revoke" | "create";
  revokeMode: RevokeMode | null;
  /** Full-revoke refused because cooldown has not elapsed. */
  revokeAllCooldown: boolean;
  /**
   * Result of ensureDurableStorage before first create.
   * null = not yet asked; false → project storageEvictable on active.
   */
  storageDurable: boolean | null;
  enableRequested: boolean;
  disableRequested: boolean;
  resetRequested: boolean;
  /** Surfaces that need a local XMTP client (inbox / DM / enable). Probe/build gated on this. */
  clientDemand: number;
};

export function createInitialMachineState(address: string): MachineState {
  return {
    generation: 1,
    address,
    intent: null,
    intentLoaded: false,
    networkRegistered: null,
    localClient: null,
    localBuildReason: null,
    inFlight: null,
    publishPending: false,
    publishError: null,
    awaitingSignature: null,
    lastError: null,
    resetChain: null,
    revokeMode: null,
    revokeAllCooldown: false,
    storageDurable: null,
    enableRequested: false,
    disableRequested: false,
    resetRequested: false,
    clientDemand: 0,
  };
}

export type MachineEvent =
  | { type: "generation_bumped"; generation: number }
  | { type: "intent_loaded"; intent: IntentValue }
  | { type: "network_observed"; registered: boolean }
  | { type: "local_client_set"; client: XmtpLocalClient | null; reason?: SessionReason }
  | { type: "effect_started"; op: ReconcilingOp; deadlineMs: number; generation: number }
  | { type: "effect_cleared" }
  | { type: "publish_pending_set"; pending: boolean }
  | { type: "publish_error_set"; error: "publish_failed" | null }
  | { type: "awaiting_signature_set"; reason: SessionReason | null }
  | { type: "last_error_set"; reason: SessionReason | null }
  | { type: "reset_chain_set"; stage: MachineState["resetChain"] }
  | { type: "revoke_mode_set"; mode: RevokeMode | null }
  | { type: "revoke_all_cooldown_set"; blocked: boolean }
  | { type: "storage_durable_set"; durable: boolean }
  | { type: "enable_requested" }
  | { type: "disable_requested" }
  | { type: "reset_requested" }
  | { type: "enable_cleared" }
  | { type: "disable_cleared" }
  | { type: "reset_cleared" }
  | { type: "client_demand_delta"; delta: 1 | -1 };

export function transitionMachine(state: MachineState, event: MachineEvent): MachineState {
  switch (event.type) {
    case "generation_bumped":
      return {
        ...createInitialMachineState(state.address),
        generation: event.generation,
        address: state.address,
      };
    case "intent_loaded":
      return { ...state, intent: event.intent, intentLoaded: true };
    case "network_observed":
      return { ...state, networkRegistered: event.registered };
    case "local_client_set":
      return {
        ...state,
        localClient: event.client,
        localBuildReason: event.client ? null : (event.reason ?? state.localBuildReason),
      };
    case "effect_started":
      return {
        ...state,
        inFlight: {
          op: event.op,
          deadlineMs: event.deadlineMs,
          generation: event.generation,
        },
        awaitingSignature: null,
        lastError: null,
      };
    case "effect_cleared":
      return { ...state, inFlight: null };
    case "publish_pending_set":
      return { ...state, publishPending: event.pending };
    case "publish_error_set":
      return { ...state, publishError: event.error };
    case "awaiting_signature_set":
      return { ...state, awaitingSignature: event.reason };
    case "last_error_set":
      return { ...state, lastError: event.reason };
    case "reset_chain_set":
      return { ...state, resetChain: event.stage };
    case "revoke_mode_set":
      return { ...state, revokeMode: event.mode };
    case "revoke_all_cooldown_set":
      return { ...state, revokeAllCooldown: event.blocked };
    case "storage_durable_set":
      return { ...state, storageDurable: event.durable };
    case "enable_requested":
      return { ...state, enableRequested: true, disableRequested: false };
    case "disable_requested":
      return { ...state, disableRequested: true, enableRequested: false };
    case "reset_requested":
      return { ...state, resetRequested: true };
    case "enable_cleared":
      return { ...state, enableRequested: false };
    case "disable_cleared":
      return { ...state, disableRequested: false };
    case "reset_cleared":
      return {
        ...state,
        resetRequested: false,
        resetChain: null,
        revokeMode: null,
      };
    case "client_demand_delta":
      return {
        ...state,
        clientDemand: Math.max(0, state.clientDemand + event.delta),
      };
    default:
      return state;
  }
}

function disabledIntent(intent: IntentValue): DisabledIntent {
  return intent === false ? "explicit" : "absent";
}

function publiclyReachable(
  networkRegistered: boolean | null,
  intent: IntentValue,
): boolean {
  // Reachable only when network-registered and relay intent is explicitly true.
  // publishPending (intent still null) and explicit opt-out are not reachable.
  return networkRegistered === true && intent === true;
}

export function projectSnapshot(
  state: MachineState,
  walletAddress: string | null,
  walletKind: MessagingWalletKind | null,
  nowMs: number = Date.now(),
): SessionSnapshot {
  if (!walletAddress) {
    return { state: "disconnected" };
  }
  if (walletKind === null) {
    return {
      state: "reconciling",
      op: "intent",
      deadlineMs: nowMs + PROBE_DEADLINE_MS,
    };
  }
  if (walletKind === "contract") {
    return { state: "unsupported" };
  }

  if (state.inFlight) {
    return {
      state: "reconciling",
      op: state.inFlight.op,
      deadlineMs: state.inFlight.deadlineMs,
    };
  }

  if (state.localClient) {
    const reachable = publiclyReachable(state.networkRegistered, state.intent);
    const storageEvictable =
      state.storageDurable === false ? ({ storageEvictable: true as const } as const) : {};
    if (state.publishPending || state.publishError) {
      return {
        state: "active",
        publiclyReachable: reachable,
        ...(state.publishPending ? { publishPending: true as const } : {}),
        ...(state.publishError ? { publishError: state.publishError } : {}),
        ...storageEvictable,
        next: "retry",
      };
    }
    return { state: "active", publiclyReachable: reachable, ...storageEvictable };
  }

  if (state.lastError) {
    const next =
      state.lastError === "opfs_lock"
        ? ("cancel" as const)
        : state.lastError === "installation_limit"
          ? ("resetIdentity" as const)
          : ("retry" as const);
    return { state: "error", reason: state.lastError, next };
  }

  if (state.awaitingSignature) {
    const next =
      state.awaitingSignature === "installation_limit"
        ? ("resetIdentity" as const)
        : state.awaitingSignature === "not_registered"
          ? ("enable" as const)
          : ("retry" as const);
    return {
      state: "needs_signature",
      reason: state.awaitingSignature,
      next,
    };
  }

  if (state.intentLoaded && state.intent === null && !state.enableRequested) {
    return { state: "disabled", intent: "absent", next: "enable" };
  }

  if (state.intentLoaded && state.intent === false && !state.enableRequested) {
    return { state: "disabled", intent: "explicit", next: "enable" };
  }

  if (
    state.intentLoaded &&
    state.intent === true &&
    state.networkRegistered === false &&
    !state.enableRequested
  ) {
    return {
      state: "needs_signature",
      reason: "not_registered",
      next: "enable",
    };
  }

  // Intent on, no local client demanded yet — dormant (no probe/build). Not setup-needed.
  if (
    state.intentLoaded &&
    state.intent === true &&
    state.clientDemand <= 0 &&
    !state.localClient &&
    !state.enableRequested
  ) {
    return { state: "active", publiclyReachable: false };
  }

  if (!state.intentLoaded) {
    return {
      state: "reconciling",
      op: "intent",
      deadlineMs: nowMs + PROBE_DEADLINE_MS,
    };
  }

  return { state: "disabled", intent: disabledIntent(state.intent), next: "enable" };
}

export function snapshotHasActionableNext(snapshot: SessionSnapshot): boolean {
  switch (snapshot.state) {
    case "disconnected":
    case "unsupported":
    case "reconciling":
      return false;
    case "disabled":
    case "needs_signature":
    case "error":
      return true;
    case "active":
      return snapshot.next !== undefined;
    default:
      return false;
  }
}
