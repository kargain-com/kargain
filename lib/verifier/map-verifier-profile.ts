import type {
  DisputedPassportRow,
  KarProVerifierProfile,
} from "@/lib/verifier/verifier-profile-types";
import { parseReturnRequestedAt } from "@/lib/marketplace/listing-agent";
import type { PassportStatus } from "@/lib/types/ponder";

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
  const disputedRaw =
    (detail.disputedPassports as
      | Array<{
          id?: string;
          status?: string;
          make?: string;
          model?: string;
          year?: number;
          disputeReason?: string;
          disputeOpenedAt?: string | number;
          lastDisputer?: string;
        }>
      | undefined) ?? [];

  return {
    address: String(detail.address ?? address),
    category: Number(identity?.category ?? 5),
    name: String(identity?.name ?? ""),
    slug: String(identity?.slug ?? ""),
    metadataURI: String(identity?.metadataURI ?? ""),
    active: stake?.active === true,
    joinedAt: Number(detail.joinedAt ?? 0),
    verificationCount: Number(detail.verificationCount ?? 0),
    verificationFee: parseReturnRequestedAt(
      detail.verificationFee as string | number | bigint | undefined | null,
    ),
    disputedPassports: disputedRaw.map((p) => {
      const year = Number(p.year ?? 0);
      const disputeOpenedAt = Number(p.disputeOpenedAt ?? 0);
      return {
        tokenId: String(p.id ?? ""),
        status: (p.status as PassportStatus) ?? "DISPUTED",
        make: String(p.make ?? ""),
        model: String(p.model ?? ""),
        year: Number.isFinite(year) ? year : 0,
        disputeReason: String(p.disputeReason ?? ""),
        disputeOpenedAt: Number.isFinite(disputeOpenedAt) ? disputeOpenedAt : 0,
        lastDisputer: String(p.lastDisputer ?? ""),
      } satisfies DisputedPassportRow;
    }),
  };
}
