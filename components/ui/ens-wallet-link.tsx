"use client";

import Link from "next/link";
import { getAddress, type Address } from "viem";

import { useEnsProfile } from "@/hooks/use-ens-profile";
import { shortAddress } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";

function checksumAddress(address: string): string {
  try {
    return getAddress(address as Address);
  } catch {
    return address;
  }
}

type Props = {
  address: string;
  href: string;
  className?: string;
};

export function EnsWalletLink({ address, href, className }: Props) {
  const checksum = checksumAddress(address);
  const { displayName, isLoading } = useEnsProfile(checksum as Address);
  const hasEnsName = !displayName.startsWith("0x");

  if (isLoading) {
    return <span className="inline-block h-4 w-24 animate-pulse rounded-sm bg-bg-surface" />;
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <Link href={href} title={checksum} className={cn(className)}>
        {displayName}
      </Link>
      {hasEnsName && (
        <span className="font-mono text-xs text-text-secondary">{shortAddress(checksum)}</span>
      )}
    </span>
  );
}
