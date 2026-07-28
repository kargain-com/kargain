"use client";

import Link from "next/link";

import {
  getRecordDisplay,
  type RecordSeverity,
} from "@/lib/passport/record-types";
import {
  disputeTerminalTimelineDescription,
  disputeTerminalTimelineLabel,
} from "@/lib/passport/dispute-trust-copy";
import { parseDisputeTerminal } from "@/lib/passport/dispute-surface";
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
  lastDisputeTerminal?: string;
  lastDisputeResolvedAt?: string;
  disputeWithdrawnAt?: string;
  /** Omit when mounted inside a sheet that already owns the section id. */
  sectionId?: string;
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

type TimelineRow =
  | { kind: "record"; record: PonderPassportRecord }
  | {
      kind: "terminal";
      id: string;
      timestamp: string;
      label: string;
      description: string;
    };

export function PassportRecordsTimeline({
  records,
  passportOwner,
  lastDisputer,
  disputeReason,
  lastDisputeTerminal = "",
  lastDisputeResolvedAt = "0",
  disputeWithdrawnAt = "0",
  sectionId,
}: Props) {
  const ctx = { passportOwner, lastDisputer, disputeReason };
  const terminal = parseDisputeTerminal(lastDisputeTerminal);
  const terminalTs =
    terminal === "withdraw"
      ? disputeWithdrawnAt
      : lastDisputeResolvedAt;
  const terminalLabel = disputeTerminalTimelineLabel(terminal);
  const terminalDescription = disputeTerminalTimelineDescription(terminal);

  const rows: TimelineRow[] = [];
  if (
    terminal &&
    terminalLabel &&
    terminalDescription &&
    terminalTs !== "0" &&
    Number.parseInt(terminalTs, 10) > 0
  ) {
    rows.push({
      kind: "terminal",
      id: `dispute-terminal-${terminal}`,
      timestamp: terminalTs,
      label: terminalLabel,
      description: terminalDescription,
    });
  }
  for (const record of records) {
    rows.push({ kind: "record", record });
  }
  // Newest first for terminal + records (records are typically newest-first from API).
  rows.sort((a, b) => {
    const ta =
      a.kind === "record"
        ? Number.parseInt(a.record.timestamp, 10)
        : Number.parseInt(a.timestamp, 10);
    const tb =
      b.kind === "record"
        ? Number.parseInt(b.record.timestamp, 10)
        : Number.parseInt(b.timestamp, 10);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });

  return (
    <PassportLogSection
      sectionId={sectionId}
      title="History & records"
      items={rows}
      getItemKey={(row) => (row.kind === "record" ? row.record.id : row.id)}
      expandBehavior="always"
      emptyBehavior="copy"
      emptyMessage="Service logs, attestations, and discrepancy records will appear here over time."
      getItemBorder={(row) =>
        row.kind === "record"
          ? severityToBorder(getRecordDisplay(row.record, ctx).severity)
          : "default"
      }
      getItemTickLabel={(row) =>
        formatChainDate(
          row.kind === "record" ? row.record.timestamp : row.timestamp,
        ) || "Time"
      }
      renderItem={(row) => {
        if (row.kind === "terminal") {
          return (
            <>
              <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-text-tertiary">
                {row.label}
              </p>
              <p className="mt-2 font-sans text-sm text-text-secondary">
                {row.description}
              </p>
            </>
          );
        }

        const display = getRecordDisplay(row.record, ctx);

        return (
          <>
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
            <p className="mt-2 font-sans text-sm text-text-secondary">
              Author:{" "}
              <Link
                href={`/profile/${row.record.author}`}
                className="hover:underline"
              >
                {navShortAddress(row.record.author)}
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
                  className="font-sans text-sm link-underline"
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
