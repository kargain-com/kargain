import type {
  MessagingSession,
  ReconcilingOp,
  SessionCommand,
  SessionSnapshot,
} from "./ports";
import {
  deriveEnableWalletSignatures,
  enableWalletSignaturesCopy,
} from "./enable-cost";

export { deriveEnableWalletSignatures, enableWalletSignaturesCopy };

const USER_OPS = new Set<ReconcilingOp>(["create", "publish", "revoke"]);

export type PrimaryMessagingAction = {
  command: SessionCommand;
  label: string;
};

/**
 * Sole owner of primary CTA command + label from the session contract.
 * Surfaces must not invent a different command than `snapshot.next`.
 */
export function primaryActionFromSnapshot(
  snapshot: SessionSnapshot,
): PrimaryMessagingAction | null {
  const next =
    snapshot.state === "disabled" ||
    snapshot.state === "needs_signature" ||
    snapshot.state === "error" ||
    snapshot.state === "active" ||
    snapshot.state === "reconciling"
      ? snapshot.next
      : undefined;
  if (!next) return null;
  switch (next) {
    case "enable":
      return { command: { type: "enable" }, label: "Enable messages" };
    case "retry":
      return { command: { type: "retry" }, label: "Retry" };
    case "resetIdentity":
      return { command: { type: "resetIdentity" }, label: "Free a device slot" };
    case "cancel":
      return { command: { type: "cancel" }, label: "Cancel" };
    default:
      return null;
  }
}

/** Secondary install-limit action — not projected as `next`. */
export const SECONDARY_REVOKE_ALL_COMMAND: SessionCommand = {
  type: "revokeAllInstallations",
};

/**
 * Project signature-cost onto enable-facing snapshots (disabled / needs_signature).
 * Conservative when attestation not yet probed (counts as needing attest).
 */
export function withEnableWalletSignatures(
  snapshot: SessionSnapshot,
  facts: {
    keyHeld: boolean;
    attestationValidCached: boolean | null;
    hasLocalClient: boolean;
  },
): SessionSnapshot {
  if (snapshot.state !== "disabled" && snapshot.state !== "needs_signature") {
    return snapshot;
  }
  if (snapshot.state === "needs_signature" && snapshot.next !== "enable") {
    return snapshot;
  }
  const count = deriveEnableWalletSignatures({
    keyHeld: facts.keyHeld,
    attestationValid: facts.attestationValidCached === true,
    needsCreate: !facts.hasLocalClient,
  });
  return { ...snapshot, enableWalletSignatures: count };
}

export function needsMessagingSetupCard(snapshot: SessionSnapshot): boolean {
  switch (snapshot.state) {
    case "disabled":
      return snapshot.intent === "absent";
    case "needs_signature":
    case "error":
      return true;
    case "reconciling":
      return snapshot.op === "sdk";
    case "active":
      return (
        snapshot.next === "retry" ||
        snapshot.publishError === "publish_failed" ||
        snapshot.publishPending === true
      );
    default:
      return false;
  }
}

/** Seller own listing: active but peers cannot reach (intent not published true). */
export function needsSellerUnreachableDisclosure(snapshot: SessionSnapshot): boolean {
  return snapshot.state === "active" && snapshot.publiclyReachable === false;
}

/**
 * Idle-warm the XMTP SDK when intent is known true and this device has no client yet.
 * Uses the same publiclyReachable fact as the settings switch (intent === true).
 */
export function shouldIdleWarmXmtp(input: {
  publiclyReachable: boolean;
  hasClient: boolean;
}): boolean {
  return input.publiclyReachable && !input.hasClient;
}

export function messagingReadyForChecklist(snapshot: SessionSnapshot): boolean {
  if (needsMessagingSetupCard(snapshot)) return false;
  if (needsSellerUnreachableDisclosure(snapshot)) return false;
  if (snapshot.state === "disabled" && snapshot.intent === "absent") return false;
  if (snapshot.state === "needs_signature") return false;
  if (snapshot.state === "disconnected" || snapshot.state === "unsupported") return false;
  return true;
}

export function isUserOpInFlight(snapshot: SessionSnapshot): boolean {
  return snapshot.state === "reconciling" && USER_OPS.has(snapshot.op);
}

export function messagingUnsupportedCopy(snapshot: SessionSnapshot): string | null {
  if (snapshot.state === "unsupported") {
    return "Smart contract wallets cannot use encrypted messages on this network.";
  }
  return null;
}

/**
 * SVM / wrong-VM messaging refusal (design-spec §4.12).
 * Entry points stay visible with this reason — never removed.
 */
export const SVM_MESSAGING_UNAVAILABLE =
  "Private messages are not available on this account.";

/** Whether an EVM-session cause is the §4.12 SVM messaging refusal. */
export function isSvmMessagingRefusal(
  cause: "disconnected" | "wrong_vm" | undefined,
): boolean {
  return cause === "wrong_vm";
}

export function canWalletEnableMessaging(snapshot: SessionSnapshot): boolean {
  return snapshot.state !== "unsupported" && snapshot.state !== "disconnected";
}

export type AwaitActiveOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function awaitActiveSnapshot(
  session: MessagingSession,
  options: AwaitActiveOptions = {},
): Promise<SessionSnapshot> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    function check() {
      if (options.signal?.aborted) {
        unsubscribe();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      if (Date.now() - started > timeoutMs) {
        unsubscribe();
        reject(new Error("Timed out waiting for messaging to become active."));
        return;
      }
      const snap = session.getSnapshot();
      if (snap.state === "active" && session.getXmtpClient()) {
        unsubscribe();
        resolve(snap);
        return;
      }
      if (snap.state === "error" || snap.state === "unsupported") {
        unsubscribe();
        reject(new Error("Messaging could not be activated."));
        return;
      }
    }

    const unsubscribe = session.subscribe(check);
    check();
  });
}
