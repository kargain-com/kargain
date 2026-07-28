import type { PonderAuctionPhase } from "@/lib/auction/map-ponder-auction";

/**
 * S9 terminal readout copy — distinct per phase.
 * CANCELLED / RETURNED are pre-start only (no bids).
 */
export function auctionTerminalMessage(phase: PonderAuctionPhase | string): string {
  if (phase === "CANCELLED") {
    return "The auction was cancelled before any qualifying bid. The vehicle returned to the owner.";
  }
  if (phase === "RETURNED") {
    return "The owner recalled this vehicle before any qualifying bid.";
  }
  return "This auction is closed.";
}
