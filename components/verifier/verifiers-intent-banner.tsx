"use client";

import { ChevronDown, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { getProfileData } from "@/app/actions/marketplace-listings";
import { useShowBecomeKarPro } from "@/hooks/use-show-become-karpro";

type PassportWithStatus = { status?: string };

export function VerifiersIntentBanner() {
  const { address, isConnected } = useAccount();
  const showBecomeKarPro = useShowBecomeKarPro();
  const isKarPro = isConnected && !showBecomeKarPro;

  const [passports, setPassports] = useState<PassportWithStatus[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !address || isKarPro) {
      setPassports(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void getProfileData(address).then((result) => {
      if (cancelled) return;
      const unverified = result.passports.filter(
        (p) => (p as PassportWithStatus).status === "UNVERIFIED",
      ) as PassportWithStatus[];
      setPassports(unverified);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, isKarPro]);

  if (!isConnected) {
    return null;
  }

  if (isKarPro && address) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-md border border-border-default bg-bg-card p-4"
      >
        <ShieldCheck size={20} strokeWidth={1.5} className="shrink-0 text-accent-warm" />
        <p className="font-sans text-sm text-text-primary">
          You are an active verifier.{" "}
          <Link
            href={`/profile/${address}`}
            className="text-accent-warm underline-offset-2 hover:underline"
          >
            View your profile →
          </Link>
        </p>
      </div>
    );
  }

  if (loading && passports === null) {
    return (
      <div
        aria-hidden="true"
        className="h-16 animate-pulse rounded-md border border-border-default bg-bg-card p-4"
      />
    );
  }

  const unverifiedCount = passports?.length ?? 0;

  if (unverifiedCount === 0) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-4 rounded-md border border-border-default bg-bg-card p-4 sm:flex-row sm:items-center"
    >
      <div className="flex-1">
        <p className="font-sans text-sm font-medium text-text-primary">
          {unverifiedCount === 1
            ? "You have 1 passport awaiting verification"
            : `You have ${unverifiedCount} passports awaiting verification`}
        </p>
        <p className="mt-1 font-sans text-xs text-text-secondary">
          Browse the verifiers below and contact one to get started.
        </p>
      </div>
      <a
        href="#verifier-grid"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-border-hover bg-transparent px-4 py-2 font-sans text-sm font-medium text-text-primary transition-colors duration-200 hover:border-accent-warm hover:text-accent-warm focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
      >
        Browse verifiers
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
      </a>
    </div>
  );
}
