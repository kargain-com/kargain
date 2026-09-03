"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { PassportStatus } from "@/components/ui/passport-status-badge";
import { usePassportOnChainOwner } from "@/hooks/use-passport-on-chain-owner";
import {
  isOnChainNftOwner,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import {
  PASSPORT_TAB_CHANGE_EVENT,
  parsePassportTab,
  readPassportTabFromLocation,
  replacePassportTabUrl,
  type PassportTab,
} from "@/lib/passport/passport-tab-url";
import { cn } from "@/lib/utils";

type Props = {
  status: PassportStatus;
  passportOwner: `0x${string}`;
  chainId: number;
  tokenId: string;
  overview: ReactNode;
  records: ReactNode;
  actions: ReactNode;
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const { onChainOwner } = usePassportOnChainOwner(chainId, tokenId);
  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, passportOwner);
  const isOwner = isOnChainNftOwner(address, effectiveOwner);
  const isDisputed = status === "DISPUTED";
  const showActionsDot = isDisputed && isOwner;

  const [tab, setTab] = useState<PassportTab>(() =>
    parsePassportTab(searchParams.get("tab")),
  );
  const [visitedRecords, setVisitedRecords] = useState(() => tab === "records");
  const [visitedActions, setVisitedActions] = useState(() => tab === "actions");
  const [legacyPanelMigrated, setLegacyPanelMigrated] = useState(false);

  const panel = searchParams.get("panel");
  if ((panel === "records" || panel === "actions") && !legacyPanelMigrated) {
    setLegacyPanelMigrated(true);
    replacePassportTabUrl(pathname, window.location.search, panel);
    setTab(panel);
    if (panel === "records") setVisitedRecords(true);
    if (panel === "actions") setVisitedActions(true);
  }

  const syncTabFromLocation = useCallback(() => {
    const next = readPassportTabFromLocation();
    setTab(next);
    if (next === "records") setVisitedRecords(true);
    if (next === "actions") setVisitedActions(true);
  }, []);

  useEffect(() => {
    window.addEventListener(PASSPORT_TAB_CHANGE_EVENT, syncTabFromLocation);
    window.addEventListener("popstate", syncTabFromLocation);
    return () => {
      window.removeEventListener(PASSPORT_TAB_CHANGE_EVENT, syncTabFromLocation);
      window.removeEventListener("popstate", syncTabFromLocation);
    };
  }, [syncTabFromLocation]);

  const selectTab = useCallback(
    (nextTab: PassportTab) => {
      if (nextTab === "records") setVisitedRecords(true);
      if (nextTab === "actions") setVisitedActions(true);
      setTab(nextTab);
      replacePassportTabUrl(pathname, window.location.search, nextTab);
    },
    [pathname],
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
                onClick={() => selectTab(id)}
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
        <div
          className={tab === "overview" ? "block" : "hidden"}
          inert={tab === "overview" ? undefined : true}
        >
          {overview}
        </div>
        {(tab === "records" || visitedRecords) && (
          <div
            className={tab === "records" ? "block" : "hidden"}
            inert={tab === "records" ? undefined : true}
          >
            {records}
          </div>
        )}
        {(tab === "actions" || visitedActions) && (
          <div
            className={tab === "actions" ? "block" : "hidden"}
            inert={tab === "actions" ? undefined : true}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
