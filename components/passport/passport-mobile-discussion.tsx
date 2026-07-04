"use client";

import NostrCommentsSection from "@/components/marketplace/nostr-comments-section";
import { useMediaMd } from "@/hooks/use-media-md";

/** Mobile-only compact discussion at the bottom of Overview. */
export function PassportMobileDiscussion({ tokenId }: { tokenId: string }) {
  const { isMd } = useMediaMd();
  if (isMd) return null;

  return (
    <div id="passport-comments" className="mt-8">
      <NostrCommentsSection tokenId={tokenId} density="compact" />
    </div>
  );
}
