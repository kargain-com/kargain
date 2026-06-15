"use client";

import Link from "next/link";
import { useAccount } from "wagmi";

export function ProfileEditLink({ wallet }: { wallet: `0x${string}` }) {
  const { address } = useAccount();
  if (!address || address.toLowerCase() !== wallet.toLowerCase()) return null;
  return (
    <Link
      href="/profile/edit"
      className="inline-flex h-9 items-center justify-center rounded-sm border border-border-hover px-4 text-sm text-text-primary hover:bg-bg-surface"
    >
      Edit profile
    </Link>
  );
}
