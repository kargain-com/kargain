"use client";

import { useState } from "react";

import { GlobeIcon } from "@/components/ui/icons";
import { commercialActive } from "@/lib/web3/commercial-active";
import { networkIconUrl } from "@/lib/web3/chain-icon-url";
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
  const stack = commercialActive(chainId);
  const src = stack != null ? networkIconUrl(stack) : undefined;
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
