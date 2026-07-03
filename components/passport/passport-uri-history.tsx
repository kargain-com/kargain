"use client";

import Link from "next/link";

import { monoLink, monoLinkSm } from "@/lib/design/instrument-classes";
import { arUriToHttp } from "@/lib/storage/ar-gateway";
import type { PonderUriHistoryEntry } from "@/lib/types/ponder";
import { shortAddress } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";

import { PassportLogSection } from "./passport-log-section";

type Props = {
  entries: PonderUriHistoryEntry[];
  chainId: number;
};

function formatDate(timestampSec: string): string {
  const sec = Number.parseInt(timestampSec, 10);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(sec * 1000));
}

export function PassportUriHistory({ entries, chainId }: Props) {
  return (
    <PassportLogSection
      title="Metadata history"
      headerMeta={
        <span className="ml-2 font-mono text-xs font-normal text-text-tertiary">
          {entries.length} {entries.length === 1 ? "update" : "updates"}
        </span>
      }
      items={entries}
      getItemKey={(entry) => entry.id}
      expandBehavior="collapsible"
      emptyBehavior="hide"
      getItemBorder={() => "default"}
      getItemTickLabel={(entry) => formatDate(entry.timestamp) || "Unknown date"}
      renderItem={(entry) => {
        const gatewayUrl = arUriToHttp(entry.newUri, chainId);
        const displayUri =
          entry.newUri.length > 48
            ? `${entry.newUri.slice(0, 28)}···${entry.newUri.slice(-16)}`
            : entry.newUri;

        return (
          <>
            {entry.verificationReset ? (
              <p className="text-xs font-medium text-text-primary">Verification reset</p>
            ) : null}
            <p className="mt-2 font-sans text-xs text-text-secondary">
              <span className="text-text-tertiary">Author </span>
              <Link
                href={`/profile/${entry.author}`}
                className={cn(monoLink, "hover:underline")}
              >
                {shortAddress(entry.author as `0x${string}`)}
              </Link>
            </p>
            {entry.newUri.startsWith("ar://") && gatewayUrl ? (
              <a
                href={gatewayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(monoLinkSm, "mt-2 block break-all hover:underline")}
                title={entry.newUri}
              >
                {displayUri}
              </a>
            ) : (
              <p
                className="mt-2 break-all font-mono text-xs text-text-primary"
                title={entry.newUri}
              >
                {displayUri}
              </p>
            )}
          </>
        );
      }}
    />
  );
}
