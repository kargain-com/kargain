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
      <div className="mx-auto w-full max-w-7xl xl:max-w-[80rem] px-6 md:px-8 py-8 md:py-12">
        <VerifiersIntentBanner />
      </div>

      <section
        id="verifier-grid"
        className="mx-auto w-full max-w-7xl xl:max-w-[80rem] px-6 md:px-8 pb-16"
      >
        <VerifierDirectory verifiers={verifiers} />
      </section>
    </div>
  );
}
