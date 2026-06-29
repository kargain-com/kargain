"use client";

import { useCallback, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

import { MessagingSetupCard } from "@/components/messaging/messaging-setup-card";
import { Label } from "@/components/ui/label";
import { useMessagingStatus } from "@/hooks/use-messaging-status";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { publishNostrProfile } from "@/lib/nostr/profile";

function SectionEyebrow({ children }: { children: string }) {
  return (
    <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent-warm">{children}</p>
  );
}

export function MessagingSettingsSection() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { profile, refetch } = useNostrProfile(address);
  const { status, isReady, enableMessages, disableMessages } = useMessagingStatus();
  const [saving, setSaving] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const allowIncoming = profile?.messagesEnabled !== false;

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

  const onToggleAllowIncoming = async (next: boolean) => {
    if (!address || saving) return;
    setToggleError(null);
    setSaving(true);
    try {
      if (next) {
        const enabled = await enableMessages();
        if (!enabled) {
          setToggleError("Could not enable messages. Try again.");
          return;
        }
        const ok = await publishPreference(true);
        if (!ok) setToggleError("Could not save your preference.");
        else void refetch();
        return;
      }

      disableMessages();
      const ok = await publishPreference(false);
      if (!ok) setToggleError("Could not save your preference.");
      else void refetch();
    } finally {
      setSaving(false);
    }
  };

  if (!address) return null;

  return (
    <section id="messages" className="flex flex-col gap-4 scroll-mt-24">
      <SectionEyebrow>Messages</SectionEyebrow>

      <MessagingSetupCard variant="compact" context="account" />

      {isReady && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-border-default bg-bg-surface px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="allow-incoming-messages" className="text-sm text-text-primary">
              Allow incoming messages
            </Label>
            <p className="text-sm text-text-secondary">
              When off, others cannot start new conversations with you on Kargain.
            </p>
          </div>
          <input
            id="allow-incoming-messages"
            type="checkbox"
            className="size-4 shrink-0 accent-accent-warm"
            checked={allowIncoming && status !== "disabled"}
            disabled={saving || status === "unsupported"}
            onChange={(e) => void onToggleAllowIncoming(e.target.checked)}
          />
        </div>
      )}

      {toggleError && (
        <p className="text-sm text-status-error" role="alert">
          {toggleError}
        </p>
      )}
    </section>
  );
}
