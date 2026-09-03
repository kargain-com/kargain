"use client";

import {
  evmSwitchChainAvailability,
  useActiveAccount,
} from "@/hooks/use-active-account";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { commercialChainIds } from "@/lib/web3/chain-context";
import { shortChainName } from "@/lib/web3/supported-chains";

type Props = {
  title?: string;
};

/** Prompt when the wallet is connected on a non-commercial network. */
export function KarProNetworkPrompt({
  title = "Switch to a Kargain network to become or manage KarPro.",
}: Props = {}) {
  const { account, switchChain, isConnectPending: isPending } = useActiveAccount();
  const switchAvail = evmSwitchChainAvailability(account);

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
              disabled={isPending || !switchAvail.available}
              onClick={() => {
                if (!switchAvail.available) return;
                void switchChain(id);
              }}
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
