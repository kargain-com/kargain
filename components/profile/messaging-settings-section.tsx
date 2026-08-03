"use client";

import { SpinnerIcon } from "@/components/ui/icons";
import { useState } from "react";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { categoryLabel, sectionScrollAnchor } from "@/lib/design/instrument-classes";
import { useMessagingSession } from "@/hooks/use-messaging-session";
import {
  canWalletEnableMessaging,
  isUserOpInFlight,
  messagingUnsupportedCopy,
  primaryActionFromSnapshot,
} from "@/lib/messaging/snapshot-ui";
import { cn } from "@/lib/utils";

function SectionEyebrow({ children }: { children: string }) {
  return <p className={categoryLabel}>{children}</p>;
}

export function MessagingSettingsSection() {
  const { address } = useAccount();
  const { snapshot, dispatch } = useMessagingSession();
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);

  const unsupported = messagingUnsupportedCopy(snapshot);
  const canEnable = canWalletEnableMessaging(snapshot);
  const userOpBusy = isUserOpInFlight(snapshot);

  const switchOn =
    snapshot.state === "active" && snapshot.publiclyReachable === true;

  const helperCopy = (() => {
    if (snapshot.state === "needs_signature") {
      return "Confirm one signature to activate messages on this device.";
    }
    if (snapshot.state === "active" && snapshot.publishError) {
      return "Could not update your message preference on the relay. Retry below.";
    }
    if (switchOn) {
      return "Encrypted messages are active for your account.";
    }
    if (snapshot.state === "disabled" && snapshot.intent === "explicit") {
      return "You turned off private messages.";
    }
    return "Finish setup to activate private messages.";
  })();

  const onTogglePrivateMessages = (next: boolean) => {
    if (userOpBusy) return;
    if (next) {
      dispatch({ type: "enable" });
      return;
    }
    setConfirmDisableOpen(true);
  };

  if (!address) return null;

  if (snapshot.state === "unsupported" || !canEnable) {
    return (
      <section id="messages" className={cn("flex flex-col gap-4", sectionScrollAnchor)}>
        <SectionEyebrow>Messages</SectionEyebrow>
        <div
          className="rounded-md border border-border-default bg-bg-surface px-4 py-3 text-sm text-text-secondary"
          role="status"
        >
          {unsupported ?? "This wallet cannot use encrypted messages."}
        </div>
      </section>
    );
  }

  const switchBusy =
    userOpBusy ||
    (snapshot.state === "reconciling" && snapshot.op !== "intent");

  const publishRetryAction =
    snapshot.state === "active" &&
    (snapshot.publishError || snapshot.next === "retry")
      ? primaryActionFromSnapshot(snapshot)
      : null;
  const showPublishRetry =
    publishRetryAction != null && publishRetryAction.command.type === "retry";

  return (
    <section id="messages" className={cn("flex flex-col gap-4", sectionScrollAnchor)}>
      <SectionEyebrow>Messages</SectionEyebrow>

      <div className="flex items-center justify-between gap-4 rounded-md border border-border-default bg-bg-surface px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="private-messages" className="text-sm text-text-primary">
            Private messages
          </Label>
          <p className="text-sm text-text-secondary">{helperCopy}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {switchBusy && (
            <SpinnerIcon className="h-4 w-4 animate-spin text-text-secondary" aria-hidden />
          )}
          <Switch
            id="private-messages"
            checked={switchOn}
            disabled={switchBusy || snapshot.state === "reconciling"}
            aria-busy={switchBusy}
            onCheckedChange={onTogglePrivateMessages}
          />
        </div>
      </div>

      {showPublishRetry && publishRetryAction && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-default bg-bg-surface px-4 py-3">
          <p className="text-sm text-status-error" role="alert">
            Could not publish your message preference. Retry without signing again.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={userOpBusy}
            onClick={() => dispatch(publishRetryAction.command)}
          >
            {publishRetryAction.label}
          </Button>
        </div>
      )}

      <Dialog open={confirmDisableOpen} onOpenChange={setConfirmDisableOpen}>
        <DialogContent showClose className="max-w-md">
          <DialogHeader>
            <DialogTitle>Turn off private messages?</DialogTitle>
            <DialogDescription>
              Others will not be able to start new conversations with you on Kargain. You can turn
              them back on anytime from profile settings.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={userOpBusy}
              onClick={() => {
                dispatch({ type: "disable" });
                setConfirmDisableOpen(false);
              }}
            >
              Turn off messages
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={userOpBusy}
              onClick={() => setConfirmDisableOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
