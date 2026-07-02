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
    <div
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      role="status"
      aria-live="polite"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <article
          key={i}
          className="flex animate-pulse flex-col gap-4 rounded-md border border-border-default bg-bg-card p-6"
          aria-hidden
        >
          <div className="flex items-center gap-3">
            <div className="size-12 shrink-0 rounded-full bg-bg-surface" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-bg-surface" />
              <div className="h-3 w-1/2 rounded bg-bg-surface" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-8 w-16 rounded bg-bg-surface" />
            <div className="h-3 w-24 rounded bg-bg-surface" />
            <div className="h-3 w-20 rounded bg-bg-surface" />
          </div>
          <div className="h-10 w-full rounded bg-bg-surface" />
        </article>
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
