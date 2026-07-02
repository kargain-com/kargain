"use client";

import Link from "next/link";

import {
  getRecordDisplay,
  type RecordSeverity,
} from "@/lib/passport/record-types";
import type { PonderPassportRecord } from "@/lib/types/ponder";
import { navShortAddress } from "@/lib/web3/wallet-display";

import {
  PassportLogSection,
  type PassportLogItemBorder,
} from "./passport-log-section";

type Props = {
  records: PonderPassportRecord[];
  passportOwner: string;
  lastDisputer: string;
  disputeReason: string;
};

function formatChainDate(timestampSec: string): string {
  const sec = Number.parseInt(timestampSec, 10);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(sec * 1000));
}

function severityToBorder(severity: RecordSeverity): PassportLogItemBorder {
  if (severity === "warn") return "error";
  return "default";
}

export function PassportRecordsTimeline({
  records,
  passportOwner,
  lastDisputer,
  disputeReason,
}: Props) {
  const ctx = { passportOwner, lastDisputer, disputeReason };

  return (
    <PassportLogSection
      sectionId="passport-records"
      title="History & records"
      items={records}
      getItemKey={(record) => record.id}
      expandBehavior="always"
      emptyBehavior="copy"
      emptyMessage="Service logs, attestations, and discrepancy records will appear here over time."
      getItemBorder={(record) =>
        severityToBorder(getRecordDisplay(record, ctx).severity)
      }
      renderItem={(record) => {
        const display = getRecordDisplay(record, ctx);

        return (
          <>
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
                {formatChainDate(record.timestamp) || "Time"}
              </p>
            </div>
            <p className="mt-2 font-sans text-sm text-text-secondary">
              Author:{" "}
              <Link
                href={`/profile/${record.author}`}
                className="font-mono text-text-secondary hover:text-accent-warm focus-visible:text-accent-warm hover:underline"
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
          </>
        );
      }}
    />
  );
}
