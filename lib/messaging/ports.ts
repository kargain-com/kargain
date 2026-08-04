/**
 * Messaging session ports — R0 executable contract + R1 amendments.
 *
 * Truth hierarchy (normative for R0–R4):
 * - Nostr kind 0 `messagesEnabled` = durable cross-device intent
 * - XMTP network registration = derived from last build/create on this device
 * - OPFS local DB = device fact
 * - Any cache = observation memo only (never a decision source, never gates a CTA)
 *
 * Wall-clock budgets for session ops live in `session-budgets.ts` (not here).
 * Peer registration abort lives with `contact-peer.ts`.
 *
 * The "opted-in" concept is abolished. R1 implements CreateMessagingSession;
 * adapters that satisfy these ports land in R1–R2. No `@xmtp/client` here.
 */

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
  | "create_cancelled"
  | "unknown";

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
  | "sdk"
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
  | { state: "disabled"; intent: DisabledIntent; next: "enable"; enableWalletSignatures?: number }
  | {
      state: "reconciling";
      op: ReconcilingOp;
      /** Absolute clock deadline (ms since epoch) for this op, when applicable. */
      deadlineMs: number;
      /** Present for `sdk` — cancelable module load with no wall deadline. */
      next?: "cancel";
    }
  | {
      state: "needs_signature";
      reason: SessionReason;
      next: "enable" | "retry" | "resetIdentity";
      enableWalletSignatures?: number;
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
      /** Underlying cause when reason is `unknown` (inspectable, not user-facing). */
      cause?: string;
    };

/** Opaque local client handle — core never inspects SDK types. */
export type XmtpLocalClient = { readonly __brand: "XmtpLocalClient" };

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
  /**
   * Load the SDK module (WASM). Prerequisite for build/create — never inside a
   * wall-clock deadline. Cancel via AbortSignal only.
   */
  ensureModule(signal?: AbortSignal): Promise<void>;
  /** True after a successful ensureModule / preload settled. */
  isModuleReady(): boolean;
  /**
   * Resolves when no local-client release is outstanding. Acquisition
   * (build/create) must await this outside any wall-clock deadline.
   */
  whenLocalIdle(): Promise<void>;
  buildLocal(address: string, signal?: AbortSignal): Promise<BuildLocalResult>;
  /**
   * User-signature path. No wall timeout (waits on wallet); cancellable via
   * AbortSignal → reason `create_cancelled`. Requires module ready.
   */
  createWithSigner(address: string, signal?: AbortSignal): Promise<CreateWithSignerResult>;
  /**
   * Shut down a local client handle. Completes when streams have ended and the
   * SDK client is closed. Idempotent; never rejects into the caller.
   */
  closeLocal(client: XmtpLocalClient): Promise<void>;
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
 * Discriminated intent read. Unanswered is not a flag value — relays did not
 * complete coverage (or author pubkey is unknown). `intent: null` means
 * answered and the field was never published.
 */
export type IntentReadResult =
  | { status: "answered"; intent: true | false | null }
  | { status: "unanswered" };

/**
 * App Nostr identity owner capability injected into the messaging adapter.
 * Implemented by MessagingSessionProvider wrapping `useNostrKey().ensureNostrKey`.
 * Held-in-memory → obtainKey returns ready with zero wallet prompts.
 */
export type NostrIdentityCapability = {
  obtainKey: () => Promise<
    | { status: "ready"; privateKey: `0x${string}` }
    | { status: "declined" }
    | { status: "error" }
    | { status: "unavailable" }
  >;
  isKeyHeld: () => boolean;
  /** Cached prompt-free attestation probe (null = not yet probed). */
  getAttestationValidCached: () => boolean | null;
  markAttestationValid: (valid: boolean) => void;
};

/**
 * Durable intent on Nostr kind 0 `messagesEnabled`.
 * Sole owner: `lib/nostr/messaging-intent.ts` (coverage read + kind:0 writer).
 */
export type NostrPolicyPort = {
  readIntent(address: string, signal?: AbortSignal): Promise<IntentReadResult>;
  /**
   * Publish intent. Must ack on relay before the core tears down local state
   * on disable. Declined signature → retry-inviting; other failures → `publish_failed`.
   */
  publishIntent(
    address: string,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<
    { ok: true } | { ok: false; reason: "publish_failed" | "signature_declined" }
  >;
  /** Prompt-free: private key already held in the identity owner. */
  isKeyHeld(): boolean;
  /** Prompt-free cached attestation fact (null until probed / published). */
  getAttestationValidCached(): boolean | null;
  /** Coverage + verify; caches result; never prompts the wallet. */
  probeAttestationValid(address: string): Promise<boolean>;
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
