/**
 * Derive-only live auction signals (extension flash, outbid toast).
 * No timers/subscriptions — callers feed values from existing detail refetch.
 */

/** Seconds → whole minutes for copy (“Extended by N minutes”). */
export function extensionWindowMinutes(extensionWindowSec: bigint): number {
  const sec = Number(extensionWindowSec);
  if (!Number.isFinite(sec) || sec <= 0) return 5;
  return Math.max(1, Math.round(sec / 60));
}

export function formatExtensionFlash(extensionWindowSec: bigint): string {
  const mins = extensionWindowMinutes(extensionWindowSec);
  return `Extended by ${mins} minutes`;
}

export function formatExtensionHelp(extensionWindowSec: bigint): string {
  const mins = extensionWindowMinutes(extensionWindowSec);
  return `Bids in the last ${mins} minutes extend the auction by ${mins} minutes.`;
}

/**
 * True when a refetch shows endsAt jumped while the auction had a prior end
 * (anti-sniping extension). Ignores first hydrate (prev unset / zero).
 */
export function detectEndsAtExtension(
  prevEndsAt: bigint | null | undefined,
  nextEndsAt: bigint,
): boolean {
  if (prevEndsAt == null || prevEndsAt <= 0n) return false;
  return nextEndsAt > prevEndsAt;
}

export function formatOutbidToastMessage(amountLabel: string): string {
  return `You were outbid. Your ${amountLabel} was released. If it did not arrive in your wallet, check Claims.`;
}

/** sessionStorage key — once per lost lead for this auction start + bid amount. */
export function outbidSessionKey(args: {
  chainId: number;
  tokenId: string;
  startedAt: bigint;
  lostBid: bigint;
}): string {
  return `kargain:auction-outbid:${args.chainId}:${args.tokenId}:${args.startedAt.toString()}:${args.lostBid.toString()}`;
}

export function hasOutbidBeenNotified(key: string): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markOutbidNotified(key: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Detect transition from “wallet was highest bidder” to “no longer leading”.
 * Returns the amount that was lost (previous highestBid) when outbid, else null.
 */
export function detectOutbidTransition(args: {
  wallet: string | undefined | null;
  prevHighestBidder: string | null | undefined;
  prevHighestBid: bigint | null | undefined;
  nextHighestBidder: string | null | undefined;
}): bigint | null {
  const wallet = args.wallet?.toLowerCase();
  if (!wallet || args.prevHighestBidder == null || args.prevHighestBid == null) {
    return null;
  }
  if (args.prevHighestBidder.toLowerCase() !== wallet) return null;
  if (args.prevHighestBid <= 0n) return null;
  const next = args.nextHighestBidder?.toLowerCase() ?? null;
  if (next === wallet) return null;
  return args.prevHighestBid;
}
