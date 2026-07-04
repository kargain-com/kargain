"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { PassportStatus } from "@/components/ui/passport-status-badge";
import { usePassportOnChainOwner } from "@/hooks/use-passport-on-chain-owner";
import {
  isOnChainNftOwner,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import {
  buildPassportTabQuery,
  parsePassportTab,
  type PassportTab,
} from "@/lib/passport/passport-tab-url";
import { cn } from "@/lib/utils";
import { useAccount } from "wagmi";

type Props = {
  status: PassportStatus;
  passportOwner: `0x${string}`;
  chainId: number;
  tokenId: string;
  overview: React.ReactNode;
  records: React.ReactNode;
  actions: React.ReactNode;
};

const TABS: { id: PassportTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "records", label: "History & records" },
  { id: "actions", label: "Actions" },
];

export function PassportDetailTabs({
  status,
  passportOwner,
  chainId,
  tokenId,
  overview,
  records,
  actions,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parsePassportTab(searchParams.get("tab"));
  const { address } = useAccount();
  const { onChainOwner } = usePassportOnChainOwner(chainId, tokenId);
  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, passportOwner);
  const isOwner = isOnChainNftOwner(address, effectiveOwner);
  const isDisputed = status === "DISPUTED";
  const showActionsDot = isDisputed && isOwner;

  const [visitedRecords, setVisitedRecords] = useState(tab === "records");
  const [visitedActions, setVisitedActions] = useState(tab === "actions");

  useEffect(() => {
    if (tab === "records") setVisitedRecords(true);
    if (tab === "actions") setVisitedActions(true);
  }, [tab]);

  // Legacy ?panel=records|actions → tab
  useEffect(() => {
    const panel = searchParams.get("panel");
    if (panel !== "records" && panel !== "actions") return;
    const next = buildPassportTabQuery(panel, new URLSearchParams(searchParams.toString()));
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const setTab = useCallback(
    (nextTab: PassportTab) => {
      const next = buildPassportTabQuery(nextTab, new URLSearchParams(searchParams.toString()));
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <div>
      <nav
        aria-label="Passport sections"
        className="sticky top-14 z-30 -mx-6 mt-6 border-b border-border-default bg-bg-primary px-6 md:-mx-8 md:px-8"
      >
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            const showDot =
              (id === "records" && isDisputed) || (id === "actions" && showActionsDot);
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "relative inline-flex min-h-11 shrink-0 items-center gap-1.5 px-4 py-3 font-sans text-sm transition-colors",
                  active
                    ? "font-medium text-text-primary"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                {label}
                {showDot && (
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      id === "actions" ? "bg-status-error" : "bg-accent-warm",
                    )}
                    aria-hidden
                  />
                )}
                {active && (
                  <span className="absolute inset-x-4 bottom-0 h-0.5 bg-accent-warm" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mt-6">
        <div className={tab === "overview" ? "block" : "hidden"}>{overview}</div>
        {(tab === "records" || visitedRecords) && (
          <div className={tab === "records" ? "block" : "hidden"}>{records}</div>
        )}
        {(tab === "actions" || visitedActions) && (
          <div className={tab === "actions" ? "block" : "hidden"}>{actions}</div>
        )}
      </div>
    </div>
  );
}
