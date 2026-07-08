import {
  type NostrProfileData,
} from "@/lib/nostr/parse-profile-content";
import { resolveAttestedProfileServer } from "@/lib/nostr/resolve-attested-profile";

/** Fetch kind:0 profile for a wallet address from relays (server). Never throws. */
export async function fetchNostrProfileServerFull(
  address: `0x${string}`,
): Promise<NostrProfileData | null> {
  try {
    return await resolveAttestedProfileServer(address);
  } catch {
    return null;
  }
}

/** Fetch kind:0 profile picture for a wallet address from relays. Never throws. */
export async function fetchNostrProfileServer(
  address: `0x${string}`,
): Promise<{ picture: string | null }> {
  try {
    const profile = await resolveAttestedProfileServer(address);
    const picture = profile?.picture?.trim();
    return { picture: picture || null };
  } catch {
    return { picture: null };
  }
}
