"use server";

import { getAddress } from "viem";

import {
  mapPonderListingToRow,
  type MarketplaceListingRow,
} from "@/lib/marketplace/map-ponder-listing";
import { fetchKarProMetadata } from "@/lib/kar-pro/fetch-kar-pro-metadata";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import type {
  PassportStatus,
  PonderVerifierAttestation,
  PonderVerifierDetail,
  VerifierRow,
} from "@/lib/types/ponder";
import { PRO_SLUGS } from "@/lib/web3/pro-slugs";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { getPublicClient } from "@/lib/web3/public-client";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

export type ProShowroomPassport = {
  tokenId: string;
  status: PassportStatus;
  make: string;
  model: string;
  year: number;
  verifiedAt: string;
};

export type ProShowroomData = {
  address: `0x${string}`;
  slug: string;
  verifier: VerifierRow | null;
  verifiedPassports: ProShowroomPassport[];
  verifiedPassportTotal: number;
  activeListings: MarketplaceListingRow[];
  recentAttestations: PonderVerifierAttestation[];
  attestationTotal: number;
  profileMetadata: { description?: string; website?: string } | null;
  isActiveVerifier: boolean;
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
  duplicateVin?: boolean;
  verifier?: string;
};

function isPassportStatus(value: string): value is PassportStatus {
  return value === "UNVERIFIED" || value === "VERIFIED" || value === "DISPUTED";
}

function mapVerifierDetail(raw: unknown, address: `0x${string}`): VerifierRow | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const detail = raw as PonderVerifierDetail;
  const identity = detail.identity;
  const stake = detail.stake;
  if (!identity) return null;

  return {
    address,
    category: Number(identity.category ?? 5),
    name: String(identity.name ?? ""),
    metadataURI: String(identity.metadataURI ?? ""),
    stakeAsset: stake?.asset != null ? Number(stake.asset) : undefined,
    stakeAmount: stake?.amount != null ? String(stake.amount) : undefined,
    active: stake?.active === true,
    joinedAt: detail.joinedAt != null ? String(detail.joinedAt) : undefined,
    leftAt: detail.leftAt != null ? String(detail.leftAt) : undefined,
    verificationCount: Number(detail.verificationCount ?? 0),
  };
}

function mapPassportRow(raw: Record<string, unknown>): ProShowroomPassport | null {
  const tokenId = String(raw.id ?? "");
  const statusRaw = typeof raw.status === "string" ? raw.status : "";
  if (!tokenId || !isPassportStatus(statusRaw)) return null;

  const year = typeof raw.year === "number" ? raw.year : Number(raw.year ?? 0);
  return {
    tokenId,
    status: statusRaw,
    make: typeof raw.make === "string" ? raw.make : "",
    model: typeof raw.model === "string" ? raw.model : "",
    year: Number.isFinite(year) ? year : 0,
    verifiedAt: raw.verifiedAt != null ? String(raw.verifiedAt) : "0",
  };
}

function mapListingRaw(listing: PonderListingRaw) {
  return mapPonderListingToRow({
    id: String(listing.id ?? listing.tokenId ?? ""),
    tokenId: String(listing.tokenId ?? listing.id ?? ""),
    seller: String(listing.seller ?? ""),
    fiatPrice1e8: listing.fiatPrice1e8 ?? "0",
    fiatCurrency: listing.fiatCurrency ?? 0,
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
    duplicateVin: listing.duplicateVin,
    verifier: listing.verifier,
  });
}

export async function getProShowroomData(slug: string): Promise<ProShowroomData | null> {
  const rawAddress = PRO_SLUGS[slug];
  if (!rawAddress) return null;

  let address: `0x${string}`;
  try {
    address = getAddress(rawAddress);
  } catch {
    return null;
  }

  let isActiveVerifier = false;
  const staking = karProStakingAddress(DEFAULT_CHAIN_ID);
  if (staking) {
    try {
      isActiveVerifier = await getPublicClient(DEFAULT_CHAIN_ID).readContract({
        address: staking,
        abi: KarProStakingAbi,
        functionName: "isActiveVerifier",
        args: [address],
      });
    } catch {
      /* remain false */
    }
  }

  const revalidate = { next: { revalidate: 30 } as const };

  let verifier: VerifierRow | null = null;
  let verifiedPassports: ProShowroomPassport[] = [];
  let verifiedPassportTotal = 0;
  let activeListings: MarketplaceListingRow[] = [];
  let recentAttestations: PonderVerifierAttestation[] = [];
  let attestationTotal = 0;

  try {
    const [verifierRes, passportsRes, listingsRes, attestationsRes] = await Promise.all([
      fetch(`${PONDER_URL}/verifiers/${address}`, revalidate),
      fetch(
        `${PONDER_URL}/passports?verifier=${address}&limit=100`,
        revalidate,
      ),
      fetch(`${PONDER_URL}/profile/${address}/listings`, revalidate),
      fetch(
        `${PONDER_URL}/verifiers/${address}/attestations?limit=100`,
        revalidate,
      ),
    ]);

    if (verifierRes.ok) {
      const raw = (await verifierRes.json()) as unknown;
      verifier = mapVerifierDetail(raw, address);
    }

    if (passportsRes.ok) {
      const data = (await passportsRes.json()) as {
        passports?: Array<Record<string, unknown>>;
        total?: number;
      };
      verifiedPassportTotal = Number(data.total ?? 0);
      verifiedPassports = (data.passports ?? [])
        .map(mapPassportRow)
        .filter((p): p is ProShowroomPassport => p != null);
    }

    if (listingsRes.ok) {
      const data = (await listingsRes.json()) as { listings?: PonderListingRaw[] };
      activeListings = (data.listings ?? [])
        .filter((l) => l.active === true)
        .map(mapListingRaw);
    }

    if (attestationsRes.ok) {
      const data = (await attestationsRes.json()) as {
        attestations?: PonderVerifierAttestation[];
        total?: number;
      };
      recentAttestations = data.attestations ?? [];
      attestationTotal = Number(data.total ?? recentAttestations.length);
    }
  } catch {
    /* return partial data with address */
  }

  let profileMetadata: { description?: string; website?: string } | null = null;
  if (verifier?.metadataURI) {
    profileMetadata = await fetchKarProMetadata(verifier.metadataURI);
  }

  return {
    address,
    slug,
    verifier,
    verifiedPassports,
    verifiedPassportTotal,
    activeListings,
    recentAttestations,
    attestationTotal,
    profileMetadata,
    isActiveVerifier,
  };
}
