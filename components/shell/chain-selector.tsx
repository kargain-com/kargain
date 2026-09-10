"use client";

import { ChevronDownIcon } from "@/components/ui/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  commercialNamespaceOf,
  evmSwitchChainAvailability,
  useActiveAccount,
} from "@/hooks/use-active-account";
import {
  chainSelectorMaySwitchChain,
  chainSelectorStateCopy,
  chainSelectorSwitchTargets,
  commercialNetworkLabel,
  commercialPickerEntries,
  deriveChainSelectorState,
} from "@/lib/web3/chain-selector-state";
import { cn } from "@/lib/utils";

type Props = {
  syncSearchParam?: boolean;
  /** Set only when URL/page requires a specific namespace — never hub DEFAULT fallback. */
  expectedNamespace?: number;
  className?: string;
};

function ChainStatusDot({ wrong }: { wrong?: boolean }) {
  if (wrong) {
    return <span className="size-1.5 shrink-0 rounded-full bg-red-400" aria-hidden />;
  }
  return <span className="size-1.5 shrink-0 rounded-full bg-[#0052ff] opacity-80" aria-hidden />;
}

/**
 * Chain selector driven by {@link deriveChainSelectorState}.
 * Disconnected → hidden. Picker lists every commercial network; EVM switch
 * only when {@link chainSelectorMaySwitchChain} allows.
 */
export function ChainSelector({
  syncSearchParam,
  expectedNamespace,
  className,
}: Props) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const { account, switchChain, isConnectPending: isPending } = useActiveAccount();
  const switchAvail = evmSwitchChainAvailability(account);
  const sessionNs = commercialNamespaceOf(account);
  const sessionNamespace = sessionNs.ok ? Number(sessionNs.namespace) : undefined;

  const selectorState = deriveChainSelectorState({
    account,
    expectedNamespace,
  });

  const urlChain = useMemo(() => {
    const raw = sp.get("chain");
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [sp]);

  const displayNamespace =
    syncSearchParam
      ? (urlChain ?? sessionNamespace ?? 0)
      : (sessionNamespace ?? 0);
  const wrong = selectorState !== "ok";
  const stateCopy = chainSelectorStateCopy(selectorState, expectedNamespace);
  const chainName =
    stateCopy ??
    (displayNamespace !== 0
      ? commercialNetworkLabel(displayNamespace)
      : "Unknown network");
  const switchTargets = chainSelectorSwitchTargets(
    expectedNamespace,
    selectorState,
  );
  const pickerEntries = commercialPickerEntries();

  const onSwitchTo = useCallback(
    (id: number) => {
      if (!chainSelectorMaySwitchChain(account, id)) return;
      if (!switchAvail.available) return;
      void switchChain(id).catch(() => {
        /* user rejected */
      });
    },
    [account, switchAvail, switchChain],
  );

  const onSelectNamespace = useCallback(
    async (id: number) => {
      if (syncSearchParam) {
        const next = new URLSearchParams(sp.toString());
        next.set("chain", String(id));
        router.push(`${path}?${next.toString()}`);
      }
      if (
        chainSelectorMaySwitchChain(account, id) &&
        switchAvail.available &&
        sessionNamespace != null &&
        id !== sessionNamespace
      ) {
        try {
          await switchChain(id);
        } catch {
          /* user rejected */
        }
      }
    },
    [
      account,
      path,
      router,
      sessionNamespace,
      sp,
      switchAvail,
      switchChain,
      syncSearchParam,
    ],
  );

  // No session → no chrome. Connected (incl. wrong_vm) always surfaces state.
  if (account.status !== "connected") return null;

  const triggerClass = cn(
    "inline-flex h-9 shrink-0 items-center gap-2 rounded-sm border bg-bg-surface px-3 font-mono text-xs transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
    wrong
      ? "border-red-400/40 text-red-400"
      : "border-border-default text-text-secondary hover:border-border-hover",
    className,
  );

  const trigger = (
    <>
      <ChainStatusDot wrong={wrong} />
      <span className="max-w-[14rem] truncate">{chainName}</span>
      {wrong ? (
        switchTargets.length > 0 ? (
          <ChevronDownIcon size={14} className="shrink-0 text-text-secondary" aria-hidden />
        ) : null
      ) : (
        <ChevronDownIcon size={14} className="shrink-0 text-text-secondary" aria-hidden />
      )}
    </>
  );

  if (wrong) {
    const ariaTarget =
      expectedNamespace != null
        ? commercialNetworkLabel(expectedNamespace)
        : "a Kargain network";
    const ariaLabel =
      selectorState === "wrong_vm"
        ? (stateCopy ?? chainName)
        : `Wrong network — switch to ${ariaTarget}`;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={isPending || switchTargets.length === 0}
            className={triggerClass}
            aria-label={ariaLabel}
            data-selector-state={selectorState}
          >
            {trigger}
          </button>
        </DropdownMenuTrigger>
        {switchTargets.length > 0 ? (
          <DropdownMenuContent align="end" className="min-w-[180px] p-1">
            {switchTargets.map((id) => (
              <DropdownMenuItem
                key={id}
                className="font-mono text-xs"
                onSelect={() => onSwitchTo(id)}
              >
                Switch to {commercialNetworkLabel(id)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        ) : null}
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          className={triggerClass}
          aria-label={`Network: ${chainName}`}
          data-selector-state={selectorState}
        >
          {trigger}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px] p-1">
        {pickerEntries.map((entry) => {
          const isActive = entry.namespace === displayNamespace;
          if (isActive) {
            return (
              <div
                key={entry.namespace}
                className="flex cursor-default items-center gap-2.5 rounded-sm px-3 py-2"
              >
                <ChainStatusDot />
                <span className="font-mono text-xs text-text-primary">
                  {entry.label}
                </span>
                <span className="ml-auto font-mono text-[10px] text-accent-warm">
                  Active
                </span>
              </div>
            );
          }
          return (
            <DropdownMenuItem
              key={entry.namespace}
              className="font-mono text-xs"
              onSelect={() => void onSelectNamespace(entry.namespace)}
            >
              <ChainStatusDot />
              <span className="text-text-secondary">{entry.label}</span>
            </DropdownMenuItem>
          );
        })}
        {pickerEntries.length === 0 ? (
          <>
            <DropdownMenuSeparator />
            <div className="cursor-default px-3 py-2 font-mono text-xs italic text-text-secondary">
              No commercial networks
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
