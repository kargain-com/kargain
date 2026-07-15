"use client";

import dynamic from "next/dynamic";

import { SpinnerIcon } from "@/components/ui/icons";

/**
 * Lazy chunk: keeps `@kargain/vincent` (WMI tables + protocol) out of the
 * KarPro hub bundle until the Commons section is visited.
 */
const KarProCommonsQueue = dynamic(
  () =>
    import("@/components/kar-pro/kar-pro-commons-queue").then(
      (mod) => mod.KarProCommonsQueue,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-md border border-border-default bg-bg-card p-6">
        <p className="flex items-center gap-2 font-sans text-fluid-sm text-text-secondary">
          <SpinnerIcon size={16} className="animate-spin" />
          Loading the Commons queue…
        </p>
      </div>
    ),
  },
);

/**
 * Lazy chunk: F-2.2 governance readouts — registry chain reads
 * (`@kargain/vincent/anchor`) stay out of the hub bundle.
 */
const KarProCommonsGovernance = dynamic(
  () =>
    import("@/components/kar-pro/kar-pro-commons-governance").then(
      (mod) => mod.KarProCommonsGovernance,
    ),
  { ssr: false },
);

export function KarProCommonsSection({ address }: { address: `0x${string}` }) {
  return (
    <div className="space-y-8">
      <KarProCommonsQueue address={address} />
      <KarProCommonsGovernance />
    </div>
  );
}
