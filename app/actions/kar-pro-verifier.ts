"use server";

import { fetchVerifierPublicData } from "@/lib/verifier/fetch-verifier-public-data";
import type { KarProVerifierProfile } from "@/lib/verifier/verifier-profile-types";

export type {
  DisputedPassportRow,
  KarProVerifierProfile,
} from "@/lib/verifier/verifier-profile-types";

export async function fetchKarProVerifierProfile(
  address: string,
  options?: { fresh?: boolean },
): Promise<KarProVerifierProfile | null> {
  const data = await fetchVerifierPublicData(address, options);
  return data.profile;
}
