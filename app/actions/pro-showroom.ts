"use server";

import { getConsignments } from "@/app/actions/commerce-consignments";
import { consignmentRecordToListingInput } from "@/lib/commerce/listing-view";
import { fetchKarProMetadata } from "@/lib/kar-pro/fetch-kar-pro-metadata";
import {
  isActiveVerifierOnChain,
  resolveProShowroomBySlug,
  type ProShowroomSlugCandidate,
} from "@/lib/kar-pro/resolve-pro-showroom";
import {
  mapPonderListingToRow,
  type MarketplaceListingRow,
} from "@/lib/marketplace/map-ponder-listing";
import { fetchVerifierPublicData } from "@/lib/verifier/fetch-verifier-public-data";
import type {
  PassportStatus,
  PonderVerifierAttestation,
  VerifierRow,
} from "@/lib/types/ponder";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

export type ProShowroomPassport = {
  tokenId: string;
  status: PassportStatus;
  make: string;
  model: string;
  year: number;
  verifiedAt: string;
  /** Origin / mint home. */
  chainId: number;
  /** Where the token lives — detail links use this. */
  custodyChain: number;
};

export type ProShowroomData = {
  address: `0x${string}`;
  slug: string;
  /** Membership network for this showroom session. */
  chainId: number;
  verifier: VerifierRow | null;
  verifiedPassports: ProShowroomPassport[];
  verifiedPassportTotal: number;
  activeListings: MarketplaceListingRow[];
  activeConsignments: MarketplaceListingRow[];
  activeConsignmentTotal: number;
  recentAttestations: PonderVerifierAttestation[];
  attestationTotal: number;
  profileMetadata: { slug?: string; description?: string; website?: string } | null;
  isActiveVerifier: boolean;
  verificationFee: bigint;
};

export type GetProShowroomResult =
  | { kind: "resolved"; data: ProShowroomData }
  | { kind: "ambiguous"; slug: string; candidates: ProShowroomSlugCandidate[] }
  | { kind: "missing" };

type PonderListingRaw = {
  id?: string;
  tokenId?: string;
  chainId?: number;
  seller?: string;
  fiatPrice1e8?: string | number;
  fiatCurrency?: number;
  active?: boolean;
  listedAt?: string | number;
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
};

function mapListingRaw(listing: PonderListingRaw) {
  return mapPonderListingToRow({
    id: String(listing.id ?? listing.tokenId ?? ""),
    tokenId: String(listing.tokenId ?? listing.id ?? ""),
    chainId: Number(listing.chainId ?? 0),
    seller: String(listing.seller ?? ""),
    fiatPrice1e8: listing.fiatPrice1e8 ?? "0",
    fiatCurrency: listing.fiatCurrency,
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
  });
}

function mapVerifierRow(
  profile: NonNullable<Awaited<ReturnType<typeof fetchVerifierPublicData>>["profile"]>,
  address: `0x${string}`,
): VerifierRow {
  return {
    address,
    category: profile.category,
    name: profile.name,
    slug: profile.slug,
    metadataURI: profile.metadataURI,
    active: profile.active,
    joinedAt: profile.joinedAt > 0 ? String(profile.joinedAt) : undefined,
    verificationCount: profile.verificationCount,
  };
}

async function loadResolvedShowroom(
  slug: string,
  chainId: number,
  address: `0x${string}`,
): Promise<ProShowroomData> {
  let isActiveVerifier = false;
  let verifier: VerifierRow | null = null;
  let verifiedPassports: ProShowroomPassport[] = [];
  let verifiedPassportTotal = 0;
  let activeListings: MarketplaceListingRow[] = [];
  let activeConsignments: MarketplaceListingRow[] = [];
  let activeConsignmentTotal = 0;
  let recentAttestations: PonderVerifierAttestation[] = [];
  let attestationTotal = 0;
  let verificationFee = 0n;

  try {
    const [activeOnChain, verifierData, listingsRes, consignmentsPage] =
      await Promise.all([
        isActiveVerifierOnChain(address, chainId),
        fetchVerifierPublicData(address, chainId),
        ponderFetch(`${ponderBaseUrl()}/profile/${address}/listings`),
        getConsignments({ agent: address, live: true, page: 1, limit: 100 }),
      ]);

    isActiveVerifier = activeOnChain === true;

    if (verifierData.profile) {
      verifier = mapVerifierRow(verifierData.profile, address);
      verificationFee = verifierData.profile.verificationFee;
    }

    verifiedPassportTotal = verifierData.verifiedPassportTotal;
    verifiedPassports = verifierData.verifiedPassports.map((p) => ({
      tokenId: p.tokenId,
      status: p.status,
      make: p.make,
      model: p.model,
      year: p.year,
      verifiedAt: p.verifiedAt,
      chainId: p.chainId,
      custodyChain: p.custodyChain,
    }));

    recentAttestations = verifierData.attestations;
    attestationTotal = verifierData.attestationTotal;

    if (listingsRes.ok) {
      const data = (await listingsRes.json()) as { listings?: PonderListingRaw[] };
      activeListings = (data.listings ?? [])
        .filter((l) => l.active === true)
        .map(mapListingRaw);
    }

    activeConsignments = consignmentsPage.rows.map((row) =>
      mapPonderListingToRow(consignmentRecordToListingInput(row)),
    );
    activeConsignmentTotal = consignmentsPage.ponderError
      ? 0
      : consignmentsPage.total;
  } catch {
    /* return partial data with address */
  }

  let profileMetadata: { slug?: string; description?: string; website?: string } | null = null;
  if (verifier?.metadataURI) {
    profileMetadata = await fetchKarProMetadata(verifier.metadataURI);
  }
  if (profileMetadata && verifier?.slug && !profileMetadata.slug) {
    profileMetadata.slug = verifier.slug;
  }

  return {
    address,
    slug,
    chainId,
    verifier,
    verifiedPassports,
    verifiedPassportTotal,
    activeListings,
    activeConsignments,
    activeConsignmentTotal,
    recentAttestations,
    attestationTotal,
    profileMetadata,
    isActiveVerifier,
    verificationFee,
  };
}

/**
 * Showroom membership from slug + optional `chainId` (URL `?chain=`).
 * Ambiguous slug without chain → chooser candidates (never silent limit(1)).
 */
export async function getProShowroomData(
  slug: string,
  chainId: number | null = null,
): Promise<GetProShowroomResult> {
  const resolved = await resolveProShowroomBySlug(slug, chainId);
  if (resolved.kind === "missing") return { kind: "missing" };
  if (resolved.kind === "ambiguous") {
    return { kind: "ambiguous", slug, candidates: resolved.candidates };
  }
  const data = await loadResolvedShowroom(
    slug,
    resolved.chainId,
    resolved.address,
  );
  return { kind: "resolved", data };
}
