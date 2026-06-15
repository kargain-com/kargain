"use client";

import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { getCachedXmtpClient, useXmtpClient } from "@/hooks/use-xmtp-client";
import { openDmWithPeer } from "@/lib/xmtp/open-dm";

type Props = {
  peerAddress: `0x${string}`;
  label: string;
  listingTokenId?: string | null;
};

export function SellerContactButton({ peerAddress, label, listingTokenId: _listingTokenId }: Props) {
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const { client, isInitializing, error, initialize } = useXmtpClient();
  const [busy, setBusy] = useState(false);
  const [enableOpen, setEnableOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (
    address &&
    peerAddress &&
    address.toLowerCase() === peerAddress.toLowerCase()
  ) {
    return null;
  }

  if (!isConnected) {
    return null;
  }

  const navigateToDm = async (activeClient: NonNullable<typeof client>) => {
    const conversation = await openDmWithPeer(activeClient, peerAddress);
    router.push(`/messages/${conversation.id}`);
  };

  const handleClick = async () => {
    setActionError(null);
    setBusy(true);
    try {
      const activeClient = client ?? getCachedXmtpClient();
      if (!activeClient) {
        setEnableOpen(true);
        return;
      }
      await navigateToDm(activeClient);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not open conversation.");
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = async () => {
    setActionError(null);
    setBusy(true);
    try {
      await initialize();
      const activeClient = getCachedXmtpClient();
      if (!activeClient) {
        throw new Error("Messaging could not be enabled.");
      }
      setEnableOpen(false);
      await navigateToDm(activeClient);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not enable messaging.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={busy || isInitializing}
        onClick={() => void handleClick()}
        aria-label={label}
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        {busy || isInitializing ? "Opening…" : label}
      </Button>

      <Dialog open={enableOpen} onOpenChange={setEnableOpen}>
        <DialogContent showClose>
          <DialogHeader>
            <DialogTitle>Enable messaging</DialogTitle>
            <DialogDescription>
              Enable messaging to contact this seller. You will be asked to sign a one-time message to set up
              encrypted XMTP chat.
            </DialogDescription>
          </DialogHeader>
          {(actionError || error) && (
            <p className="text-sm text-status-error" role="alert">
              {actionError ?? error}
            </p>
          )}
          <Button type="button" disabled={busy || isInitializing} onClick={() => void handleEnable()}>
            {busy || isInitializing ? "Enabling…" : "Enable"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
