"use client";

import type { Address } from "viem";

import { useEnsProfile } from "@/hooks/use-ens-profile";
import { identiconBackground } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";

export type EnsAvatarShape = "round" | "square";

type Props = {
  address: Address | undefined;
  size?: number;
  className?: string;
  /** Round for private users; square for KarPro professionals. Navbar stays round. */
  shape?: EnsAvatarShape;
  /** Fill the parent container (profile header). Omits fixed pixel dimensions. */
  fill?: boolean;
};

function shapeRadius(shape: EnsAvatarShape): string {
  return shape === "round" ? "rounded-full" : "rounded-md";
}

function sizeStyle(fill: boolean | undefined, size: number): { width: number; height: number } | undefined {
  return fill ? undefined : { width: size, height: size };
}

export function EnsAvatar({ address, size = 40, className, shape = "round", fill }: Props) {
  const { avatarUrl, isLoading } = useEnsProfile(address);
  const radius = shapeRadius(shape);
  const dimensions = sizeStyle(fill, size);
  const layout = cn(fill ? "block h-full w-full" : "inline-block shrink-0", className);

  if (!address) {
    return (
      <span
        aria-hidden
        className={cn(layout, radius)}
        style={dimensions}
      />
    );
  }

  if (isLoading) {
    return (
      <span
        aria-hidden
        className={cn(layout, "bg-bg-surface animate-pulse", radius)}
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
          className={cn(fill ? "h-full w-full" : "", "object-cover", radius)}
          style={dimensions}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(layout, radius)}
      style={{ ...dimensions, backgroundColor: identiconBackground(address) }}
    />
  );
}
