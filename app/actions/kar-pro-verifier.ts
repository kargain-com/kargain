"use server";

import { fetchVerifierDetail } from "@/lib/passport/fetch-passport-detail";
import type { PassportStatus } from "@/lib/types/ponder";

export type DisputedPassportRow = {
  tokenId: string;
  status: PassportStatus;
  make: string;
  model: string;
  year: number;
  disputeReason: string;
  disputeOpenedAt: number;
  lastDisputer: string;
};

export type KarProVerifierProfile = {
  address: string;
  category: number;
  name: string;
  slug: string;
  metadataURI: string;
  active: boolean;
  joinedAt: number;
  verificationCount: number;
  disputedPassports: DisputedPassportRow[];
};

export async function fetchKarProVerifierProfile(
  address: string,
  options?: { fresh?: boolean },
): Promise<KarProVerifierProfile | null> {
  const detail = await fetchVerifierDetail(address, options);
  if (!detail) return null;

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
    category: Number(identity.category ?? 5),
    name: String(identity.name ?? ""),
    slug: String(identity.slug ?? ""),
    metadataURI: String(identity.metadataURI ?? ""),
    active: stake.active === true,
    joinedAt: Number(detail.joinedAt ?? 0),
    verificationCount: Number(detail.verificationCount ?? 0),
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
      };
    }),
  };
}
