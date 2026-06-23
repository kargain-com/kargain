"use client";

import Link from "next/link";

import {
  getRecordDisplay,
  type RecordSeverity,
} from "@/lib/passport/record-types";
import type { PonderPassportRecord } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";
import { navShortAddress } from "@/lib/web3/wallet-display";

type Props = {
  records: PonderPassportRecord[];
  passportOwner: string;
  lastDisputer: string;
  disputeReason: string;
  locale?: string;
};

function formatChainDate(timestampSec: string, locale: string): string {
  const sec = Number.parseInt(timestampSec, 10);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(sec * 1000));
}

function severityBorderClass(severity: RecordSeverity): string {
  switch (severity) {
    case "warn":
      return "border-status-error/40";
    case "info":
      return "border-accent-warm/40";
    case "success":
      return "border-emerald-500/30";
    default:
      return "border-border-default";
  }
}

export function PassportRecordsTimeline({
  records,
  passportOwner,
  lastDisputer,
  disputeReason,
  locale = "en",
}: Props) {
  return (
    <section
      id="passport-records"
      className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6"
    >
      <h2 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] text-text-primary">
        History & records
      </h2>
      {records.length === 0 ? (
        <p className="font-sans text-sm text-text-secondary">
          Service logs, attestations, and discrepancy records will appear here over time.
        </p>
      ) : (
        <ul className="space-y-3">
          {records.map((record) => {
            const display = getRecordDisplay(record, {
              passportOwner,
              lastDisputer,
              disputeReason,
            });

            return (
              <li
                key={record.id}
                className={cn(
                  "rounded-md border bg-bg-primary/80 p-4",
                  severityBorderClass(display.severity),
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-text-tertiary">
                      {display.label}
                    </p>
                    {display.badges.map((badge) => (
                      <span
                        key={badge}
                        className="rounded-sm border border-border-default px-1.5 py-0.5 font-sans text-[10px] uppercase tracking-wide text-text-secondary"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                  <p className="font-mono text-xs font-normal tabular-nums text-text-secondary">
                    {formatChainDate(record.timestamp, locale) || "Time"}
                  </p>
                </div>
                <p className="mt-2 font-sans text-sm text-text-secondary">
                  Author:{" "}
                  <Link
                    href={`/profile/${record.author}`}
                    className="font-mono text-accent-warm hover:underline"
                  >
                    {navShortAddress(record.author)}
                  </Link>
                </p>
                {display.description && (
                  <p className="mt-2 font-sans text-sm text-text-primary">
                    {display.description}
                  </p>
                )}
                {display.evidenceHref && (
                  <p className="mt-2">
                    <a
                      href={display.evidenceHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-sans text-sm text-accent-warm link-underline"
                    >
                      View evidence
                    </a>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
