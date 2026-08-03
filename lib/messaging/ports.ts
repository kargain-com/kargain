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

/**
 * Minimum gap between full-account installation revokes for one address.
 * Full revoke spends irreversible inbox updates; rate-limit protects users.
 */
export const REVOKE_ALL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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
  /** Free device slots while keeping this browser's installation → create. */
  | { type: "resetIdentity" }
  /** Revoke every installation including this device (confirm + cooldown) → create. */
  | { type: "revokeAllInstallations" }
  | { type: "retry" }
  | { type: "cancel" };

export type SessionCommandType = SessionCommand["type"];

export type ReconcilingOp =
  | "intent"
  | "probe"
  | "build"
  | "create"
  | "publish"
  | "revoke";

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
      /**
       * `navigator.storage.persist()` refused or unavailable — installation is
       * evictable (signature + inbox update + archive risk on eviction).
       */
      storageEvictable?: true;
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

export type InstallationReadout = {
  installations: Array<{ id: string; createdAtMs: number | null }>;
  currentInstallationId: string | null;
};

export type RevokeOtherResult =
  | { ok: true }
  | { ok: false; reason: "no_current_installation" };

export type RevokeAllResult =
  | { ok: true }
  | { ok: false; reason: "cooldown" };

export type DurableStorageResult = {
  durable: boolean;
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
  /**
   * Shut down a local client handle. Idempotent; never throws into the caller
   * (already-closed / dead worker must not become a session error).
   */
  closeLocal(client: XmtpLocalClient): void;
  /**
   * Request persistent storage before the first create. Refusal means this
   * device's installation is evictable.
   */
  ensureDurableStorage(signal?: AbortSignal): Promise<DurableStorageResult>;
  /**
   * Revoke every installation except this browser's. Refuses when
   * `currentClient` is absent — never silently becomes full revoke.
   */
  revokeOtherInstallations(
    address: string,
    signal?: AbortSignal,
    currentClient?: XmtpLocalClient | null,
  ): Promise<RevokeOtherResult>;
  /** Revoke the full set including this device. Cooldown is enforced by effects. */
  revokeAllInstallations(
    address: string,
    signal?: AbortSignal,
  ): Promise<RevokeAllResult>;
  readInstallations(
    address: string,
    signal?: AbortSignal,
    currentClient?: XmtpLocalClient | null,
  ): Promise<InstallationReadout>;
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
  /** Cached kind after probe; null while probing. */
  getAccountKind(): MessagingWalletKind | null;
  /** Resolves account kind on session init (chain read). */
  ensureAccountKindProbed(): Promise<void>;
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

/** Soft cap shown in the device-limit surface (matches XMTP installation ceiling). */
export const MESSAGING_INSTALLATION_LIMIT = 10;

export type MessagingSession = {
  getSnapshot(): SessionSnapshot;
  subscribe(onChange: () => void): () => void;
  dispatch(command: SessionCommand): void;
  getXmtpClient(): import("./adapters/xmtp-adapter").XmtpSdkClient | null;
  readInstallations(): Promise<InstallationReadout>;
  /** True when a full-account revoke was refused or is still within cooldown. */
  isRevokeAllOnCooldown(): boolean;
  /** Idempotent — begins background reconcile after mount. */
  start(): void;
  /** Raise demand for probe/build (inbox, DM, enable CTA). */
  requestLocalClient(): void;
  /** Drop one demand ref; probe/build stop when demand hits 0. */
  releaseLocalClient(): void;
  /**
   * Harness / tests: replace machine address.
   * Production address changes go through the session registry (release + acquire).
   */
  changeAddress(address: string): void;
  dispose(): void;
};

export type CreateMessagingSessionInput = {
  address: string;
  ports: MessagingSessionPorts;
  clock: Clock;
  /** Injectable cache for tests; production uses cache-adapter localStorage. */
  cache?: import("./adapters/cache-adapter").MessagingCachePort;
};

export type CreateMessagingSession = (
  input: CreateMessagingSessionInput,
) => MessagingSession;
