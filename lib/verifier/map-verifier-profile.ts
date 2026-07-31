import type { KarProVerifierProfile } from "@/lib/verifier/verifier-profile-types";
import { parseWeiString } from "@/lib/web3/parse-wei-string";

export function mapVerifierDetailToProfile(
  detail: Record<string, unknown>,
  address: string,
): KarProVerifierProfile {
  const identity = detail.identity as {
    category?: number;
    name?: string;
    slug?: string;
    metadataURI?: string;
  };
  const stake = detail.stake as { active?: boolean };

  return {
    address: String(detail.address ?? address),
    category: Number(identity?.category ?? 5),
    name: String(identity?.name ?? ""),
    slug: String(identity?.slug ?? ""),
    metadataURI: String(identity?.metadataURI ?? ""),
    active: stake?.active === true,
    joinedAt: Number(detail.joinedAt ?? 0),
    verificationCount: Number(detail.verificationCount ?? 0),
    verificationFee: parseWeiString(
      detail.verificationFee as string | number | bigint | undefined | null,
    ),
  };
}
