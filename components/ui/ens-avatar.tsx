"use client";

import type { Address } from "viem";

import { useEnsProfile } from "@/hooks/use-ens-profile";
import { identiconBackground } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";

type Props = {
  address: Address | undefined;
  size?: number;
  className?: string;
};

export function EnsAvatar({ address, size = 40, className }: Props) {
  const { avatarUrl, isLoading } = useEnsProfile(address);

  if (!address) {
    return (
      <span
        aria-hidden
        className={cn("inline-block shrink-0 rounded-full", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  if (isLoading) {
    return (
      <span
        aria-hidden
        className={cn("inline-block shrink-0 rounded-full bg-bg-surface animate-pulse", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  if (avatarUrl) {
    return (
      <span aria-hidden className={cn("inline-block shrink-0", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{ width: size, height: size, backgroundColor: identiconBackground(address) }}
    />
  );
}
