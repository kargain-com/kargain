import type { Filter } from "nostr-tools";

const LISTING_TAG_PREFIX = "listing:";
const OWNED_LISTING_D_CHUNK_SIZE = 8;

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Nostr relay filters for comment reply/like (#p) and owned-passport comments (#d). */
export function buildNostrNotificationFilters(
  pubkey: string,
  ownedTokenIds: string[],
  since: number,
): Filter[] {
  const filters: Filter[] = [
    { kinds: [1], "#p": [pubkey], since },
    { kinds: [7], "#p": [pubkey], since },
  ];

  for (const chunk of chunkArray(ownedTokenIds, OWNED_LISTING_D_CHUNK_SIZE)) {
    filters.push({
      kinds: [1],
      "#d": chunk.map((id) => `${LISTING_TAG_PREFIX}${id}`),
      since,
    });
  }

  return filters;
}

export { OWNED_LISTING_D_CHUNK_SIZE };
