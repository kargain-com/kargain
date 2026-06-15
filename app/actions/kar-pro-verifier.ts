"use server";

import { fetchVerifierDetail } from "@/lib/passport/fetch-passport-detail";

export type KarProVerifierProfile = {
  address: string;
  category: number;
  name: string;
  metadataURI: string;
  active: boolean;
  joinedAt: number;
  verificationCount: number;
};

export async function fetchKarProVerifierProfile(
  address: string,
): Promise<KarProVerifierProfile | null> {
  const detail = await fetchVerifierDetail(address);
  if (!detail) return null;

  const identity = detail.identity as {
    category?: number;
    name?: string;
    metadataURI?: string;
  };
  const stake = detail.stake as { active?: boolean };

  return {
    address: String(detail.address ?? address),
    category: Number(identity.category ?? 5),
    name: String(identity.name ?? ""),
    metadataURI: String(identity.metadataURI ?? ""),
    active: stake.active === true,
    joinedAt: Number(detail.joinedAt ?? 0),
    verificationCount: Number(detail.verificationCount ?? 0),
  };
}
