"use client";

import { ProPassIdLabel } from "@/components/kar-pro/pro-pass-id-label";
import { categoryIndexToLabel } from "@/lib/kar-pro/kar-pro-metadata";
import { karProNetworkInstrumentLine } from "@/lib/kar-pro/membership-roster";
import { proPassTokenIdFromAddress } from "@/lib/kar-pro/pro-pass-token-id";

type KarProIdentityStripProps = {
  chainId: number;
  passId?: bigint;
  category: number;
  name: string;
  address: `0x${string}`;
};

export function KarProIdentityStrip({
  chainId,
  passId,
  category,
  name,
  address,
}: KarProIdentityStripProps) {
  const resolvedPassId = passId ?? proPassTokenIdFromAddress(address);

  return (
    <div className="rounded-md border border-border-default bg-bg-card p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-accent-warm">
          ✓ KarPro
        </span>
        <span className="rounded-sm border border-border-default px-2 py-1 font-mono text-xs uppercase tracking-wider text-text-secondary">
          {categoryIndexToLabel(category)}
        </span>
      </div>

      <h2 className="mt-4 font-sans text-base font-medium leading-snug tracking-tight text-text-primary">
        {name}
      </h2>

      <p className="mt-2 font-mono text-fluid-sm text-text-secondary">
        {karProNetworkInstrumentLine(chainId)}{" "}
        <span className="tabular-nums text-text-tertiary">({chainId})</span>
      </p>

      <p className="mt-1 font-mono text-fluid-sm text-text-secondary">
        Pass{" "}
        <ProPassIdLabel
          tokenId={resolvedPassId}
          chainId={chainId}
          prefix="none"
          showChain={false}
          variant="mono"
          className="text-fluid-sm"
        />
      </p>
    </div>
  );
}
