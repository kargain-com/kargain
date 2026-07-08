"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

import { MessagingDriftBanner } from "@/components/messaging/messaging-drift-banner";
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
import { useMessagingActivation } from "@/hooks/use-messaging-activation";
import { cn } from "@/lib/utils";
import {
  canWalletEnableMessaging,
  messagingUnsupportedCopy,
  useMessagingStatus,
} from "@/hooks/use-messaging-status";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import {
  disableMessagingFull,
  disableMessagingError,
  enableMessagingFull,
  enableMessagingFullError,
} from "@/lib/xmtp/enable-messaging-full";
import { publishNostrProfile } from "@/lib/nostr/profile";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

function SectionEyebrow({ children }: { children: string }) {
  return (
    <p className={categoryLabel}>{children}</p>
  );
}

export function MessagingSettingsSection() {
  const { address } = useAccount();
  const chainId = wagmiChainId(DEFAULT_CHAIN_ID);
  const { data: walletClient } = useWalletClient({ chainId });
  const { profile, refetch } = useNostrProfile(address);
  const {
    status,
    isReady,
    isInitializing,
    enableMessages,
    disableMessages,
    walletKind,
  } = useMessagingStatus();
  const activation = useMessagingActivation();
  const [saving, setSaving] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);

  const unsupported = messagingUnsupportedCopy(walletKind);
  const canEnable = canWalletEnableMessaging(walletKind);

  const publishPreference = useCallback(
    async (messagesEnabled: boolean) => {
      if (!walletClient || !address) return false;
      return publishNostrProfile(
        { messagesEnabled },
        address,
        {
          signMessage: (msg) => walletClient.signMessage({ account: address, message: msg }),
        },
        { expectExisting: profile != null },
      );
    },
    [address, profile, walletClient],
  );

  const onEnable = async () => {
    if (!address || saving || !walletClient) {
      if (!walletClient) setToggleError("Wallet not ready. Try again.");
      return;
    }

    setToggleError(null);
    setSaving(true);
    try {
      const result = await enableMessagingFull({
        enableMessages,
        address,
        walletClient,
        profile,
        xmtpAlreadyActive: isReady,
      });
      if (!result.ok) {
        setToggleError(enableMessagingFullError(result.step, result.verifyDetail));
        return;
      }
      void refetch();
      activation.refetchNetwork();
    } finally {
      setSaving(false);
    }
  };

  const onConfirmDisable = async () => {
    if (!address || saving || !walletClient) return;

    setToggleError(null);
    setSaving(true);
    try {
      const result = await disableMessagingFull({
        address,
        walletClient,
        profile,
        publishPreference,
        disableMessages,
      });
      if (!result.ok) {
        setToggleError(disableMessagingError(result.step));
        return;
      }
      setConfirmDisableOpen(false);
      void refetch();
      activation.refetchNetwork();
    } finally {
      setSaving(false);
    }
  };

  const onTogglePrivateMessages = (next: boolean) => {
    if (saving) return;
    if (next) {
      void onEnable();
      return;
    }
    setConfirmDisableOpen(true);
  };

  if (!address) return null;

  if (status === "unsupported" || !canEnable) {
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
    saving || isInitializing || status === "initializing" || activation.networkChecking;
  const showSpinner = switchBusy;

  const helperCopy = activation.switchOn
    ? "Encrypted messages are active for your account."
    : activation.explicitlyOptedOut
      ? "You turned off private messages."
      : "Finish setup to activate private messages.";

  return (
    <section id="messages" className={cn("flex flex-col gap-4", sectionScrollAnchor)}>
      <SectionEyebrow>Messages</SectionEyebrow>

      <MessagingDriftBanner />

      <div className="flex items-center justify-between gap-4 rounded-md border border-border-default bg-bg-surface px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="private-messages" className="text-sm text-text-primary">
            Private messages
          </Label>
          <p className="text-sm text-text-secondary">{helperCopy}</p>
          {showSpinner && (
            <p className="flex items-center gap-2 text-sm text-text-secondary" role="status">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden />
              Confirm in your wallet…
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showSpinner && (
            <Loader2 className="h-4 w-4 animate-spin text-text-secondary" strokeWidth={1.5} aria-hidden />
          )}
          <Switch
            id="private-messages"
            checked={activation.switchOn}
            disabled={switchBusy || !activation.nostrLoaded}
            aria-busy={saving}
            onCheckedChange={onTogglePrivateMessages}
          />
        </div>
      </div>

      {toggleError && (
        <p className="text-sm text-status-error" role="alert">
          {toggleError}
        </p>
      )}

      {status === "error" && !toggleError && (
        <p className="text-sm text-status-error" role="alert">
          Could not enable messages. Try toggling private messages on again.
        </p>
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
              disabled={saving}
              onClick={() => void onConfirmDisable()}
            >
              {saving ? "Turning off…" : "Turn off messages"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={saving}
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
