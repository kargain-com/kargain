import type { PonderAuctionPhase } from "@/lib/auction/map-ponder-auction";

/**
 * S9 terminal readout copy — distinct per phase.
 * CANCELLED / RETURNED are pre-start only (no bids); VOIDED had bids refunded.
 */
export function auctionTerminalMessage(
  phase: PonderAuctionPhase | string,
  voidReason: string,
): string {
  if (phase === "CANCELLED") {
    return "The auction was cancelled before any qualifying bid. The vehicle returned to the owner.";
  }
  if (phase === "RETURNED") {
    return "The owner recalled this vehicle before any qualifying bid.";
  }
  const reason = voidReason.trim() || "ended";
  return `Auction voided — ${reason}. All bids were refunded automatically.`;
}
