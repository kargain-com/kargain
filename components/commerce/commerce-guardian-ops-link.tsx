"use client";

import Link from "next/link";

import { useIsCommerceGuardian } from "@/hooks/use-is-commerce-guardian";
import { monoLinkSm } from "@/lib/design/instrument-classes";

/** Quiet ops entry — only when the connected wallet is a mode guardian. */
export function CommerceGuardianOpsLink() {
  const { isGuardian } = useIsCommerceGuardian(true);
  if (!isGuardian) return null;
  return (
    <p className="text-sm text-text-secondary">
      <Link href="/ops/commerce-pause" className={monoLinkSm}>
        Commerce pause →
      </Link>
    </p>
  );
}
