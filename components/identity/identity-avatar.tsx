"use client";

import { useState } from "react";

import { EnsAvatar } from "@/components/ui/ens-avatar";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { isEvmHexAddress } from "@/lib/passport/passport-owner";
import { cn } from "@/lib/utils";

type Props = {
  address: string | undefined;
  size?: number;
  className?: string;
  /** Fill the parent container (profile header). Omits fixed pixel dimensions. */
  fill?: boolean;
  alt?: string;
};

function sizeStyle(fill: boolean | undefined, size: number): { width: number; height: number } | undefined {
  return fill ? undefined : { width: size, height: size };
}

function IdentityAvatarContent({
  address,
  nostrPicture,
  nostrLoading,
  size,
  className,
  fill,
  alt,
}: {
  address: string | undefined;
  nostrPicture: string | null;
  nostrLoading: boolean;
  size: number;
  className?: string;
  fill?: boolean;
  alt: string;
}) {
  const [nostrFailed, setNostrFailed] = useState(false);

  const dimensions = sizeStyle(fill, size);
  const layout = cn(
    fill ? "block h-full w-full" : "inline-block shrink-0",
    "overflow-hidden rounded-full",
    className,
  );

  if (nostrPicture && !nostrFailed) {
    return (
      <img
        src={nostrPicture}
        alt={alt}
        width={fill ? undefined : size}
        height={fill ? undefined : size}
        className={cn(layout, "object-cover", fill && "h-full w-full")}
        style={dimensions}
        onError={() => setNostrFailed(true)}
      />
    );
  }

  if (nostrLoading && address) {
    return (
      <span
        aria-hidden={alt ? undefined : true}
        className={cn(layout, "animate-pulse bg-bg-surface")}
        style={dimensions}
      />
    );
  }

  const evmAddress = address != null && isEvmHexAddress(address) ? address : undefined;
  return <EnsAvatar address={address} size={size} fill={fill} className={className} />;
}

/** Avatar priority: Nostr kind 0 picture → ENS avatar → address identicon fill. */
export function IdentityAvatar({ address, size = 40, className, fill, alt = "" }: Props) {
  const evmAddress =
    address != null && isEvmHexAddress(address) ? address : undefined;
  const { profile, loading: nostrLoading } = useNostrProfile(evmAddress);
  const nostrPicture = profile?.picture?.trim() || null;

  return (
    <IdentityAvatarContent
      key={nostrPicture ?? "no-picture"}
      address={address}
      nostrPicture={nostrPicture}
      nostrLoading={nostrLoading}
      size={size}
      className={className}
      fill={fill}
      alt={alt}
    />
  );
}
