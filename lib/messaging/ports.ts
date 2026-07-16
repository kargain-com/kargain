/**
 * Messaging session ports — R0 executable contract + R1 amendments.
 *
 * Truth hierarchy (normative for R0–R4):
 * - Nostr kind 0 `messagesEnabled` = durable cross-device intent
 * - XMTP network registration = account fact
 * - OPFS local DB = device fact
 * - Any cache = observation memo only (never a decision source, never gates a CTA)
 *
 * The "opted-in" concept is abolished. R1 implements CreateMessagingSession;
 * adapters that satisfy these ports land in R1–R2. No `@xmtp/client` here.
 */

/** Background probe (network registration) must settle by this wall time. */
export const PROBE_DEADLINE_MS = 5_000;

/** Silent local build must settle by this wall time. */
export const BUILD_DEADLINE_MS = 10_000;

/** Wallet kinds the session accepts; `contract` → unsupported. */
export type MessagingWalletKind = "eoa" | "eip7702" | "contract";

/** Machine-readable failure / wait reasons on actionable snapshots. */
export type SessionReason =
  | "build_failed"
  | "not_registered"
  | "timeout"
  | "opfs_lock"
  | "installation_limit"
  | "publish_failed"
  | "create_cancelled";

/** Commands the UI / hook may dispatch. */
export type SessionCommand =
  | { type: "enable" }
  | { type: "disable" }
  | { type: "resetIdentity" }
  | { type: "retry" }
  | { type: "cancel" };

export type SessionCommandType = SessionCommand["type"];

export type ReconcilingOp =
  | "probe"
  | "build"
  | "create"
  | "publish"
  | "revoke"
  | "reset";

/** Intent never published (onboarding) vs explicit opt-out on Nostr. */
export type DisabledIntent = "absent" | "explicit";

/**
 * Discriminated session view. There is no `inactive` / `initializing` /
 * `restore_required` — those map onto reconciling | needs_signature | error.
 */
export type SessionSnapshot =
  | { state: "disconnected" }
  | { state: "unsupported" }
  | { state: "disabled"; intent: DisabledIntent; next: "enable" }
  | {
      state: "reconciling";
      op: ReconcilingOp;
      /** Absolute clock deadline (ms since epoch) for this op, when applicable. */
      deadlineMs: number;
    }
  | {
      state: "needs_signature";
      reason: SessionReason;
      next: "enable" | "retry" | "resetIdentity";
    }
  | {
      state: "active";
      publiclyReachable: boolean;
      /** XMTP create succeeded but Nostr publish(true) not yet acked. */
      publishPending?: true;
      /** Disable or enable publish failed — inbox stays readable. */
      publishError?: "publish_failed";
      /** Present when publish-only retry is required (no second XMTP signature). */
      next?: "retry";
    }
  | {
      state: "error";
      reason: SessionReason;
      next: "retry" | "resetIdentity" | "cancel";
    };

/** Opaque local client handle — core never inspects SDK types. */
export type XmtpLocalClient = { readonly __brand: "XmtpLocalClient" };

export type ProbeRegistrationResult = {
  registered: boolean;
};

export type BuildLocalResult =
  | { ok: true; client: XmtpLocalClient }
  | { ok: false; reason: "build_failed" | "opfs_lock" | "not_registered" };

export type CreateWithSignerResult =
  | { ok: true; client: XmtpLocalClient }
  | {
      ok: false;
      reason: "installation_limit" | "opfs_lock" | "create_cancelled" | "build_failed";
    };

/**
 * XMTP side effects the core may request. Adapters wrap `@xmtp/client`
 * (R1+); R0 tests use fakes only.
 */
export type XmtpPort = {
  probeRegistration(address: string, signal?: AbortSignal): Promise<ProbeRegistrationResult>;
  buildLocal(address: string, signal?: AbortSignal): Promise<BuildLocalResult>;
  /**
   * User-signature path. No wall timeout (waits on wallet); cancellable via
   * AbortSignal → reason `create_cancelled`.
   */
  createWithSigner(address: string, signal?: AbortSignal): Promise<CreateWithSignerResult>;
  revokeInstallations(address: string, signal?: AbortSignal): Promise<void>;
  resetLocalDb(address: string): Promise<void>;
};

/**
 * Durable intent on Nostr kind 0 `messagesEnabled`.
 * R1 adapter wraps the existing NS-4.3 / NS-5.2.1-guarded profile stack.
 */
export type NostrPolicyPort = {
  /** `true` = enabled intent; `false` = explicit opt-out; `null` = never published. */
  readIntent(address: string, signal?: AbortSignal): Promise<boolean | null>;
  /**
   * Publish intent. Must ack on relay before the core tears down local state
   * on disable. Failure → stay active / surface `publish_failed`.
   */
  publishIntent(
    address: string,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<{ ok: true } | { ok: false; reason: "publish_failed" }>;
};

export type WalletPort = {
  /** Connected EOA/eip7702 address, or null when disconnected. */
  getAddress(): string | null;
  getAccountKind(): MessagingWalletKind | null;
  /** Resolves when a wallet client is ready for signing, or rejects / times out at the adapter. */
  waitUntilReady(signal?: AbortSignal): Promise<void>;
};

/**
 * Injectable clock. Production uses Date.now / real timers;
 * contract tests use ControlledClock.
 */
export type Clock = {
  nowMs(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

export type MessagingSessionPorts = {
  xmtp: XmtpPort;
  nostr: NostrPolicyPort;
  wallet: WalletPort;
};

export type MessagingSession = {
  getSnapshot(): SessionSnapshot;
  subscribe(onChange: () => void): () => void;
  dispatch(command: SessionCommand): void;
};

export type CreateMessagingSessionInput = {
  address: string;
  ports: MessagingSessionPorts;
  clock: Clock;
};

export type CreateMessagingSession = (
  input: CreateMessagingSessionInput,
) => MessagingSession;
