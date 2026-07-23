"use server";

import { getAddress } from "viem";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

import {
  mapAgentListingToRow,
  type MarketplaceListingRow,
} from "@/lib/marketplace/map-ponder-listing";
import { isActiveVerifierOnCommercialChains } from "@/lib/kar-pro/is-active-verifier-commercial";
import { fetchKarProMetadata } from "@/lib/kar-pro/fetch-kar-pro-metadata";
import { fetchVerifierPublicData } from "@/lib/verifier/fetch-verifier-public-data";
import type {
  PassportStatus,
  PonderVerifierAttestation,
  VerifierRow,
} from "@/lib/types/ponder";

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

type PonderListingRaw = {
  id?: string;
  tokenId?: string;
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
  return mapAgentListingToRow(listing);
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

export async function getProShowroomData(slug: string): Promise<ProShowroomData | null> {
  let address: `0x${string}`;
  try {
    const verifierBySlug = await ponderFetch(`${ponderBaseUrl()}/verifiers/by-slug/${encodeURIComponent(slug)}`);
    if (!verifierBySlug.ok) return null;
    const data = (await verifierBySlug.json()) as { address?: string };
    if (!data.address) return null;
    address = getAddress(data.address);
  } catch {
    return null;
  }

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
    const [activeOnChain, verifierData, listingsRes, consignmentsRes] = await Promise.all([
      isActiveVerifierOnCommercialChains(address),
      fetchVerifierPublicData(address),
      ponderFetch(`${ponderBaseUrl()}/profile/${address}/listings`),
      ponderFetch(
        `${ponderBaseUrl()}/agents/${address}/listings?active=true&limit=100`,
      ),
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

    if (consignmentsRes.ok) {
      const data = (await consignmentsRes.json()) as {
        listings?: PonderListingRaw[];
        total?: number;
      };
      activeConsignments = (data.listings ?? []).map(mapListingRaw);
      activeConsignmentTotal = data.total ?? activeConsignments.length;
    }
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
