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
  evmSwitchChainAvailability,
  requireEvmSession,
  useActiveAccount,
} from "@/hooks/use-active-account";
import {
  chainSelectorSwitchTargets,
  deriveChainSelectorState,
} from "@/lib/web3/chain-selector-state";
import {
  getViemChain,
  kargainChains,
  shortChainName,
} from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type Props = {
  syncSearchParam?: boolean;
  /** Set only when URL/page requires a specific chain — never hub DEFAULT fallback. */
  expectedChainId?: number;
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
 * Disconnected → hidden. SVM → visible `wrong_vm` (empty switch targets; chrome copy is screens slice).
 */
export function ChainSelector({ syncSearchParam, expectedChainId, className }: Props) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const { account, switchChain, isConnectPending: isPending } = useActiveAccount();
  const evm = requireEvmSession(account);
  const switchAvail = evmSwitchChainAvailability(account);
  const walletChainId = evm.ok ? evm.chainId : undefined;

  const selectorState = deriveChainSelectorState({
    account,
    expectedChainId,
  });

  const urlChain = useMemo(() => {
    const raw = sp.get("chain");
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [sp]);

  const displayChainId =
    syncSearchParam ? (urlChain ?? walletChainId ?? 0) : (walletChainId ?? 0);
  const wrong = selectorState !== "ok";
  const activeChain = getViemChain(displayChainId);
  const chainName =
    selectorState === "wrong_vm"
      ? "Wrong network"
      : selectorState === "wrong_network"
        ? "Wrong network"
        : (activeChain?.name ?? `Chain ${displayChainId}`);
  const switchTargets = chainSelectorSwitchTargets(expectedChainId, selectorState);

  const onSwitchTo = useCallback(
    (id: number) => {
      if (!switchAvail.available) return;
      void switchChain(id).catch(() => {
        /* user rejected */
      });
    },
    [switchAvail, switchChain],
  );

  const onSelectChain = useCallback(
    async (id: number) => {
      if (syncSearchParam) {
        const next = new URLSearchParams(sp.toString());
        next.set("chain", String(id));
        router.push(`${path}?${next.toString()}`);
      }
      if (
        switchAvail.available &&
        walletChainId != null &&
        id !== walletChainId
      ) {
        try {
          await switchChain(id);
        } catch {
          /* user rejected */
        }
      }
    },
    [path, router, sp, switchAvail, switchChain, syncSearchParam, walletChainId],
  );

  // No session → no chrome. Connected (incl. SVM wrong_vm) always surfaces state.
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
      <span className="max-w-[9rem] truncate">{chainName}</span>
      <ChevronDownIcon size={14} className="shrink-0 text-text-secondary" aria-hidden />
    </>
  );

  if (wrong) {
    const ariaTarget =
      expectedChainId != null
        ? shortChainName(expectedChainId)
        : "a Kargain network";
    const ariaLabel =
      selectorState === "wrong_vm"
        ? "Wrong network — wallet family cannot switch to this network"
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
                Switch to {shortChainName(id)}
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
        {kargainChains.map((c) => {
          const isActive = c.id === displayChainId;
          if (isActive) {
            return (
              <div
                key={c.id}
                className="flex cursor-default items-center gap-2.5 rounded-sm px-3 py-2"
              >
                <ChainStatusDot />
                <span className="font-mono text-xs text-text-primary">{c.name}</span>
                <span className="ml-auto font-mono text-[10px] text-accent-warm">Active</span>
              </div>
            );
          }
          return (
            <DropdownMenuItem
              key={c.id}
              className="font-mono text-xs"
              onSelect={() => void onSelectChain(c.id)}
            >
              <ChainStatusDot />
              <span className="text-text-secondary">{c.name}</span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <div className="cursor-default px-3 py-2 font-mono text-xs italic text-text-secondary">
          More networks coming
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
