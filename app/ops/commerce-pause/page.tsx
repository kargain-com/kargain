import type { Metadata } from "next";

import { CommercePauseOpsClient } from "@/components/commerce/commerce-pause-ops-client";

export const metadata: Metadata = {
  title: "Commerce pause",
};

/**
 * Ops-only G3 pause surface. Not in product navigation — reach via URL or the
 * quiet guardian link on own profile.
 */
export default function CommercePauseOpsPage() {
  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <div className="mx-auto w-full max-w-3xl px-6 md:px-8 pt-8 md:pt-12 pb-16">
        <h1 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
          Commerce pause
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Emergency stop for selling modes. Settlement, claims, and challenges keep
          running while paused.
        </p>
        <div className="mt-8">
          <CommercePauseOpsClient />
        </div>
      </div>
    </div>
  );
}
