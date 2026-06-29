"use client";

import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "wagmi";

import { getProfileData } from "@/app/actions/marketplace-listings";
import { formatPassportTitle } from "@/lib/passport/passport-token-id";
import { getCachedXmtpClient, useXmtpClient } from "@/hooks/use-xmtp-client";
import { openDmWithPeer } from "@/lib/xmtp/open-dm";

type Props = {
  verifierAddress: `0x${string}`;
  verifierName: string;
};

type PassportRow = {
  id?: unknown;
  status?: string;
  make?: string;
  model?: string;
  year?: number;
};

const GHOST_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 font-sans text-sm font-medium text-text-secondary border-0 bg-transparent px-4 py-2 rounded-sm min-h-11 transition-colors duration-200 hover:text-text-primary hover:bg-bg-surface focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]";

function LoadingSpinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function buildVerificationMessage(unverified: PassportRow[]): string {
  const header = "Hi, I'd like to get one of my vehicles verified.";
  if (unverified.length === 0) return header;

  const lines = unverified.slice(0, 3).map((p) => {
    const label = [p.make, p.model, p.year].filter(Boolean).join(" ");
    const id = p.id != null ? String(p.id) : null;
    if (!id) return `• Passport #?${label ? " — " + label : ""}`;
    return `• ${formatPassportTitle(id)}${label ? " — " + label : ""}`;
  });
  const more = unverified.length > 3 ? `\n+ ${unverified.length - 3} more` : "";
  return [header, ...lines, more].filter(Boolean).join("\n");
}

export function VerificationRequestButton({ verifierAddress, verifierName }: Props) {
  const { address: userAddress, isConnected } = useAccount();
  const { client, isInitializing, ensureInitialized } = useXmtpClient();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (
    isConnected &&
    userAddress &&
    userAddress.toLowerCase() === verifierAddress.toLowerCase()
  ) {
    return null;
  }

  const handleRequestVerification = async () => {
    if (!isConnected || !userAddress) return;

    setLoading(true);
    try {
      const data = await getProfileData(userAddress);
      const unverified = (data.passports as PassportRow[]).filter(
        (p) => p.status === "UNVERIFIED",
      );
      const message = buildVerificationMessage(unverified);

      let activeClient = client ?? getCachedXmtpClient();
      if (!activeClient) {
        activeClient = await ensureInitialized();
      }
      if (!activeClient) return;

      const dm = await openDmWithPeer(activeClient, verifierAddress);
      await dm.sendText(message);
      router.push(`/messages/${dm.id}`);
    } catch {
      // Silent failure — user stays on directory page.
    } finally {
      setLoading(false);
    }
  };

  const isBusy = loading || isInitializing;

  if (!isConnected) {
    return (
      <button
        type="button"
        disabled
        aria-label="Connect wallet to request verification"
        className={`${GHOST_BUTTON_CLASS} opacity-50 pointer-events-none`}
      >
        Request verification
      </button>
    );
  }

  if (isBusy) {
    return (
      <button
        type="button"
        disabled
        aria-busy="true"
        aria-label={`Request verification from ${verifierName}`}
        className={GHOST_BUTTON_CLASS}
      >
        <LoadingSpinner />
        Request verification
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void handleRequestVerification()}
      className={GHOST_BUTTON_CLASS}
      aria-label={`Request verification from ${verifierName}`}
    >
      <MessageSquare size={16} strokeWidth={1.5} aria-hidden />
      Request verification
    </button>
  );
}
