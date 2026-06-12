"use client";

import { Copy } from "lucide-react";
import { useCallback, useState } from "react";
import { getAddress } from "viem";

import { cn } from "@/lib/utils";

function shortAddress(address: string): string {
  try {
    const normalized = getAddress(address as `0x${string}`);
    return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
  } catch {
    return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
  }
}

export function WalletAddress({
  address,
  showCopy = false,
  full = false,
  className,
}: {
  address: string;
  showCopy?: boolean;
  full?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [address]);

  return (
    <span className={cn("group inline-flex items-center gap-1.5 font-mono text-sm text-text-secondary", className)}>
      <span className={full ? "break-all" : undefined} title={address}>
        {full ? address : shortAddress(address)}
      </span>
      {showCopy && (
        <button
          type="button"
          onClick={() => void onCopy()}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] rounded-sm"
          aria-label={copied ? "Copied" : "Copy address"}
        >
          <Copy size={14} strokeWidth={1.5} />
        </button>
      )}
    </span>
  );
}
