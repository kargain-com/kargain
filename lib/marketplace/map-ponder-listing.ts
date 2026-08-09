import { legacyFiatFromCurrencyCode } from "@/lib/marketplace/currency-code";
import { formatPassportShortLabel } from "@/lib/passport/passport-token-id";
import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import type { PassportStatus, PonderAgentListingRaw } from "@/lib/types/ponder";
import { resolveUri } from "@/lib/storage/resolve-uri";

export type PonderListingInput = {
  id: string;
  tokenId: string;
  chainId: number;
  seller: string;
  /** Raw consignment price (fiat 1e8 or asset units). */
  price?: string | number;
  denominationKind?: number;
  asset?: string;
  /** Fiat 1e8 when denomination is Fiat; "0" for asset (not for display). */
  fiatPrice1e8: string | number;
  fiatCurrency?: number;
  currencyCode?: string;
  active: boolean;
  listedAt: string | number;
  passportStatus?: string;
  make?: string;
  model?: string;
  year?: number;
  mileageKm?: number;
  fuelType?: string;
  bodyType?: string;
  transmission?: string;
  tokenUri?: string;
  coverPhotoUri?: string;
  duplicateVin?: boolean;
  verifier?: string;
  agent?: string;
  lastDisputer?: string;
  returnRequestedAt?: string | number;
  externalPaymentConfirmedAt?: string | number;
};

export type MarketplaceListingRow = {
  chainId: number;
  tokenId: string;
  seller: `0x${string}`;
  /** Raw consignment price string. */
  price: string;
  denominationKind: number;
  asset: string;
  /** Fiat 1e8 when Fiat; "0" for asset lots (filters only). */
  fiatPrice1e8: string;
  fiatCurrency: number;
  /** ISO / decoded currency code when present (fiat lots). */
  currencyCode?: string | null;
  passportStatus: PassportStatus;
  updatedAtBlock: string;
  tokenUri: string;
  title: string;
  imageUrl: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  fuelType: string | null;
  bodyType: string | null;
  transmission: string | null;
  lat: number | null;
  lng: number | null;
  duplicateVin: boolean;
  verifier: string;
  lastDisputer: string;
  karPro: boolean;
  featured: boolean;
  agent: string | null;
  returnRequestedAt: string | null;
  externalPaymentConfirmedAt: string | null;
};

function buildTitle(listing: PonderListingInput): string {
  if (listing.year && listing.make && listing.model) {
    return `${listing.year} ${listing.make} ${listing.model}`;
  }
  if (listing.make && listing.model) return `${listing.make} ${listing.model}`;
  return `Vehicle ${formatPassportShortLabel(listing.tokenId, listing.chainId)}`;
}

function coverPhotoUrl(coverPhotoUri: string | undefined): string | null {
  if (!coverPhotoUri?.trim()) return null;
  return resolveUri(coverPhotoUri);
}

export function mapPonderListingToRow(listing: PonderListingInput): MarketplaceListingRow {
  const status = (listing.passportStatus ?? "UNVERIFIED") as PassportStatus;
  const denominationKind =
    listing.denominationKind === 0 || listing.denominationKind === 1
      ? listing.denominationKind
      : 1;
  const price =
    listing.price != null
      ? String(listing.price)
      : String(listing.fiatPrice1e8 ?? "0");
  return {
    chainId: listing.chainId,
    tokenId: listing.tokenId,
    seller: listing.seller as `0x${string}`,
    price,
    denominationKind,
    asset: listing.asset?.trim()
      ? listing.asset
      : "0x0000000000000000000000000000000000000000",
    fiatPrice1e8: String(listing.fiatPrice1e8),
    fiatCurrency: listing.fiatCurrency != null
      ? normalizeListingFiatCurrency(listing.fiatCurrency)
      : legacyFiatFromCurrencyCode(listing.currencyCode ?? "USD"),
    currencyCode: listing.currencyCode ?? null,
    passportStatus: status,
    updatedAtBlock: String(listing.listedAt),
    tokenUri: listing.tokenUri ?? "",
    title: buildTitle(listing),
    imageUrl: coverPhotoUrl(listing.coverPhotoUri),
    make: listing.make || null,
    model: listing.model || null,
    year: listing.year && listing.year > 0 ? listing.year : null,
    mileageKm: listing.mileageKm && listing.mileageKm > 0 ? listing.mileageKm : null,
    fuelType: listing.fuelType || null,
    bodyType: listing.bodyType || null,
    transmission: listing.transmission || null,
    lat: null,
    lng: null,
    duplicateVin: listing.duplicateVin === true,
    verifier: listing.verifier ?? "",
    lastDisputer: listing.lastDisputer ?? "",
    karPro: false,
    featured: status === "VERIFIED",
    agent: listing.agent?.trim() ? listing.agent : null,
    returnRequestedAt:
      listing.returnRequestedAt != null && String(listing.returnRequestedAt) !== "0"
        ? String(listing.returnRequestedAt)
        : null,
    externalPaymentConfirmedAt:
      listing.externalPaymentConfirmedAt != null &&
      String(listing.externalPaymentConfirmedAt) !== "0"
        ? String(listing.externalPaymentConfirmedAt)
        : null,
  };
}

export function mapAgentListingToRow(
  listing: PonderAgentListingRaw,
): MarketplaceListingRow {
  const chainId = Number(listing.chainId);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error("Agent listing missing chainId");
  }
  return mapPonderListingToRow({
    id: String(listing.id ?? listing.tokenId ?? ""),
    tokenId: String(listing.tokenId ?? listing.id ?? ""),
    chainId,
    seller: String(listing.seller ?? ""),
    fiatPrice1e8: listing.fiatPrice1e8 ?? "0",
    fiatCurrency: listing.fiatCurrency,
    currencyCode: listing.currencyCode,
    active: listing.active === true,
    listedAt: listing.listedAt ?? "0",
    passportStatus: listing.passportStatus,
    make: listing.make,
    model: listing.model,
    year: listing.year,
    mileageKm: listing.mileageKm,
    fuelType: listing.fuelType,
    bodyType: listing.bodyType,
    transmission: listing.transmission,
    tokenUri: listing.tokenUri,
    coverPhotoUri: listing.coverPhotoUri,
    duplicateVin: listing.duplicateVin,
    verifier: listing.verifier,
    agent: listing.agent,
    lastDisputer: listing.lastDisputer,
    returnRequestedAt: listing.returnRequestedAt,
    externalPaymentConfirmedAt: listing.externalPaymentConfirmedAt,
  });
}
