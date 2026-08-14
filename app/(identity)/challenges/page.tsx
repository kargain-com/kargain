import type { Metadata } from "next";
import { Suspense } from "react";

import { ChallengesClient } from "@/components/challenges/challenges-client";

export const metadata: Metadata = {
  title: "Challenges",
};

export default function ChallengesPage() {
  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-8 pt-8 md:pt-12 pb-16 xl:max-w-[80rem]">
        <h1 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
          Challenges
        </h1>
        <Suspense fallback={null}>
          <ChallengesClient />
        </Suspense>
      </div>
    </div>
  );
}
