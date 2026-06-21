"use server";

import { fetchVerifierDetail } from "@/lib/passport/fetch-passport-detail";
import type { PassportStatus } from "@/lib/types/ponder";

export type DisputedPassportRow = {
  tokenId: string;
  status: PassportStatus;
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
): Promise<KarProVerifierProfile | null> {
  const detail = await fetchVerifierDetail(address);
  if (!detail) return null;

  const identity = detail.identity as {
    category?: number;
    name?: string;
    slug?: string;
    metadataURI?: string;
  };
  const stake = detail.stake as { active?: boolean };
  const disputedRaw =
    (detail.disputedPassports as Array<{ id?: string; status?: string }> | undefined) ?? [];

  return {
    address: String(detail.address ?? address),
    category: Number(identity.category ?? 5),
    name: String(identity.name ?? ""),
    slug: String(identity.slug ?? ""),
    metadataURI: String(identity.metadataURI ?? ""),
    active: stake.active === true,
    joinedAt: Number(detail.joinedAt ?? 0),
    verificationCount: Number(detail.verificationCount ?? 0),
    disputedPassports: disputedRaw.map((p) => ({
      tokenId: String(p.id ?? ""),
      status: (p.status as PassportStatus) ?? "DISPUTED",
    })),
  };
}
