"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { ChevronDownIcon, UserCheckIcon } from "@/components/ui/icons";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Address } from "viem";

import { getProfileData } from "@/app/actions/marketplace-listings";
import { useShowBecomeKarPro } from "@/hooks/use-show-become-karpro";
import { sansLinkUnderline, shellControlHover } from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

type PassportWithStatus = { status?: string };

function UnverifiedPassportsBanner({ address }: { address: Address }) {
  const [passports, setPassports] = useState<PassportWithStatus[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

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
  }, [address]);

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
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-border-hover bg-transparent px-4 py-2 font-sans text-sm font-medium text-text-primary transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          shellControlHover,
        )}
      >
        Browse verifiers
        <ChevronDownIcon size={16} aria-hidden />
      </a>
    </div>
  );
}

export function VerifiersIntentBanner() {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const showBecomeKarPro = useShowBecomeKarPro();
  const isKarPro = evm.ok && !showBecomeKarPro;

  // Status banner about the signed-in verifier — nothing to state without one.
  if (!address) {
    return null;
  }

  if (isKarPro) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-md border border-border-default bg-bg-card p-4"
      >
        <UserCheckIcon size={20} className="shrink-0 text-accent-warm" />
        <p className="font-sans text-sm text-text-primary">
          You are an active verifier.{" "}
          <Link href={`/profile/${address}`} className={sansLinkUnderline}>
            View your profile →
          </Link>
        </p>
      </div>
    );
  }

  return <UnverifiedPassportsBanner key={address} address={address} />;
}
