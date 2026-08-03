"use client";

import { useSwitchChain } from "wagmi";

import { categoryLabel, instrumentReadoutPanel, monoLinkSm } from "@/lib/design/instrument-classes";
import type { KarProMembershipRow } from "@/lib/kar-pro/membership-roster";
import { shortChainName, wagmiChainId } from "@/lib/web3/supported-chains";

function statusLabel(status: KarProMembershipRow["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "not_joined":
      return "Not joined";
    case "unresolved":
      return "Network unread";
  }
}

type KarProNetworksRosterProps = {
  rows: readonly KarProMembershipRow[];
};

/**
 * Level B roster of KarPro membership across commercial networks.
 * Switch CTAs only — join form appears after wallet target is inactive on that chain.
 */
export function KarProNetworksRoster({ rows }: KarProNetworksRosterProps) {
  const { switchChainAsync, isPending } = useSwitchChain();

  return (
    <div className={`${instrumentReadoutPanel} space-y-1`}>
      <div className="space-y-1">
        <p className={categoryLabel}>Your networks</p>
        <p className="font-sans text-xs text-text-secondary">
          KarPro membership is separate on each network.
        </p>
      </div>
      <ul className="mt-4 divide-y divide-border-default">
        {rows.map((row) => {
          const name = shortChainName(row.chainId);
          const showManaging = row.isCurrentWalletChain;
          let action: { label: string; onClick: () => void } | null = null;
          if (!showManaging && row.status === "active") {
            action = {
              label: "Switch to manage",
              onClick: () => void switchChainAsync?.({ chainId: wagmiChainId(row.chainId) }),
            };
          } else if (!showManaging && row.status === "not_joined") {
            action = {
              label: "Switch to join",
              onClick: () => void switchChainAsync?.({ chainId: wagmiChainId(row.chainId) }),
            };
          }

          return (
            <li
              key={row.chainId}
              className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-sans text-sm text-text-primary">
                  {name}{" "}
                  <span className="font-mono text-xs tabular-nums text-text-tertiary">
                    ({row.chainId})
                  </span>
                </p>
                <p className="font-sans text-xs text-text-secondary">
                  {statusLabel(row.status)}
                  {showManaging ? " · Managing" : null}
                </p>
              </div>
              <div className="shrink-0 pt-0.5">
                {action ? (
                  <button
                    type="button"
                    className={monoLinkSm}
                    disabled={isPending}
                    onClick={action.onClick}
                  >
                    {action.label}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
