"use client";

import { useState } from "react";

import { GlobeIcon } from "@/components/ui/icons";
import { chainIconUrl } from "@/lib/web3/chain-icon-url";
import { cn } from "@/lib/utils";

export function ChainIcon({
  chainId,
  className,
  size = 20,
}: {
  chainId: number;
  className?: string;
  /** CSS px */
  size?: number;
}) {
  const src = chainIconUrl(chainId);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <GlobeIcon
        size={size}
        className={cn("shrink-0 text-text-secondary", className)}
        aria-hidden
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full object-cover", className)}
      onError={() => setFailed(true)}
    />
  );
}
