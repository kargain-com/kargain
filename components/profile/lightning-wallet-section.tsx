"use client";

import { useCallback, useState } from "react";

import { NwcConnectField } from "@/components/profile/nwc-connect-field";
import { EvmSessionRefusal } from "@/components/shell/evm-session-refusal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";
import { useNwcWallet } from "@/hooks/use-nwc-wallet";

function SectionEyebrow({ children }: { children: string }) {
  return <p className={categoryLabel}>{children}</p>;
}

export function LightningWalletSection() {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const { present, connect, disconnect } = useNwcWallet();
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await disconnect();
    } finally {
      setDisconnecting(false);
    }
  }, [disconnect]);

  return (
    <section className="flex flex-col gap-4">
      <SectionEyebrow>Lightning wallet</SectionEyebrow>
      <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="font-sans text-sm text-text-secondary">
          Connect a NWC-compatible wallet for one-click Lightning payments on Kargain. Your
          connection string stays on this device, encrypted. Only payment requests you approve
          within your wallet&apos;s limits are possible. Paste from a NWC-compatible wallet (Alby
          Hub, Coinos, etc.).
        </p>

        {!evm.ok ? (
          <EvmSessionRefusal
            cause={evm.cause}
            disconnectedTitle="Connect your wallet first."
          />
        ) : present ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-sans text-sm text-text-primary">Wallet connected</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConfirmDisconnectOpen(true)}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <NwcConnectField idPrefix="profile-nwc" onConnect={connect} />
        )}
      </div>

      <Dialog open={confirmDisconnectOpen} onOpenChange={setConfirmDisconnectOpen}>
        <DialogContent showClose className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect Lightning wallet?</DialogTitle>
            <DialogDescription>
              One-click Lightning payments will be removed from this device. You can reconnect
              anytime.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={disconnecting}
              onClick={() => setConfirmDisconnectOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={disconnecting}
              onClick={() => void handleDisconnect()}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
