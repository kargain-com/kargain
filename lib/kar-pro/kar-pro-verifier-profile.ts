import type { KarProVerifierProfile } from "@/lib/verifier/verifier-profile-types";
import { parseKarProMetadataJson } from "@/lib/kar-pro/kar-pro-metadata";
import { arUriToHttp } from "@/lib/storage/ar-gateway";

export const KAR_PRO_VERIFIER_POLL_INTERVAL_MS = 3_000;
export const KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS = 30;

export function shouldPollKarProVerifierProfile(
  data: KarProVerifierProfile | null | undefined,
  fetchFailureCount: number,
  syncWhileMissing: boolean,
): number | false {
  if (!syncWhileMissing) return false;
  if (data) return false;
  if (fetchFailureCount >= KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS) return false;
  return KAR_PRO_VERIFIER_POLL_INTERVAL_MS;
}

export type ChainKarProProfileInput = {
  address: string;
  category: number;
  name: string;
  metadataURI: string;
  joinedAt: number;
  slug?: string;
};

export function buildKarProProfileFromChain(
  input: ChainKarProProfileInput,
): KarProVerifierProfile {
  return {
    address: input.address,
    category: input.category,
    name: input.name,
    slug: input.slug ?? "",
    metadataURI: input.metadataURI,
    active: true,
    joinedAt: input.joinedAt,
    verificationCount: 0,
    verificationFee: 0n,
  };
}

function metadataUriToHttp(uri: string): string | null {
  const trimmed = uri.trim();
  if (trimmed.startsWith("ar://")) {
    return arUriToHttp(trimmed);
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return null;
}

export async function resolveKarProSlugFromMetadataUri(uri: string): Promise<string> {
  try {
    const url = metadataUriToHttp(uri);
    if (!url) return "";

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return "";

    const text = await res.text();
    const metadata = parseKarProMetadataJson(text);
    return metadata?.slug ?? "";
  } catch {
    return "";
  }
}

export function resolveKarProJoinedAt(
  stakedAt: bigint | number | undefined,
  issuedAtTimestamp: bigint | number | undefined,
): number {
  const staked = Number(stakedAt ?? 0);
  if (Number.isFinite(staked) && staked > 0) return staked;
  const issued = Number(issuedAtTimestamp ?? 0);
  if (Number.isFinite(issued) && issued > 0) return issued;
  return 0;
}
