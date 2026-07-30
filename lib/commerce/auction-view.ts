import type {
  PonderAuctionPhase,
  PonderAuctionRaw,
  PonderSettlementRaw,
} from "@/lib/auction/map-ponder-auction";
import { CLOSE_REASON } from "@/lib/commerce/consignment";
import type {
  PonderConsignmentHoldRow,
  PonderConsignmentRow,
} from "@/lib/commerce/ponder-consignment";

/**
 * Bridge an indexed ascending consignment onto the auction view-model the lot
 * screens already speak. The indexer owns commerce truth; this only renames.
 */

function phaseFromConsignment(row: PonderConsignmentRow): PonderAuctionPhase {
  const hasBid = Boolean(row.terms?.highestBid && row.terms.highestBid !== "0");
  switch (row.phase) {
    case "offered":
      return hasBid ? "BIDDING" : "CREATED";
    case "binding":
      return "BIDDING";
    case "held":
      return row.hold?.state === "fundsReleased" ? "RELEASED" : "SETTLED";
    case "returned":
      return "RETURNED";
    case "closed":
      switch (row.closeReason) {
        case CLOSE_REASON.Sold:
        case CLOSE_REASON.ExternalConfirmed:
        case CLOSE_REASON.HoldReleased:
        case CLOSE_REASON.ReversalAbandoned:
          return "RELEASED";
        default:
          return "RETURNED";
      }
    default:
      return "CREATED";
  }
}

function settlementFromHold(
  hold: PonderConsignmentHoldRow | null | undefined,
): PonderSettlementRaw | null {
  if (!hold) return null;
  return {
    buyer: hold.buyer,
    gross: hold.gross,
    releaseAt: hold.protectionEndsAt,
    disputedAt: hold.reversalStartedAt ?? null,
    receiptConfirmedAt: hold.receiptConfirmedAt ?? null,
    releasedAt: hold.fundsReleasedAt ?? null,
    refundPendingAt: hold.abandonmentDeadline ?? null,
    autoRelease: hold.state === "active",
  };
}

/** Ascending consignment row → the `PonderAuctionRaw` shape lot screens map. */
export function consignmentToAuctionRaw(
  row: PonderConsignmentRow,
): PonderAuctionRaw {
  const terms = row.terms ?? null;
  const live = row.phase === "offered" || row.phase === "binding";

  return {
    id: row.id,
    tokenId: row.tokenId,
    chainId: row.chainId,
    seller: row.seller,
    agent: row.agent ?? undefined,
    asset: row.asset,
    reserve: terms?.reserve ?? row.floor,
    duration: terms?.duration ?? 0,
    agentFeeBps: row.commissionBps,
    ownerMinAsset: row.floor,
    startedAt: terms?.highestBid && terms.highestBid !== "0" ? row.openedAt : 0,
    endsAt: terms?.endsAt ?? 0,
    highestBidder: terms?.highestBidder ?? undefined,
    highestBid: terms?.highestBid ?? 0,
    active: live,
    phase: phaseFromConsignment(row),
    returnRequestedAt: row.recallRequestedAt ?? null,
    createdAt: row.openedAt,
    updatedAt: row.updatedAt,
    passportStatus: row.status ?? undefined,
    verifier: row.verifier ?? undefined,
    vin: row.vin ?? undefined,
    make: row.make ?? undefined,
    model: row.model ?? undefined,
    year: row.year ?? undefined,
    mileageKm: row.mileageKm ?? undefined,
    coverPhotoUri: row.coverPhotoUri ?? undefined,
    duplicateVin: row.duplicateVin ?? undefined,
    settlement: settlementFromHold(row.hold),
  };
}
