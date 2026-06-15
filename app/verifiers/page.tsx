import type { Metadata } from "next";

import { getVerifierDirectory } from "@/app/actions/verifier-directory";
import { VerifierDirectory } from "@/components/verifier/verifier-directory";

export const metadata: Metadata = {
  title: "Verifiers",
  description:
    "Independent mechanics, inspectors, and brokers who verify vehicle passports on Kargain.",
};

export default async function VerifiersPage() {
  const { verifiers } = await getVerifierDirectory();

  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="mx-auto w-full max-w-7xl px-6 py-24 md:px-8 xl:max-w-[80rem]">
        <header className="mb-12 max-w-3xl md:mb-16">
          <p className="mb-4 font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm">
            Network
          </p>
          <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
            Verified professionals
          </h1>
          <p className="mt-4 font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-secondary">
            Independent mechanics, inspectors, and brokers who verify vehicle passports on
            Kargain.
          </p>
        </header>

        {verifiers.length === 0 ? (
          <p className="text-center font-sans text-sm text-text-secondary">
            No active verifiers yet.
          </p>
        ) : (
          <VerifierDirectory verifiers={verifiers} />
        )}
      </div>
    </div>
  );
}
