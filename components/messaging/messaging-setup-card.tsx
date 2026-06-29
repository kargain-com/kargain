"use client";

import { CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  canWalletEnableMessaging,
  messagingUnsupportedCopy,
  useMessagingStatus,
} from "@/hooks/use-messaging-status";
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
  const { status, error, enableMessages, walletKind } = useMessagingStatus();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const unsupported = messagingUnsupportedCopy(walletKind);
  const canEnable = canWalletEnableMessaging(walletKind);
  const copy = contextCopy(context);

  const onEnable = async () => {
    setActionError(null);
    setBusy(true);
    try {
      const ok = await enableMessages();
      if (!ok) {
        setActionError("Could not enable messages. Try again.");
      }
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
    if (variant === "compact") {
      return (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border border-border-default bg-bg-surface px-4 py-3 text-sm text-text-secondary",
            className,
          )}
          role="status"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-warm" aria-hidden />
          Messages enabled
        </div>
      );
    }
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

  const isCompact = variant === "compact";

  return (
    <div
      className={cn(
        "space-y-4 rounded-md border border-border-default bg-bg-surface",
        isCompact ? "p-4" : "p-6",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">{copy.title}</p>
          <p className="text-sm text-text-secondary">{copy.body}</p>
        </div>
      </div>

      {status === "initializing" || busy ? (
        <p className="flex items-center gap-2 text-sm text-text-secondary" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
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

      {(actionError || (status === "error" && error)) && (
        <p className="text-sm text-status-error" role="alert">
          {actionError ?? error}
        </p>
      )}
    </div>
  );
}
