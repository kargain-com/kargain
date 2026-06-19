"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { arUriToHttp } from "@/lib/storage/ar-gateway";
import type { PonderUriHistoryEntry } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/web3/wallet-display";

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
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  return (
    <section className="rounded-md border border-border-default bg-bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
        aria-expanded={expanded}
      >
        <span className="font-sans text-sm font-medium text-text-primary">
          Metadata history
          <span className="ml-2 font-mono text-xs font-normal text-text-tertiary">
            {entries.length} {entries.length === 1 ? "update" : "updates"}
          </span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={1.5}
          aria-hidden
          className={cn(
            "text-text-secondary transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-border-default px-6 pb-6 pt-4">
          <ul className="space-y-3">
            {entries.map((entry) => {
              const gatewayUrl = arUriToHttp(entry.newUri, chainId);
              const displayUri =
                entry.newUri.length > 48
                  ? `${entry.newUri.slice(0, 28)}···${entry.newUri.slice(-16)}`
                  : entry.newUri;

              return (
                <li
                  key={entry.id}
                  className={`rounded-md border p-4 ${
                    entry.verificationReset
                      ? "border-status-error/40 bg-bg-primary/80"
                      : "border-border-default bg-bg-primary/80"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-tertiary">
                      {formatDate(entry.timestamp) || "Unknown date"}
                    </p>
                    {entry.verificationReset && (
                      <span className="text-xs font-medium text-status-error">
                        Verification reset
                      </span>
                    )}
                  </div>
                  <p className="mt-2 font-sans text-xs text-text-secondary">
                    <span className="text-text-tertiary">Author </span>
                    <Link
                      href={`/profile/${entry.author}`}
                      className="font-mono text-accent-warm hover:underline"
                    >
                      {shortAddress(entry.author as `0x${string}`)}
                    </Link>
                  </p>
                  {entry.newUri.startsWith("ar://") && gatewayUrl ? (
                    <a
                      href={gatewayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 block break-all font-mono text-xs text-accent-warm hover:underline"
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
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
