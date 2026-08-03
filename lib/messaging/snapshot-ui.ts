import type { MessagingSession, ReconcilingOp, SessionSnapshot } from "./ports";

const USER_OPS = new Set<ReconcilingOp>(["create", "publish", "revoke"]);

export function needsMessagingSetupCard(snapshot: SessionSnapshot): boolean {
  switch (snapshot.state) {
    case "disabled":
      return snapshot.intent === "absent";
    case "needs_signature":
    case "error":
      return true;
    default:
      return false;
  }
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
  if (snapshot.state === "disabled" && snapshot.intent === "absent") return false;
  if (snapshot.state === "needs_signature") return false;
  if (snapshot.state === "disconnected" || snapshot.state === "unsupported") return false;
  return true;
}

export function isUserOpInFlight(snapshot: SessionSnapshot): boolean {
  return snapshot.state === "reconciling" && USER_OPS.has(snapshot.op);
}

export function isMessagingActive(snapshot: SessionSnapshot): boolean {
  return snapshot.state === "active";
}

export function messagingUnsupportedCopy(snapshot: SessionSnapshot): string | null {
  if (snapshot.state === "unsupported") {
    return "Smart contract wallets cannot use encrypted messages on this network.";
  }
  return null;
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
