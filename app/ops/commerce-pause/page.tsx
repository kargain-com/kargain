import type { Metadata } from "next";

import { CommercePauseOpsClient } from "@/components/commerce/commerce-pause-ops-client";
import { CommerceRevokeOpsSection } from "@/components/commerce/commerce-revoke-ops-section";

export const metadata: Metadata = {
  title: "Commerce ops",
};

/**
 * Ops-only G3 surface: pause + soft-revoke. Not in product navigation — reach
 * via URL or the quiet guardian link on own profile. No unpause / approve.
 */
export default function CommercePauseOpsPage() {
  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <div className="mx-auto w-full max-w-3xl px-6 md:px-8 pt-8 md:pt-12 pb-16">
        <h1 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
          Commerce ops
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Guardian reducing powers for selling modes. Settlement, claims, and
          challenges keep running under pause or soft-revoke.
        </p>

        <section className="mt-8 flex flex-col gap-4">
          <h2 className="font-sans text-sm tracking-wide text-text-secondary uppercase">
            Pause
          </h2>
          <CommercePauseOpsClient />
        </section>

        <section className="mt-12 flex flex-col gap-4">
          <h2 className="font-sans text-sm tracking-wide text-text-secondary uppercase">
            Soft-revoke payment token
          </h2>
          <CommerceRevokeOpsSection />
        </section>
      </div>
    </div>
  );
}
