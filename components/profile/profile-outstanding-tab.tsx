"use client";

import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { useOutstandingObligations } from "@/hooks/use-outstanding-obligations";
import {
  endsAtDateTimeAttr,
  formatAuctionCountdownSeconds,
} from "@/lib/auction/format-auction";
import { shortChainName } from "@/lib/web3/supported-chains";
import type { OutstandingObligation } from "@/lib/obligation";
import { cn } from "@/lib/utils";

function formatDeadlineDate(sec: number): { label: string; dateTime: string } {
  const d = new Date(sec * 1000);
  return {
    label: new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d),
    dateTime: d.toISOString(),
  };
}

function roleLabel(role: OutstandingObligation["role"]): string {
  switch (role) {
    case "buyer":
      return "Buyer";
    case "bidder":
      return "Bidder";
    case "seller":
      return "Seller";
    case "agent":
      return "Agent";
    case "owner":
      return "Owner";
    case "challenger":
      return "Challenger";
    case "eligible_judge":
      return "Eligible to judge";
    case "recorded_verifier":
      return "Recorded verifier";
    default:
      return role;
  }
}

function ObligationRow({
  item,
  nowSec,
}: {
  item: OutstandingObligation;
  nowSec: number;
}) {
  const deadline =
    item.deadlineSec != null && item.deadlineSec > 0
      ? formatDeadlineDate(item.deadlineSec)
      : null;
  const countdown =
    item.deadlineSec != null && item.deadlineSec > 0
      ? formatAuctionCountdownSeconds(BigInt(item.deadlineSec), nowSec)
      : null;
  const countdownAttr =
    item.deadlineSec != null
      ? endsAtDateTimeAttr(BigInt(item.deadlineSec))
      : undefined;

  return (
    <li className="border-b border-border-default px-4 py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Link
          href={item.href}
          className="font-sans text-sm text-text-primary hover:text-accent-warm focus-visible:text-accent-warm"
        >
          {item.title}
        </Link>
        <span className="font-mono text-xs text-text-tertiary">
          {roleLabel(item.role)}
          {" · "}
          {shortChainName(item.chainId)}
        </span>
      </div>
      {deadline && countdown != null && (
        <p className="mt-1 font-sans text-xs text-text-secondary">
          {item.remainingSec != null && item.remainingSec <= 0 ? (
            <>
              Deadline was{" "}
              <time dateTime={deadline.dateTime} className="font-mono tabular-nums">
                {deadline.label}
              </time>
              .
            </>
          ) : (
            <>
              Due{" "}
              <time dateTime={deadline.dateTime} className="font-mono tabular-nums">
                {deadline.label}
              </time>{" "}
              (
              <time
                dateTime={countdownAttr}
                className="font-mono tabular-nums"
              >
                {countdown}
              </time>{" "}
              left).
            </>
          )}{" "}
          {item.consequence}
        </p>
      )}
      {(!deadline || countdown == null) && (
        <p className="mt-1 font-sans text-xs text-text-secondary">
          {item.consequence}
        </p>
      )}
    </li>
  );
}

export function ProfileOutstandingTab({
  address,
  isActiveVerifier,
}: {
  address: string;
  isActiveVerifier: boolean | undefined;
}) {
  const { derived, nowSec, isPending, isError } = useOutstandingObligations({
    address,
    isActiveVerifier,
  });

  if (isPending && derived.status === "unresolved") {
    return (
      <p className="font-sans text-sm text-text-secondary" role="status">
        Loading outstanding items…
      </p>
    );
  }

  if (derived.status === "unresolved" || isError) {
    return (
      <EmptyState
        variant="infrastructure"
        level="B"
        role="alert"
        title="Outstanding items unavailable"
        description="The indexer did not return a complete answer. Absence of data is not the same as nothing outstanding."
      />
    );
  }

  if (derived.items.length === 0) {
    return (
      <EmptyState
        variant="content"
        level="B"
        title="Nothing outstanding"
        description="No protection holds, challenges, standing bids, or cooldowns run against this wallet right now."
      />
    );
  }

  return (
    <div>
      {derived.judgeEligibilityUnresolved && (
        <p
          className={cn(
            "mb-3 font-sans text-xs text-text-tertiary",
          )}
          role="status"
        >
          Judge eligibility is still resolving — the list may be incomplete.
        </p>
      )}
      <ul className="rounded-md border border-border-default bg-bg-primary/80">
        {derived.items.map((item) => (
          <ObligationRow key={item.id} item={item} nowSec={nowSec} />
        ))}
      </ul>
    </div>
  );
}
