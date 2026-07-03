"use client";

import NostrCommentsSection from "@/components/marketplace/nostr-comments-section";
import { useMediaMd } from "@/hooks/use-media-md";
import { sectionScrollAnchor } from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

/** Desktop-only always-visible discussion; mobile uses the comments sheet. */
export function PassportDiscussionRail({ tokenId }: { tokenId: string }) {
  const { isMd } = useMediaMd();
  if (!isMd) return null;

  return (
    <section
      id="passport-comments"
      className={cn(
        "rounded-md border border-border-default bg-bg-surface p-4",
        sectionScrollAnchor,
      )}
      aria-label="Discussion"
    >
      <NostrCommentsSection tokenId={tokenId} />
    </section>
  );
}
