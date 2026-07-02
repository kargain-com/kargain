"use client";

import Link from "next/link";
import { getAddress, type Address } from "viem";

import { useEnsProfile } from "@/hooks/use-ens-profile";
import { monoLink } from "@/lib/design/instrument-classes";
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
  href?: string;
  externalHref?: string;
  className?: string;
};

export function EnsWalletLink({ address, href, externalHref, className }: Props) {
  const checksum = checksumAddress(address);
  const { displayName, isLoading } = useEnsProfile(checksum as Address);
  const hasEnsName = !displayName.startsWith("0x");
  const linkClassName = cn(monoLink, className);

  if (isLoading) {
    return <span className="inline-block h-4 w-24 animate-pulse rounded-sm bg-bg-surface" />;
  }

  const label = (
    <span className="inline-flex flex-col gap-0.5">
      {externalHref ? (
        <a
          href={externalHref}
          target="_blank"
          rel="noopener noreferrer"
          title={checksum}
          className={linkClassName}
        >
          {displayName}
        </a>
      ) : (
        <Link href={href ?? `/profile/${checksum}`} title={checksum} className={linkClassName}>
          {displayName}
        </Link>
      )}
      {hasEnsName && (
        <span className="font-mono text-xs text-text-secondary">{shortAddress(checksum)}</span>
      )}
    </span>
  );

  return label;
}
