"use client";

import type { Address } from "viem";

import { useEnsProfile } from "@/hooks/use-ens-profile";
import { identiconBackground } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";

type Props = {
  address: Address | undefined;
  size?: number;
  className?: string;
  /** Fill the parent container (profile header). Omits fixed pixel dimensions. */
  fill?: boolean;
};

function sizeStyle(fill: boolean | undefined, size: number): { width: number; height: number } | undefined {
  return fill ? undefined : { width: size, height: size };
}

export function EnsAvatar({ address, size = 40, className, fill }: Props) {
  const { avatarUrl, isLoading } = useEnsProfile(address);
  const dimensions = sizeStyle(fill, size);
  const layout = cn(fill ? "block h-full w-full" : "inline-block shrink-0", "rounded-full", className);

  if (!address) {
    return (
      <span
        aria-hidden
        className={layout}
        style={dimensions}
      />
    );
  }

  if (isLoading) {
    return (
      <span
        aria-hidden
        className={cn(layout, "bg-bg-surface animate-pulse")}
        style={dimensions}
      />
    );
  }

  if (avatarUrl) {
    return (
      <span aria-hidden className={layout}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt=""
          width={fill ? undefined : size}
          height={fill ? undefined : size}
          className={cn(fill ? "h-full w-full" : "", "rounded-full object-cover")}
          style={dimensions}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={layout}
      style={{ ...dimensions, backgroundColor: identiconBackground(address) }}
    />
  );
}
