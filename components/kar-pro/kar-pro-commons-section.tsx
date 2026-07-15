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

export function KarProCommonsSection({ address }: { address: `0x${string}` }) {
  return <KarProCommonsQueue address={address} />;
}
