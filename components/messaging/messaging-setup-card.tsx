"use client";

import { CommentIcon, SpinnerIcon } from "@/components/ui/icons";
import Link from "next/link";
import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

import { Button } from "@/components/ui/button";
import { useMessagingActivation } from "@/hooks/use-messaging-activation";
import {
  canWalletEnableMessaging,
  messagingUnsupportedCopy,
  useMessagingStatus,
} from "@/hooks/use-messaging-status";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import {
  enableMessagingFull,
  enableMessagingFullError,
} from "@/lib/xmtp/enable-messaging-full";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type SetupContext = "account" | "seller" | "karpro";

type Props = {
  variant?: "full" | "compact";
  context?: SetupContext;
  className?: string;
};

function contextCopy(context: SetupContext): { title: string; body: string } {
  switch (context) {
    case "seller":
      return {
        title: "Enable messages so buyers can reach you",
        body: "Your listing is visible, but buyers cannot send you encrypted messages until you finish this one-time setup.",
      };
    case "karpro":
      return {
        title: "Enable messages for verification requests",
        body: "Owners reach KarPro verifiers through encrypted messages. Turn them on so clients can contact you.",
      };
    default:
      return {
        title: "Enable messages to finish account setup",
        body: "Buyers, sellers, and verifiers use encrypted messages on Kargain. One wallet signature turns them on for your account.",
      };
  }
}

export function MessagingSetupCard({
  variant = "full",
  context = "account",
  className,
}: Props) {
  const { address } = useAccount();
  const chainId = wagmiChainId(DEFAULT_CHAIN_ID);
  const { data: walletClient } = useWalletClient({ chainId });
  const { profile, refetch } = useNostrProfile(address);
  const { status, error, enableMessages, isReady, walletKind } = useMessagingStatus();
  const activation = useMessagingActivation();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const unsupported = messagingUnsupportedCopy(walletKind);
  const canEnable = canWalletEnableMessaging(walletKind);
  const copy = contextCopy(context);

  const onEnable = async () => {
    if (!address || !walletClient) {
      setActionError("Wallet not ready. Try again.");
      return;
    }

    setActionError(null);
    setBusy(true);
    try {
      const result = await enableMessagingFull({
        enableMessages,
        address,
        walletClient,
        profile,
        xmtpAlreadyActive: isReady,
      });
      if (!result.ok) {
        setActionError(enableMessagingFullError(result.step, result.verifyDetail));
        return;
      }
      void refetch();
      activation.refetchNetwork();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not enable messages.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "disconnected") {
    return null;
  }

  if (status === "active") {
    return null;
  }

  if (status === "unsupported" || !canEnable) {
    return (
      <div
        className={cn(
          "rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary",
          className,
        )}
        role="status"
      >
        {unsupported ?? "This wallet cannot use encrypted messages."}
      </div>
    );
  }

  if (status === "disabled") {
    return (
      <div
        className={cn(
          "space-y-3 rounded-md border border-border-default bg-bg-surface p-4",
          className,
        )}
      >
        <p className="text-sm text-text-secondary">
          You turned off incoming messages. Turn them back on to receive buyer and verifier
          messages.
        </p>
        <Button type="button" size="sm" disabled={busy} onClick={() => void onEnable()}>
          {busy ? "Enabling…" : "Turn on messages"}
        </Button>
        {(actionError || error) && (
          <p className="text-sm text-status-error" role="alert">
            {actionError ?? error}
          </p>
        )}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        className={cn(
          "space-y-4 rounded-md border border-border-default bg-bg-surface p-4",
          className,
        )}
      >
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">
            Could not restore your messages on this device.
          </p>
          <p className="text-sm text-text-secondary">
            Your account is still registered for messages. Retry to restore local access on this
            browser.
          </p>
        </div>
        <Button type="button" size="sm" disabled={busy} onClick={() => void onEnable()}>
          {busy ? "Retrying…" : "Retry"}
        </Button>
        {(actionError || error) && (
          <p className="text-sm text-status-error" role="alert">
            {actionError ?? error}
          </p>
        )}
      </div>
    );
  }

  const isCompact = variant === "compact";

  return (
    <div
      className={cn(
        "space-y-4 rounded-md border border-border-default bg-bg-surface p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <CommentIcon size={20} className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">{copy.title}</p>
          <p className="text-sm text-text-secondary">{copy.body}</p>
        </div>
      </div>

      {status === "initializing" || busy ? (
        <p className="flex items-center gap-2 text-sm text-text-secondary" role="status">
          <SpinnerIcon className="h-4 w-4 animate-spin" aria-hidden />
          Confirm in your wallet…
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" onClick={() => void onEnable()}>
            Enable messages
          </Button>
          {!isCompact && (
            <Link href="/privacy" className="text-sm text-text-secondary link-underline">
              How messaging works
            </Link>
          )}
        </div>
      )}

      {(actionError || error) && (
        <p className="text-sm text-status-error" role="alert">
          {actionError ?? error}
        </p>
      )}
    </div>
  );
}
