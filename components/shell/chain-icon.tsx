"use client";

import { Globe } from "lucide-react";
import { useState } from "react";

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

  const dim = { width: size, height: size };

  if (!src || failed) {
    return (
      <Globe
        className={cn("shrink-0 text-text-secondary", className)}
        style={dim}
        aria-hidden
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
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
