"use client";

import Link from "next/link";
import type { Address } from "viem";

import type { VerifierDirectoryEntry } from "@/app/actions/verifier-directory";
import { EnsAvatar } from "@/components/ui/ens-avatar";
import { categoryIndexToLabel } from "@/lib/kar-pro/kar-pro-metadata";
import { navShortAddress } from "@/lib/web3/wallet-display";

type Props = {
  verifiers: VerifierDirectoryEntry[];
};

function VerifierStatus({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-sans text-sm text-text-secondary">
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ${active ? "bg-emerald-500" : "bg-text-tertiary"}`}
      />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function VerifierCard({ verifier }: { verifier: VerifierDirectoryEntry }) {
  const shortAddress = navShortAddress(verifier.address);
  const categoryLabel = categoryIndexToLabel(verifier.category).toUpperCase();
  const verificationLabel =
    verifier.verificationCount === 1
      ? "1 verification"
      : `${verifier.verificationCount} verifications`;

  return (
    <Link
      href={`/verifier/${verifier.address}`}
      className="block rounded-md border border-border-default bg-bg-card p-6 transition-colors duration-200 hover:border-accent-warm focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:p-8"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <EnsAvatar address={verifier.address as Address} size={40} />
          <div className="min-w-0">
            {verifier.name.trim() ? (
              <>
                <p className="truncate font-sans text-base font-medium text-text-primary">
                  {verifier.name.trim()}
                </p>
                <p className="font-mono text-xs text-text-secondary">{shortAddress}</p>
              </>
            ) : (
              <p className="font-sans text-base font-medium text-text-primary">{shortAddress}</p>
            )}
          </div>
        </div>

        <span className="w-fit font-mono text-xs uppercase tracking-wider border border-border-default rounded-sm px-2 py-1 text-text-secondary">
          {categoryLabel}
        </span>

        <p className="font-sans text-sm text-text-secondary">{verificationLabel}</p>

        <VerifierStatus active={verifier.active} />
      </div>
    </Link>
  );
}

export function VerifierDirectory({ verifiers }: Props) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {verifiers.map((verifier) => (
        <VerifierCard key={verifier.address} verifier={verifier} />
      ))}
    </div>
  );
}
