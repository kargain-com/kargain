"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { MessageIcon } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getProfileData } from "@/app/actions/marketplace-listings";
import { formatPassportTitle } from "@/lib/passport/passport-token-id";
import { useMessagingSession } from "@/hooks/use-messaging-session";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { usePeerMessagingReachability } from "@/hooks/use-peer-messaging-reachability";
import { VerificationFeeDisplay } from "@/components/verifier/verification-fee-display";
import { ContactPeerError, contactPeer } from "@/lib/messaging/contact-peer";
import { setComposeDraft } from "@/lib/messaging/compose-draft";
import { awaitActiveSnapshot, needsMessagingSetupCard } from "@/lib/messaging/snapshot-ui";

type Props = {
  verifierAddress: `0x${string}`;
  verifierName: string;
  verificationFee?: bigint;
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

export function VerificationRequestButton({
  verifierAddress,
  verifierName,
  verificationFee,
}: Props) {
  const { account, signingBinding } = useActiveAccount();
  const evm = requireEvmSession(account);
  const userAddress = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const connector = signingBinding.ok ? signingBinding.connector : undefined;
  const { session, dispatch } = useMessagingSession();
  const needsMessagingSetup = needsMessagingSetupCard(
    session?.getSnapshot() ?? { state: "disconnected" },
  );
  const { profile: verifierProfile } = useNostrProfile(verifierAddress);
  const { reachable, message, isLoading: reachabilityLoading } =
    usePeerMessagingReachability(verifierAddress);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (
    isConnected &&
    userAddress &&
    userAddress.toLowerCase() === verifierAddress.toLowerCase()
  ) {
    return null;
  }

  const handleRequestVerification = async () => {
    if (!isConnected || !userAddress) return;

    setActionError(null);
    setLoading(true);
    session?.requestLocalClient();
    try {
      const data = await getProfileData(userAddress);
      const unverified = (data.passports as PassportRow[]).filter(
        (p) => p.status === "UNVERIFIED",
      );
      const messageText = buildVerificationMessage(unverified);

      if (needsMessagingSetup) {
        dispatch({ type: "enable" });
      }

      if (!session) {
        setActionError("Enable messages in your profile to send a request.");
        return;
      }
      await awaitActiveSnapshot(session);

      const activeClient = session.getXmtpClient();
      if (!activeClient) {
        setActionError("Enable messages in your profile to send a request.");
        return;
      }

      const provider = await connector?.getProvider?.();
      const dm = await contactPeer({
        client: activeClient,
        ensureReady: async () => session.getXmtpClient(),
        peerAddress: verifierAddress,
        nostrProfile: verifierProfile,
        provider,
      });
      setComposeDraft(dm.id, messageText);
      router.push(`/messages/${dm.id}`);
    } catch (e) {
      setActionError(
        e instanceof ContactPeerError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not open conversation.",
      );
    } finally {
      session?.releaseLocalClient();
      setLoading(false);
    }
  };

  const isBusy = loading;

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

  if (!reachabilityLoading && !reachable) {
    return (
      <p className="text-sm text-text-secondary" role="status">
        {message ?? "Messages not available"}
      </p>
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
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void handleRequestVerification()}
        className={GHOST_BUTTON_CLASS}
        aria-label={`Request verification from ${verifierName}`}
      >
        <MessageIcon size={16} aria-hidden />
        Request verification
      </button>
      {verificationFee != null && verificationFee > 0n && (
        <VerificationFeeDisplay
          feeWei={verificationFee}
          primaryClassName="font-mono text-xs text-text-secondary tabular-nums"
        />
      )}
      {actionError && (
        <p className="text-sm text-status-error" role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}
