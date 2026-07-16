"use client";

import { CommentIcon, SpinnerIcon } from "@/components/ui/icons";
import Link from "next/link";
import { useState } from "react";

import { MessagingSetupError } from "@/components/messaging/messaging-setup-error";
import { Button } from "@/components/ui/button";
import { useMessagingSession } from "@/hooks/use-messaging-session";
import {
  canWalletEnableMessaging,
  isUserOpInFlight,
  messagingUnsupportedCopy,
} from "@/lib/messaging/snapshot-ui";
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

function errorCopy(reason: string): string {
  if (reason === "opfs_lock") {
    return "Messages are already open in another Kargain tab. Close it and retry.";
  }
  if (reason === "timeout") {
    return "Messaging setup timed out. Try again.";
  }
  return "Could not restore your messages on this device.";
}

export function MessagingSetupCard({
  variant = "full",
  context = "account",
  className,
}: Props) {
  const { snapshot, dispatch } = useMessagingSession();
  const [actionError, setActionError] = useState<string | null>(null);

  const unsupported = messagingUnsupportedCopy(snapshot);
  const canEnable = canWalletEnableMessaging(snapshot);
  const copy = contextCopy(context);
  const userOpBusy = isUserOpInFlight(snapshot);
  const ctaDisabled =
    snapshot.state === "active" ||
    snapshot.state === "unsupported" ||
    snapshot.state === "disconnected" ||
    userOpBusy;

  const createErrorKind =
    snapshot.state === "error"
      ? snapshot.reason
      : snapshot.state === "needs_signature" && snapshot.reason === "installation_limit"
        ? snapshot.reason
        : null;

  const storeError =
    snapshot.state === "error"
      ? errorCopy(snapshot.reason)
      : snapshot.state === "needs_signature" && snapshot.reason === "opfs_lock"
        ? errorCopy(snapshot.reason)
        : null;

  const showErrorPanel =
    createErrorKind === "installation_limit" || Boolean(actionError || storeError);

  const errorPanel = (
    <MessagingSetupError
      actionError={actionError}
      storeError={storeError}
      createErrorKind={createErrorKind}
      showResetIdentity={
        snapshot.state === "error" && snapshot.reason !== "installation_limit"
      }
      busy={userOpBusy}
      onResetIdentity={() => dispatch({ type: "resetIdentity" })}
      onRevokeAndRetry={() => dispatch({ type: "resetIdentity" })}
    />
  );

  const ctaRow = (label: string, onClick: () => void) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" disabled={ctaDisabled} onClick={onClick}>
        {label}
      </Button>
      {userOpBusy && (
        <SpinnerIcon className="h-4 w-4 animate-spin text-text-secondary" aria-hidden />
      )}
      {variant === "full" && context === "account" && (
        <Link href="/privacy" className="text-sm text-text-secondary link-underline">
          How messaging works
        </Link>
      )}
    </div>
  );

  if (snapshot.state === "disconnected" || snapshot.state === "active") {
    return null;
  }

  if (snapshot.state === "unsupported" || !canEnable) {
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

  if (snapshot.state === "disabled" && snapshot.intent === "explicit") {
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
        {ctaRow("Turn on messages", () => {
          setActionError(null);
          dispatch({ type: "enable" });
        })}
        {showErrorPanel && errorPanel}
      </div>
    );
  }

  if (snapshot.state === "error") {
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
        {ctaRow("Retry", () => {
          setActionError(null);
          dispatch({ type: "retry" });
        })}
        {showErrorPanel && errorPanel}
      </div>
    );
  }

  if (snapshot.state === "needs_signature") {
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
        {ctaRow("Activate", () => {
          setActionError(null);
          dispatch({ type: "enable" });
        })}
        {actionError && (
          <p className="text-sm text-status-error" role="alert">
            {actionError}
          </p>
        )}
        {showErrorPanel && errorPanel}
      </div>
    );
  }

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

      {ctaRow("Enable messages", () => {
        setActionError(null);
        dispatch({ type: "enable" });
      })}

      {showErrorPanel && errorPanel}
    </div>
  );
}
