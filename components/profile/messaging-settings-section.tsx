"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { publishNostrProfile } from "@/lib/nostr/profile";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

function SectionEyebrow({ children }: { children: string }) {
  return (
    <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent-warm">{children}</p>
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
  const [saving, setSaving] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const allowIncoming = profile?.messagesEnabled !== false;
  const messagingOn = isReady && allowIncoming && status !== "disabled";
  const unsupported = messagingUnsupportedCopy(walletKind);
  const canEnable = canWalletEnableMessaging(walletKind);

  const publishPreference = useCallback(
    async (messagesEnabled: boolean) => {
      if (!walletClient || !address) return false;
      return publishNostrProfile(
        {
          name: profile?.name,
          about: profile?.about,
          picture: profile?.picture,
          website: profile?.website,
          messagesEnabled,
        },
        address,
        {
          signMessage: (msg) => walletClient.signMessage({ message: msg }),
        },
      );
    },
    [address, profile?.about, profile?.name, profile?.picture, profile?.website, walletClient],
  );

  const onTogglePrivateMessages = async (next: boolean) => {
    if (!address || saving) return;

    if (!walletClient) {
      setToggleError("Wallet not ready. Try again.");
      return;
    }

    setToggleError(null);
    setSaving(true);
    try {
      if (next) {
        const result = await enableMessagingFull({
          enableMessages,
          address,
          walletClient,
          profile,
          xmtpAlreadyActive: isReady,
        });
        if (!result.ok) {
          setToggleError(enableMessagingFullError(result.step));
          return;
        }
        void refetch();
        return;
      }

      disableMessages();
      const ok = await publishPreference(false);
      if (!ok) setToggleError("Could not save your messaging preference.");
      else void refetch();
    } finally {
      setSaving(false);
    }
  };

  if (!address) return null;

  if (status === "unsupported" || !canEnable) {
    return (
      <section id="messages" className="flex flex-col gap-4 scroll-mt-24">
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

  const switchDisabled = saving || isInitializing || status === "initializing";
  const showSpinner = saving || isInitializing || status === "initializing";

  return (
    <section id="messages" className="flex flex-col gap-4 scroll-mt-24">
      <SectionEyebrow>Messages</SectionEyebrow>

      <div className="flex items-center justify-between gap-4 rounded-md border border-border-default bg-bg-surface px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="private-messages" className="text-sm text-text-primary">
            Private messages
          </Label>
          <p className="text-sm text-text-secondary">
            {messagingOn
              ? "Buyers, sellers, and verifiers can reach you through encrypted messages."
              : "One wallet signature turns on encrypted messages for your account."}
          </p>
          {showSpinner && (
            <p className="flex items-center gap-2 text-sm text-text-secondary" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Confirm in your wallet…
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showSpinner && (
            <Loader2 className="h-4 w-4 animate-spin text-text-secondary" aria-hidden />
          )}
          <Switch
            id="private-messages"
            checked={messagingOn}
            disabled={switchDisabled}
            aria-busy={saving}
            onCheckedChange={(checked) => void onTogglePrivateMessages(checked)}
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
    </section>
  );
}
