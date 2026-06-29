import type { KarProVerifierProfile } from "@/lib/verifier/verifier-profile-types";
import type { VerifierPassportRow } from "@/app/actions/marketplace-listings";
import { fetchVerifierDetail } from "@/lib/passport/fetch-passport-detail";
import type { PassportStatus, PonderVerifierAttestation } from "@/lib/types/ponder";

import { mapVerifierDetailToProfile } from "./map-verifier-profile";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

export function buildVerifierPassportsQueryUrl(
  address: string,
  baseUrl: string = PONDER_URL,
): string {
  const url = new URL(`${baseUrl}/passports`);
  url.searchParams.set("verifier", address);
  url.searchParams.set("status", "VERIFIED");
  url.searchParams.set("limit", "100");
  return url.toString();
}

export function buildVerifierAttestationsQueryUrl(
  address: string,
  baseUrl: string = PONDER_URL,
  limit = 100,
): string {
  const url = new URL(`${baseUrl}/verifiers/${address}/attestations`);
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

export type VerifierPublicPassportRow = VerifierPassportRow & {
  verifiedAt: string;
};

export type VerifierPublicData = {
  profile: KarProVerifierProfile | null;
  verifiedPassports: VerifierPublicPassportRow[];
  verifiedPassportTotal: number;
  attestations: PonderVerifierAttestation[];
  attestationTotal: number;
};

type FetchOptions = { fresh?: boolean };

function ponderFetchInit(options?: FetchOptions): RequestInit {
  return options?.fresh ? { cache: "no-store" } : { next: { revalidate: 30 } };
}

function mapVerifierPassportRow(p: Record<string, unknown>): VerifierPublicPassportRow {
  return {
    tokenId: String(p.id ?? ""),
    status: (p.status as PassportStatus) ?? "UNVERIFIED",
    make: typeof p.make === "string" ? p.make : "",
    model: typeof p.model === "string" ? p.model : "",
    year: typeof p.year === "number" ? p.year : Number(p.year ?? 0),
    verifiedAt: p.verifiedAt != null ? String(p.verifiedAt) : "0",
  };
}

export async function fetchVerifierPublicData(
  address: string,
  options?: FetchOptions,
): Promise<VerifierPublicData> {
  const fetchInit = ponderFetchInit(options);

  const passportsUrl = buildVerifierPassportsQueryUrl(address);
  const attestationsUrl = buildVerifierAttestationsQueryUrl(address);

  const [detail, passportsRes, attestationsRes] = await Promise.all([
    fetchVerifierDetail(address, options),
    fetch(passportsUrl, fetchInit),
    fetch(attestationsUrl, fetchInit),
  ]);

  let verifiedPassports: VerifierPublicPassportRow[] = [];
  let verifiedPassportTotal = 0;
  if (passportsRes.ok) {
    const data = (await passportsRes.json()) as {
      passports?: Array<Record<string, unknown>>;
      total?: number;
    };
    verifiedPassportTotal = Number(data.total ?? 0);
    verifiedPassports = (data.passports ?? []).map(mapVerifierPassportRow);
  }

  let attestations: PonderVerifierAttestation[] = [];
  let attestationTotal = 0;
  if (attestationsRes.ok) {
    const data = (await attestationsRes.json()) as {
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
