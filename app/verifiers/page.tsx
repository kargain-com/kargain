import type { Metadata } from "next";

import { getVerifierDirectory } from "@/app/actions/verifier-directory";
import { VerifierDirectory } from "@/components/verifier/verifier-directory";
import { VerifiersIntentBanner } from "@/components/verifier/verifiers-intent-banner";

export const metadata: Metadata = {
  title: "Verifiers",
  description:
    "Independent mechanics, inspectors, and brokers who verify vehicle passports on Kargain.",
};

export default async function VerifiersPage() {
  const { verifiers } = await getVerifierDirectory();

  return (
    <div className="min-h-dvh bg-bg-primary">
      <section className="w-full hero-pattern">
        <div className="mx-auto w-full max-w-7xl px-6 py-16 md:px-8 md:py-24 xl:max-w-[80rem]">
          <header className="max-w-2xl">
            <p className="mb-4 font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm">
              Verified professionals
            </p>
            <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
              Find someone to verify your vehicle
            </h1>
            <p className="mt-4 font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-secondary">
              KarPro verifiers are staked on-chain professionals. Each verification permanently
              records their attestation on your passport.
            </p>
          </header>
          <div className="mt-8">
            <VerifiersIntentBanner />
          </div>
        </div>
      </section>

      <section
        id="verifier-grid"
        className="mx-auto w-full max-w-7xl px-6 py-16 md:px-8 xl:max-w-[80rem]"
      >
        <VerifierDirectory verifiers={verifiers} />
      </section>
    </div>
  );
}
