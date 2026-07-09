"use client";

import { ChevronDownIcon } from "@/components/ui/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DEFAULT_CHAIN_ID,
  getViemChain,
  kargainChains,
  wagmiChainId,
} from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type Props = {
  syncSearchParam?: boolean;
  expectedChainId?: number;
  className?: string;
};

function ChainStatusDot({ wrong }: { wrong?: boolean }) {
  if (wrong) {
    return <span className="size-1.5 shrink-0 rounded-full bg-red-400" aria-hidden />;
  }
  return <span className="size-1.5 shrink-0 rounded-full bg-[#0052ff] opacity-80" aria-hidden />;
}

export function ChainSelector({ syncSearchParam, expectedChainId, className }: Props) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const { switchChainAsync, isPending } = useSwitchChain();
  const walletChainId = useChainId();
  const { isConnected } = useAccount();

  const urlChain = useMemo(() => {
    const raw = sp.get("chain");
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [sp]);

  const targetChainId = expectedChainId ?? DEFAULT_CHAIN_ID;
  const displayChainId = syncSearchParam ? (urlChain ?? walletChainId) : walletChainId;
  const wrong = isConnected && walletChainId !== targetChainId;
  const activeChain = getViemChain(displayChainId);
  const chainName = wrong ? "Wrong network" : (activeChain?.name ?? `Chain ${displayChainId}`);

  const onSwitchToTarget = useCallback(() => {
    if (!switchChainAsync) return;
    void switchChainAsync({ chainId: wagmiChainId(targetChainId) }).catch(() => {
      /* user rejected */
    });
  }, [switchChainAsync, targetChainId]);

  const onSelectChain = useCallback(
    async (id: number) => {
      if (syncSearchParam) {
        const next = new URLSearchParams(sp.toString());
        next.set("chain", String(id));
        router.push(`${path}?${next.toString()}`);
      }
      if (isConnected && switchChainAsync && id !== walletChainId) {
        try {
          await switchChainAsync({ chainId: wagmiChainId(id) });
        } catch {
          /* user rejected */
        }
      }
    },
    [isConnected, path, router, sp, switchChainAsync, syncSearchParam, walletChainId],
  );

  if (!isConnected) return null;

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
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={isPending}
            className={triggerClass}
            aria-label="Wrong network — switch to Base Sepolia"
          >
            {trigger}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px] p-1">
          <DropdownMenuItem className="font-mono text-xs" onSelect={onSwitchToTarget}>
            Switch to Base Sepolia
          </DropdownMenuItem>
        </DropdownMenuContent>
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
