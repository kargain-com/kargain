import { DENOMINATION_KIND } from "@/lib/commerce/denomination";
import type {
  ConsignmentRecord,
  PonderConsignmentRow,
} from "@/lib/commerce/ponder-consignment";
import type { PonderListingInput } from "@/lib/marketplace/map-ponder-listing";

/**
 * Bridge an indexed fixed-price consignment onto the browse listing shape.
 * Asset-denominated lots have no fiat price; they carry `0` so cards fall back
 * to the on-chain quote rather than inventing a converted number.
 */
function consignmentFieldsToListingInput(
  row: {
    id: string;
    tokenId: string;
    chainId: number;
    seller: string;
    denominationKind: number;
    price: string | bigint;
    currencyCode?: string | null;
    phase: string;
    openedAt: string | number;
    status?: string | null;
    make?: string | null;
    model?: string | null;
    year?: number | null;
    mileageKm?: number | null;
    coverPhotoUri?: string | null;
    duplicateVin?: boolean | null;
    verifier?: string | null;
    agent?: string | null;
    recallRequestedAt?: string | bigint | null;
    closeReason?: number | null;
    buyer?: string | null;
    closedAt?: string | number | null;
  },
): PonderListingInput {
  const fiat = row.denominationKind === DENOMINATION_KIND.Fiat;
  const price =
    typeof row.price === "bigint" ? row.price.toString() : row.price;
  return {
    id: row.id,
    tokenId: row.tokenId,
    chainId: row.chainId,
    seller: row.seller,
    fiatPrice1e8: fiat ? price : "0",
    currencyCode: fiat ? (row.currencyCode ?? "USD") : "USD",
    active: row.phase === "offered" || row.phase === "binding",
    listedAt: row.openedAt,
    passportStatus: row.status ?? undefined,
    make: row.make ?? undefined,
    model: row.model ?? undefined,
    year: row.year ?? undefined,
    mileageKm: row.mileageKm ?? undefined,
    coverPhotoUri: row.coverPhotoUri ?? undefined,
    duplicateVin: row.duplicateVin ?? undefined,
    verifier: row.verifier ?? undefined,
    agent: row.agent ?? undefined,
    returnRequestedAt:
      row.recallRequestedAt != null
        ? typeof row.recallRequestedAt === "bigint"
          ? row.recallRequestedAt.toString()
          : row.recallRequestedAt
        : undefined,
    externalPaymentConfirmedAt:
      row.closeReason != null && row.buyer ? (row.closedAt ?? undefined) : undefined,
  };
}

export function consignmentToListingInput(
  row: PonderConsignmentRow,
): PonderListingInput {
  return consignmentFieldsToListingInput(row);
}

/** Mapped consignment row → browse listing shape (agent catalog cards). */
export function consignmentRecordToListingInput(
  row: ConsignmentRecord,
): PonderListingInput {
  return consignmentFieldsToListingInput({
    id: row.id,
    tokenId: row.tokenId,
    chainId: row.chainId,
    seller: row.seller,
    denominationKind: row.denominationKind,
    price: row.price,
    currencyCode: row.currencyCode,
    phase: row.phase,
    openedAt: row.openedAt,
    status: row.status,
    make: row.make,
    model: row.model,
    year: row.year,
    mileageKm: row.mileageKm,
    coverPhotoUri: row.coverPhotoUri,
    duplicateVin: row.duplicateVin,
    verifier: row.verifier,
    agent: row.agent,
    recallRequestedAt: row.recallRequestedAt,
    closeReason: row.closeReason,
    buyer: row.buyer,
    closedAt: row.closedAt,
  });
}
