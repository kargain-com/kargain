import { arUriToHttp } from "@/lib/passport/index-passport-metadata";
import type { PassportStatus } from "@/lib/types/ponder";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export type PonderListingInput = {
  id: string;
  tokenId: string;
  seller: string;
  fiatPrice1e8: string | number;
  fiatCurrency: number;
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
  duplicateVin?: boolean;
  verifier?: string;
};

export type MarketplaceListingRow = {
  chainId: number;
  tokenId: string;
  seller: `0x${string}`;
  fiatPrice1e8: string;
  fiatCurrency: number;
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
  karPro: boolean;
  featured: boolean;
};

function buildTitle(listing: PonderListingInput): string {
  if (listing.year && listing.make && listing.model) {
    return `${listing.year} ${listing.make} ${listing.model}`;
  }
  if (listing.make && listing.model) return `${listing.make} ${listing.model}`;
  return `Vehicle #${listing.tokenId}`;
}

function photoFromUri(tokenUri: string | undefined): string | null {
  if (!tokenUri?.startsWith("ar://")) return null;
  return arUriToHttp(tokenUri);
}

export function mapPonderListingToRow(listing: PonderListingInput): MarketplaceListingRow {
  const status = (listing.passportStatus ?? "UNVERIFIED") as PassportStatus;
  return {
    chainId: DEFAULT_CHAIN_ID,
    tokenId: listing.tokenId,
    seller: listing.seller as `0x${string}`,
    fiatPrice1e8: String(listing.fiatPrice1e8),
    fiatCurrency: listing.fiatCurrency,
    passportStatus: status,
    updatedAtBlock: String(listing.listedAt),
    tokenUri: listing.tokenUri ?? "",
    title: buildTitle(listing),
    imageUrl: photoFromUri(listing.tokenUri),
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
    karPro: false,
    featured: status === "VERIFIED",
  };
}
