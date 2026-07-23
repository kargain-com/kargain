"use server";

import { fetchVerifierPublicData } from "@/lib/verifier/fetch-verifier-public-data";
import type { KarProVerifierProfile } from "@/lib/verifier/verifier-profile-types";

/**
 * Types: import from `@/lib/verifier/verifier-profile-types` — do not
 * re-export types from this `"use server"` file (Next registers them as
 * runtime server references and crashes the action bundle).
 */
export async function fetchKarProVerifierProfile(
  address: string,
): Promise<KarProVerifierProfile | null> {
  const data = await fetchVerifierPublicData(address);
  return data.profile;
}
