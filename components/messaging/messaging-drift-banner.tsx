"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

import { Button } from "@/components/ui/button";
import { useMessagingActivation } from "@/hooks/use-messaging-activation";
import { useMessagingStatus } from "@/hooks/use-messaging-status";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import {
  enableMessagingFull,
  enableMessagingFullError,
} from "@/lib/xmtp/enable-messaging-full";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  className?: string;
};

export function MessagingDriftBanner({ className }: Props) {
  const { address } = useAccount();
  const chainId = wagmiChainId(DEFAULT_CHAIN_ID);
  const { data: walletClient } = useWalletClient({ chainId });
  const { profile, refetch } = useNostrProfile(address);
  const { enableMessages, isReady } = useMessagingStatus();
  const activation = useMessagingActivation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!address || activation.drift === "none") {
    return null;
  }

  const copy =
    activation.drift === "relay_opt_out"
      ? "Your profile shows private messages as off. Restore them so others can reach you."
      : "Messages are not registered on the network. Retry setup to stay reachable.";

  const onRepair = async () => {
    if (!walletClient || !address || busy) return;
    setError(null);
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
        setError(enableMessagingFullError(result.step, result.verifyDetail));
        return;
      }
      void refetch();
      activation.refetchNetwork();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={
        className ??
        "flex flex-col gap-3 rounded-md border border-border-default bg-bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
      }
      role="status"
    >
      <p className="text-sm text-text-secondary">{copy}</p>
      <Button type="button" size="sm" className="shrink-0" disabled={busy} onClick={() => void onRepair()}>
        {busy ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden />
            Restoring…
          </>
        ) : (
          "Restore private messages"
        )}
      </Button>
      {error && (
        <p className="text-sm text-status-error sm:basis-full" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
