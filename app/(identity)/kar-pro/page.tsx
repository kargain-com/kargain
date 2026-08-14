import type { Metadata } from "next";

import { KarProHeroSubtitle } from "@/components/kar-pro/kar-pro-hero-subtitle";
import { KarProPageContent } from "@/components/kar-pro/kar-pro-page-content";

export const metadata: Metadata = {
  title: "KarPro",
  description:
    "Become a trusted vehicle passport verifier. Stake ETH, build your reputation, help buyers trust sellers.",
};

export default function KarProPage() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <section className="border-b border-border-default py-16">
        <div className="mx-auto w-full max-w-7xl px-6 md:px-8 xl:max-w-[80rem]">
          <header className="max-w-3xl">
            <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm mb-4">
              KarPro
            </p>
            <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
              Verify vehicle passports
            </h1>
            <KarProHeroSubtitle />
          </header>
        </div>
      </section>
      <KarProPageContent />
    </div>
  );
}
