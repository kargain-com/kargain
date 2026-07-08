import type { Event, Filter } from "nostr-tools";
import type { Address } from "viem";

import { parseProfileContent, type NostrProfileData } from "@/lib/nostr/parse-profile-content";

const MAX_PROFILE_BATCH_LIMIT = 500;

export type ProfileBatchEntry = {
  createdAt: number;
  profile: NostrProfileData;
};

export type ProfileBatchState = {
  byAddress: Map<string, ProfileBatchEntry>;
};

export function createEmptyProfileBatchState(): ProfileBatchState {
  return { byAddress: new Map() };
}

export function normalizeProfileAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function buildEthereumProfileFilter(addresses: Address[]): Filter {
  const tags = [...new Set(addresses.map((a) => `ethereum:${a.toLowerCase()}`))];
  return {
    kinds: [0],
    "#i": tags,
    limit: Math.min(Math.max(tags.length, 1) * 2, MAX_PROFILE_BATCH_LIMIT),
  };
}

export function ethereumAddressFromEvent(event: Pick<Event, "tags">): string | null {
  for (const tag of event.tags) {
    if (tag[0] === "i" && typeof tag[1] === "string" && tag[1].startsWith("ethereum:")) {
      const addr = tag[1].slice("ethereum:".length).trim();
      if (addr.length > 0) return normalizeProfileAddress(addr);
    }
  }
  return null;
}

export function applyProfileEvent(
  state: ProfileBatchState,
  event: Pick<Event, "content" | "created_at" | "tags">,
): ProfileBatchState {
  const address = ethereumAddressFromEvent(event);
  if (!address) return state;

  const existing = state.byAddress.get(address);
  if (existing != null && existing.createdAt >= event.created_at) {
    return state;
  }

  const parsed = parseProfileContent(event.content);
  const profile = parsed ?? {};

  const next = new Map(state.byAddress);
  next.set(address, { createdAt: event.created_at, profile });
  return { byAddress: next };
}

export function profileMapFromState(
  state: ProfileBatchState,
): Map<string, NostrProfileData | null> {
  const result = new Map<string, NostrProfileData | null>();
  for (const [address, entry] of state.byAddress) {
    result.set(address, entry.profile);
  }
  return result;
}
