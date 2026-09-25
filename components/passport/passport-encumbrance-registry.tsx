"use client";

import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import {
  instrumentReadoutPanel,
  serialLabel,
} from "@/lib/design/instrument-classes";
import { commerceFactCauseCopy } from "@/lib/passport/commerce-fact";
import {
  isRegisteredEncumbranceSource,
  type EncumbranceRegistry,
} from "@/lib/passport/encumbrance-registry";
import { isEvmHexAddress } from "@/lib/passport/passport-owner";
import { requireCommercialActive } from "@/lib/web3/commercial-active";
import { explorerAddressUrl } from "@/lib/web3/network-explorer";
import { cn } from "@/lib/utils";

type Props = {
  chainId: number;
  registry: EncumbranceRegistry;
  /** Source named by a live `SourceUnanswerable` permission refusal, if any. */
  unanswerableSource?: string | null;
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
  if (registry.status === "pending") {
    return (
      <section className={cn(instrumentReadoutPanel, "space-y-2")}>
        <p className={serialLabel}>Encumbrance sources</p>
        <p className="text-sm text-text-secondary">
          Waiting for registry membership…
        </p>
      </section>
    );
  }

  if (registry.status === "refused") {
    return (
      <section className={cn(instrumentReadoutPanel, "space-y-2")}>
        <p className={serialLabel}>Encumbrance sources</p>
        <p className="text-sm text-text-secondary">
          {commerceFactCauseCopy(registry.cause)}
        </p>
      </section>
    );
  }

  const sources = registry.value;
  const stack = requireCommercialActive(chainId);
  const highlight =
    unanswerableSource != null &&
    isRegisteredEncumbranceSource(registry, unanswerableSource, chainId)
      ? unanswerableSource
      : null;

  return (
    <section className={cn(instrumentReadoutPanel, "space-y-2")}>
      <p className={serialLabel}>Encumbrance sources</p>
      {sources.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No external sources are registered on this chain.
        </p>
      ) : (
        <ul className="space-y-2">
          {sources.map((source) => {
            const isBroken = highlight != null && source === highlight;
            const href = explorerAddressUrl(stack, source);
            return (
              <li key={source} className="space-y-0.5">
                {isEvmHexAddress(source) ? (
                  <EnsWalletLink
                    address={source}
                    externalHref={href}
                    className="font-mono text-sm tabular-nums"
                  />
                ) : (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-sm tabular-nums text-text-primary underline-offset-2 hover:underline"
                  >
                    {source}
                  </a>
                )}
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
