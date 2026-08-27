"use client";

import { useSwitchChain } from "wagmi";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { commercialChainIds } from "@/lib/web3/chain-context";
import { shortChainName, wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  title?: string;
};

/** Prompt when the wallet is connected on a non-commercial network. */
export function KarProNetworkPrompt({
  title = "Switch to a Kargain network to become or manage KarPro.",
}: Props = {}) {
  const { switchChainAsync, isPending } = useSwitchChain();

  return (
    <div className="space-y-4">
      <EmptyState
        variant="infrastructure"
        level="B"
        title={title}
      />
      <ul className="flex flex-col gap-2">
        {commercialChainIds().map((id) => (
          <li key={id}>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => void switchChainAsync?.({ chainId: wagmiChainId(id) })}
            >
              Switch to {shortChainName(id)}{" "}
              <span className="font-mono text-xs tabular-nums text-text-tertiary">
                ({id})
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
