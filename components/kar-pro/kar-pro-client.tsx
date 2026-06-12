"use client";

import { ChainSelector } from "@/components/shell/chain-selector";

export function KarProClient({ embedded = false }: { embedded?: boolean }) {
  // TODO Phase 1.1: KarProPass contract pending
  return (
    <div className={embedded ? "space-y-5 text-text-primary" : "mx-auto max-w-lg space-y-8 px-4 py-12 text-text-primary"}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={embedded ? "text-lg font-medium tracking-tight" : "text-2xl font-medium tracking-tight"}>
            Kar Pro
          </h1>
        </div>
        <ChainSelector />
      </div>
      <p className="rounded-md border border-border-hover bg-bg-surface p-4 text-sm text-text-secondary">
        KarPro verification is coming in Phase 1.
      </p>
    </div>
  );
}
