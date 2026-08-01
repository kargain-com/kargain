/**
 * Public ascending-mode claims — copy narrowed to AscendingConsignment behaviour.
 * UI and design-spec cite these; extension minutes come from live chain/snapshot.
 */

export const ASCENDING_RESERVE_INTRO =
  "Auctions are open to professional sellers with verified vehicles. The reserve is public and bidding starts at or above it.";

export const ASCENDING_RESERVE_HELP =
  "Lowest price you will accept. Shown to everyone.";

/** After first qualifying bid: no cancel / withdraw / recall. */
export const ASCENDING_NO_CANCEL_AFTER_BID =
  "After the first qualifying bid the seller cannot cancel, withdraw, or recall — settlement is the only exit.";

/** Pre-first-bid cancel guard on the cancel panel. */
export const ASCENDING_CANCEL_BEFORE_FIRST_BID =
  "You can cancel only before the first qualifying bid.";

/** S1: auction not yet binding. */
export const ASCENDING_S1_HELP =
  "The auction starts when someone bids at least the reserve. Until then the seller can cancel or withdraw.";

export const ASCENDING_BID_HELD =
  "Every bid is held in full by the contract until you are outbid or you win. Outbid funds are released; if they do not arrive, withdraw them under Claims.";

/**
 * Opener protection-window trade — longer hold vs faster settle.
 * Body copy under the day picker; does not change which day is pre-selected.
 */
export const ASCENDING_PROTECTION_TRADE =
  "A longer hold gives the buyer more time after delivery; a shorter hold settles your payment sooner.";

/** Seconds → whole minutes for extension copy. Returns null when unread/invalid. */
export function extensionWindowMinutes(
  extensionWindowSec: bigint | null | undefined,
): number | null {
  if (extensionWindowSec == null) return null;
  const sec = Number(extensionWindowSec);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.max(1, Math.round(sec / 60));
}

export function formatExtensionHelp(
  extensionWindowSec: bigint | null | undefined,
): string | null {
  const mins = extensionWindowMinutes(extensionWindowSec);
  if (mins == null) return null;
  return `Bids in the last ${mins} minutes extend the auction by ${mins} minutes.`;
}

export function formatExtensionFlash(
  extensionWindowSec: bigint | null | undefined,
): string | null {
  const mins = extensionWindowMinutes(extensionWindowSec);
  if (mins == null) return null;
  return `Extended by ${mins} minutes`;
}

export function formatOutbidToastMessage(amountLabel: string): string {
  return `You were outbid. Your ${amountLabel} was released. If it did not arrive in your wallet, check Claims.`;
}
