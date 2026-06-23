import type { Metadata } from "next";
import { Suspense } from "react";

import { getVerifierDirectory } from "@/app/actions/verifier-directory";
import { VerifierDirectory } from "@/components/verifier/verifier-directory";
import { VerifiersIntentBanner } from "@/components/verifier/verifiers-intent-banner";

export const metadata: Metadata = {
  title: "Verifiers",
  description:
    "Independent mechanics, inspectors, and brokers who verify vehicle passports on Kargain.",
};

function VerifierDirectorySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-live="polite">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-md border border-border-default bg-bg-surface"
          aria-hidden
        />
      ))}
    </div>
  );
}

async function VerifierDirectoryLoader() {
  const { verifiers } = await getVerifierDirectory();
  return <VerifierDirectory verifiers={verifiers} />;
}

export default function VerifiersPage() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <div className="mx-auto w-full max-w-7xl xl:max-w-[80rem] px-6 md:px-8 py-8 md:py-12">
        <VerifiersIntentBanner />
      </div>

      <section
        id="verifier-grid"
        className="mx-auto w-full max-w-7xl xl:max-w-[80rem] px-6 md:px-8 pb-16"
      >
        <Suspense fallback={<VerifierDirectorySkeleton />}>
          <VerifierDirectoryLoader />
        </Suspense>
      </section>
    </div>
  );
}
