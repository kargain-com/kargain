import type { KarProVerifierProfile } from "@/lib/verifier/verifier-profile-types";
import type { VerifierPassportRow } from "@/app/actions/marketplace-listings";
import { fetchVerifierDetail } from "@/lib/passport/fetch-passport-detail";
import type { PassportStatus, PonderVerifierAttestation } from "@/lib/types/ponder";
import { resolveUri } from "@/lib/storage/resolve-uri";
import {
  buildVerifierAttestationsUrl,
  buildVerifierPassportsUrl,
  ponderFetch,
} from "@/lib/web3/ponder-fetch";

import { mapVerifierDetailToProfile } from "./map-verifier-profile";

export function buildVerifierPassportsQueryUrl(address: string): string {
  return buildVerifierPassportsUrl(address);
}

export function buildVerifierAttestationsQueryUrl(
  address: string,
  limit = 100,
): string {
  return buildVerifierAttestationsUrl(address, limit);
}

export type VerifierPublicPassportRow = VerifierPassportRow & {
  verifiedAt: string;
  /** Origin / mint home. */
  chainId: number;
  /** Where the token lives — detail links use this. */
  custodyChain: number;
  /** Resolved cover HTTP URL, or null when absent. */
  imageUrl: string | null;
  vin: string | null;
};

export type VerifierPublicData = {
  profile: KarProVerifierProfile | null;
  verifiedPassports: VerifierPublicPassportRow[];
  verifiedPassportTotal: number;
  attestations: PonderVerifierAttestation[];
  attestationTotal: number;
};

function parsePositiveChainId(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

function coverImageUrl(coverPhotoUri: unknown): string | null {
  if (typeof coverPhotoUri !== "string" || !coverPhotoUri.trim()) return null;
  return resolveUri(coverPhotoUri);
}

function mapVerifierPassportRow(
  p: Record<string, unknown>,
): VerifierPublicPassportRow | null {
  const chainId = parsePositiveChainId(p.chainId);
  if (chainId == null) return null;
  const custodyChain = parsePositiveChainId(p.custodyChain) ?? chainId;
  const yearRaw = typeof p.year === "number" ? p.year : Number(p.year ?? 0);
  const vinRaw = typeof p.vin === "string" ? p.vin.trim() : "";
  return {
    tokenId: String(p.id ?? ""),
    status: (p.status as PassportStatus) ?? "UNVERIFIED",
    make: typeof p.make === "string" ? p.make : "",
    model: typeof p.model === "string" ? p.model : "",
    year: Number.isFinite(yearRaw) && yearRaw > 0 ? Math.trunc(yearRaw) : 0,
    verifiedAt: p.verifiedAt != null ? String(p.verifiedAt) : "0",
    chainId,
    custodyChain,
    imageUrl: coverImageUrl(p.coverPhotoUri),
    vin: vinRaw || null,
  };
}

export async function fetchVerifierPublicData(
  address: string,
  chainId?: number,
): Promise<VerifierPublicData> {
  const passportsUrl = buildVerifierPassportsQueryUrl(address);
  const attestationsUrl = buildVerifierAttestationsQueryUrl(address);

  const [detail, passportsRes, attestationsRes] = await Promise.all([
    fetchVerifierDetail(address, chainId),
    ponderFetch("passports", passportsUrl),
    ponderFetch("verifiers", attestationsUrl),
  ]);

  let verifiedPassports: VerifierPublicPassportRow[] = [];
  let verifiedPassportTotal = 0;
  if (passportsRes.ok) {
    const data = passportsRes.body as {
      passports?: Array<Record<string, unknown>>;
      total?: number;
    };
    verifiedPassportTotal = Number(data.total ?? 0);
    verifiedPassports = (data.passports ?? [])
      .map(mapVerifierPassportRow)
      .filter((row): row is VerifierPublicPassportRow => row != null);
  }

  let attestations: PonderVerifierAttestation[] = [];
  let attestationTotal = 0;
  if (attestationsRes.ok) {
    const data = attestationsRes.body as {
      attestations?: PonderVerifierAttestation[];
      total?: number;
    };
    attestations = data.attestations ?? [];
    attestationTotal = Number(data.total ?? attestations.length);
  }

  const profile =
    detail != null && typeof detail === "object" && !Array.isArray(detail)
      ? mapVerifierDetailToProfile(detail as Record<string, unknown>, address)
      : null;

  return {
    profile,
    verifiedPassports,
    verifiedPassportTotal,
    attestations,
    attestationTotal,
  };
}
