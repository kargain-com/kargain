"use client";

import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import {
  instrumentReadoutPanel,
  serialLabel,
} from "@/lib/design/instrument-classes";
import {
  isRegisteredEncumbranceSource,
  type EncumbranceRegistry,
} from "@/lib/passport/encumbrance-registry";
import { explorerAddressUrl } from "@/lib/web3/wallet-account";
import { cn } from "@/lib/utils";
import { getAddress, type Address } from "viem";

type Props = {
  chainId: number;
  registry: EncumbranceRegistry;
  /** Source named by a live `SourceUnanswerable` permission refusal, if any. */
  unanswerableSource?: Address | null;
};

/**
 * Factual Level B readout of encumbrance sources registered on this custody
 * chain’s KarPassport. Membership is chain-scoped — never invent members.
 */
export function PassportEncumbranceRegistry({
  chainId,
  registry,
  unanswerableSource = null,
}: Props) {
  if (registry.unresolved) {
    return (
      <section className={cn(instrumentReadoutPanel, "space-y-2")}>
        <p className={serialLabel}>Encumbrance sources</p>
        <p className="text-sm text-text-secondary">
          Waiting for registry membership…
        </p>
      </section>
    );
  }

  const highlight =
    unanswerableSource != null &&
    isRegisteredEncumbranceSource(registry, unanswerableSource)
      ? getAddress(unanswerableSource)
      : null;

  return (
    <section className={cn(instrumentReadoutPanel, "space-y-2")}>
      <p className={serialLabel}>Encumbrance sources</p>
      {registry.sources.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No external sources are registered on this chain.
        </p>
      ) : (
        <ul className="space-y-2">
          {registry.sources.map((source) => {
            const isBroken = highlight != null && source === highlight;
            return (
              <li key={source} className="space-y-0.5">
                <EnsWalletLink
                  address={source}
                  externalHref={explorerAddressUrl(chainId, source)}
                  className="font-mono text-sm tabular-nums"
                />
                {isBroken ? (
                  <p className="text-sm text-text-secondary">
                    Could not answer a permission question.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
