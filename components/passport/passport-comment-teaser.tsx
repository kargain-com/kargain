"use client";

import Link from "next/link";

import {
  usePassportCommentSummaryOptional,
  usePassportPanelUrl,
} from "@/components/passport/passport-detail-panel-chrome";
import { useMediaMd } from "@/hooks/use-media-md";
import { sansLink } from "@/lib/design/instrument-classes";
import { shortAddress } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";

export function PassportCommentTeaser() {
  const { isMd } = useMediaMd();
  const { openPanel } = usePassportPanelUrl();
  const summary = usePassportCommentSummaryOptional();

  if (!summary?.topComment || !summary.commentCount) return null;

  const author = summary.topComment.authorAddress
    ? shortAddress(summary.topComment.authorAddress)
    : "Kargain user";
  const discussionLabel = `${author} · View discussion (${summary.commentCount}) →`;

  const content = (
    <div className="rounded-md border border-border-default bg-bg-surface p-4 transition-colors hover:border-border-hover sm:p-6">
      <div className="flex gap-3">
        <span className="shrink-0 text-base leading-none text-text-tertiary" aria-hidden>
          "
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-sans text-sm leading-[1.6] text-text-primary">
            {summary.topComment.text}
          </p>
          <p className={cn("mt-3", sansLink)}>{discussionLabel}</p>
        </div>
      </div>
    </div>
  );

  if (isMd) {
    return (
      <Link href="#passport-comments" className="block">
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className="block w-full text-left" onClick={() => openPanel("comments")}>
      {content}
    </button>
  );
}
