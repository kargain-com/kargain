"use client";

import { CommentIcon, SpinnerIcon } from "@/components/ui/icons";
import Link from "next/link";
import { useEffect, useState } from "react";

import { MessagingSetupError, type InstallationDisplay } from "@/components/messaging/messaging-setup-error";
import { Button } from "@/components/ui/button";
import { useMessagingSession } from "@/hooks/use-messaging-session";
import { useRequestLocalMessagingClient } from "@/hooks/use-request-local-messaging-client";
import type { InstallationReadout, SessionSnapshot } from "@/lib/messaging/ports";
import {
  canWalletEnableMessaging,
  enableWalletSignaturesCopy,
  isUserOpInFlight,
  messagingUnsupportedCopy,
  primaryActionFromSnapshot,
  SECONDARY_REVOKE_ALL_COMMAND,
} from "@/lib/messaging/snapshot-ui";
import { cn } from "@/lib/utils";

type SetupContext = "account" | "seller" | "karpro";

type Props = {
  variant?: "full" | "compact";
  context?: SetupContext;
  className?: string;
};

function contextCopy(
  context: SetupContext,
  enableWalletSignatures: number | undefined,
): { title: string; body: string } {
  const signatureSentence =
    enableWalletSignatures != null
      ? ` ${enableWalletSignaturesCopy(enableWalletSignatures)}`
      : "";
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
        body: `Buyers, sellers, and verifiers use encrypted messages on Kargain.${signatureSentence}`,
      };
  }
}

function errorBody(reason: string): { title: string; body: string } {
  if (reason === "opfs_lock") {
    return {
      title: "Messages are open in another place",
      body: "Messages are already open in another Kargain tab or window on this device. Close it here to continue in this browser.",
    };
  }
  if (reason === "timeout") {
    return {
      title: "Messaging setup timed out",
      body: "The setup step did not finish in time. Try again when you are ready.",
    };
  }
  return {
    title: "Could not restore your messages on this device",
    body: "Local access on this browser could not be restored. Use the action below to continue.",
  };
}

function formatInstallationAge(createdAtMs: number | null, nowMs: number): string {
  if (createdAtMs === null) return "age unknown";
  const ageMs = Math.max(0, nowMs - createdAtMs);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}

function toInstallationDisplay(readout: InstallationReadout, nowMs: number): InstallationDisplay {
  return {
    count: readout.installations.length,
    currentInstallationId: readout.currentInstallationId,
    rows: readout.installations.map((installation) => ({
      id: installation.id,
      ageLabel: formatInstallationAge(installation.createdAtMs, nowMs),
      isCurrent: installation.id === readout.currentInstallationId,
    })),
  };
}

function isActionableActive(snapshot: SessionSnapshot): boolean {
  return (
    snapshot.state === "active" &&
    (snapshot.next === "retry" ||
      snapshot.publishError === "publish_failed" ||
      snapshot.publishPending === true)
  );
}

export function MessagingSetupCard({
  variant = "full",
  context = "account",
  className,
}: Props) {
  const { snapshot, dispatch, session } = useMessagingSession();
  useRequestLocalMessagingClient(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [installations, setInstallations] = useState<InstallationDisplay | null>(null);

  const unsupported = messagingUnsupportedCopy(snapshot);
  const canEnable = canWalletEnableMessaging(snapshot);
  const primary = primaryActionFromSnapshot(snapshot);
  const enableWalletSignatures =
    snapshot.state === "disabled" || snapshot.state === "needs_signature"
      ? snapshot.enableWalletSignatures
      : undefined;
  const copy = contextCopy(context, enableWalletSignatures);
  const userOpBusy = isUserOpInFlight(snapshot);
  const ctaDisabled =
    snapshot.state === "unsupported" ||
    snapshot.state === "disconnected" ||
    userOpBusy ||
    (snapshot.state === "active" && !isActionableActive(snapshot));

  const createErrorKind =
    snapshot.state === "error"
      ? snapshot.reason
      : snapshot.state === "needs_signature" && snapshot.reason === "installation_limit"
        ? snapshot.reason
        : null;

  const storeError =
    snapshot.state === "error" && snapshot.reason !== "opfs_lock"
      ? errorBody(snapshot.reason).body
      : snapshot.state === "needs_signature" && snapshot.reason === "opfs_lock"
        ? errorBody("opfs_lock").body
        : null;

  const showErrorPanel =
    createErrorKind === "installation_limit" || Boolean(actionError || storeError);

  const atInstallationLimit = createErrorKind === "installation_limit";

  useEffect(() => {
    if (!atInstallationLimit || !session) return;
    let cancelled = false;
    void session.readInstallations().then((readout) => {
      if (cancelled) return;
      setInstallations(toInstallationDisplay(readout, Date.now()));
    });
    return () => {
      cancelled = true;
    };
  }, [atInstallationLimit, session, snapshot]);

  const revokeAllOnCooldown = session?.isRevokeAllOnCooldown() ?? false;

  const errorPanel = (
    <MessagingSetupError
      actionError={actionError}
      storeError={storeError}
      createErrorKind={createErrorKind}
      busy={userOpBusy}
      installations={installations}
      revokeAllOnCooldown={revokeAllOnCooldown}
      onFreeDeviceSlot={() => {
        const action = primaryActionFromSnapshot(snapshot);
        if (action) dispatch(action.command);
      }}
      onRevokeAllDevices={() => dispatch(SECONDARY_REVOKE_ALL_COMMAND)}
    />
  );

  const ctaRow = () => {
    if (!primary) return null;
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={ctaDisabled}
          onClick={() => {
            setActionError(null);
            dispatch(primary.command);
          }}
        >
          {primary.label}
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
  };

  if (snapshot.state === "disconnected") {
    return null;
  }

  if (snapshot.state === "active" && !isActionableActive(snapshot)) {
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

  if (atInstallationLimit) {
    return (
      <div
        className={cn(
          "space-y-4 rounded-md border border-border-default bg-bg-surface p-4",
          className,
        )}
      >
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">Device limit reached</p>
          <p className="text-sm text-text-secondary">
            Free a slot on an existing device, or revoke every device and reactivate this browser.
          </p>
        </div>
        {errorPanel}
      </div>
    );
  }

  if (snapshot.state === "error" && snapshot.reason === "opfs_lock") {
    const body = errorBody("opfs_lock");
    return (
      <div
        className={cn(
          "space-y-4 rounded-md border border-border-default bg-bg-surface p-4",
          className,
        )}
        role="status"
      >
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">{body.title}</p>
          <p className="text-sm text-text-secondary">{body.body}</p>
        </div>
        {ctaRow()}
      </div>
    );
  }

  if (isActionableActive(snapshot)) {
    return (
      <div
        className={cn(
          "space-y-3 rounded-md border border-border-default bg-bg-surface p-4",
          className,
        )}
      >
        <p className="text-sm text-text-secondary">
          Your message preference could not be published yet. Retry without creating a new device
          installation.
        </p>
        {ctaRow()}
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
        {ctaRow()}
        {showErrorPanel && errorPanel}
      </div>
    );
  }

  if (snapshot.state === "error") {
    const body = errorBody(snapshot.reason);
    return (
      <div
        className={cn(
          "space-y-4 rounded-md border border-border-default bg-bg-surface p-4",
          className,
        )}
      >
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">{body.title}</p>
          <p className="text-sm text-text-secondary">{body.body}</p>
        </div>
        {ctaRow()}
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
            Finish activation on this browser to open your encrypted inbox here.
          </p>
        </div>
        {ctaRow()}
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

      {ctaRow()}

      {showErrorPanel && errorPanel}
    </div>
  );
}
