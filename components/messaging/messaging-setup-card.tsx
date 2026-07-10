"use client";

import { CommentIcon, SpinnerIcon } from "@/components/ui/icons";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

import { MessagingSetupError } from "@/components/messaging/messaging-setup-error";
import { Button } from "@/components/ui/button";
import { useMessagingActivation } from "@/hooks/use-messaging-activation";
import {
  canWalletEnableMessaging,
  messagingUnsupportedCopy,
  useMessagingStatus,
} from "@/hooks/use-messaging-status";
import { closeXmtpClient } from "@/hooks/use-xmtp-client";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { buildXmtpEoaSigner } from "@/lib/xmtp/client";
import {
  enableMessagingFull,
  enableMessagingFullError,
} from "@/lib/xmtp/enable-messaging-full";
import {
  resetLocalXmtpDatabase,
  revokeAllInstallations,
} from "@/lib/xmtp/reset-messaging-identity";
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
  const { status, error, createErrorKind, enableMessages, isReady, walletKind } =
    useMessagingStatus();
  const activation = useMessagingActivation();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const unsupported = messagingUnsupportedCopy(walletKind);
  const canEnable = canWalletEnableMessaging(walletKind);
  const copy = contextCopy(context);

  const runEnable = useCallback(async () => {
    if (!address || !walletClient) {
      setActionError("Wallet not ready. Try again.");
      return;
    }

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
  }, [
    activation,
    address,
    enableMessages,
    isReady,
    profile,
    refetch,
    walletClient,
  ]);

  const onEnable = async () => {
    if (!address || !walletClient) {
      setActionError("Wallet not ready. Try again.");
      return;
    }

    setActionError(null);
    setBusy(true);
    try {
      await runEnable();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not enable messages.");
    } finally {
      setBusy(false);
    }
  };

  const onResetIdentity = async () => {
    if (!address || busy) return;

    setActionError(null);
    setBusy(true);
    try {
      closeXmtpClient();
      await resetLocalXmtpDatabase(address);
      await runEnable();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not reset messaging identity.",
      );
    } finally {
      setBusy(false);
    }
  };

  const onRevokeAndRetry = async () => {
    if (!address || !walletClient || busy) return;

    setActionError(null);
    setBusy(true);
    try {
      const signer = buildXmtpEoaSigner(walletClient, address);
      await revokeAllInstallations(signer, address);
      closeXmtpClient();
      await resetLocalXmtpDatabase(address);
      await runEnable();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not free device slots.");
    } finally {
      setBusy(false);
    }
  };

  const errorPanel = (
    <MessagingSetupError
      actionError={actionError}
      storeError={error}
      createErrorKind={createErrorKind}
      showResetIdentity={status === "error" && createErrorKind !== "installation_limit"}
      busy={busy}
      onResetIdentity={() => void onResetIdentity()}
      onRevokeAndRetry={() => void onRevokeAndRetry()}
    />
  );

  const showErrorPanel =
    createErrorKind === "installation_limit" || Boolean(actionError || error);

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
        {showErrorPanel && errorPanel}
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
        {showErrorPanel && errorPanel}
      </div>
    );
  }

  if (status === "restore_required") {
    return (
      <div
        className={cn(
          "space-y-4 rounded-md border border-border-default bg-bg-surface p-4",
          className,
        )}
      >
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">Activate messages on this device</p>
          <p className="text-sm text-text-secondary">
            Your account already has messages enabled. One wallet signature activates them in this
            browser.
          </p>
        </div>
        <Button type="button" size="sm" disabled={busy} onClick={() => void onEnable()}>
          {busy ? "Activating…" : "Activate"}
        </Button>
        {actionError && (
          <p className="text-sm text-status-error" role="alert">
            {actionError}
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

      {showErrorPanel && errorPanel}
    </div>
  );
}
