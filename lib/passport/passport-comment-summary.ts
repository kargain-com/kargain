import { getAddress } from "viem";

import type { ListingCommentNode } from "@/lib/nostr/listing-comment-feed";

export type PassportTopComment = {
  id: string;
  text: string;
  authorAddress: `0x${string}` | null;
  replyCount: number;
};

function parseCommentAuthorAddress(
  node: ListingCommentNode,
): `0x${string}` | null {
  const taggedAddress = node.event.tags.find((tag) => tag[0] === "evm")?.[1];
  if (!taggedAddress) return null;

  try {
    return getAddress(taggedAddress);
  } catch {
    return null;
  }
}

export function selectPassportTopComment(
  roots: ListingCommentNode[],
  byParent: Record<string, ListingCommentNode[]>,
): PassportTopComment | null {
  if (roots.length === 0) return null;

  let best = roots[0];
  let bestReplyCount = byParent[best.event.id]?.length ?? 0;

  for (const root of roots.slice(1)) {
    const replyCount = byParent[root.event.id]?.length ?? 0;
    const hasBetterReplyCount = replyCount > bestReplyCount;
    const sameReplyCountNewer =
      replyCount === bestReplyCount &&
      root.event.created_at > best.event.created_at;

    if (hasBetterReplyCount || sameReplyCountNewer) {
      best = root;
      bestReplyCount = replyCount;
    }
  }

  return {
    id: best.event.id,
    text: best.event.content,
    authorAddress: parseCommentAuthorAddress(best),
    replyCount: bestReplyCount,
  };
}
