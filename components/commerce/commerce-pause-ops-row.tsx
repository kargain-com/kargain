"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import { useTxSync } from "@/hooks/use-tx-sync";
import type { CommercePauseOpsRow } from "@/hooks/use-commerce-pause-ops";
import { commerceModeAbi } from "@/lib/commerce/mode";
import {
  pauseConfirmCopy,
  UNPAUSE_HINT,
} from "@/lib/commerce/pause-surface";
import {
  instrumentReadoutPanel,
  monoLinkSm,
  serialLabel,
} from "@/lib/design/instrument-classes";
import { requireCommercialActive } from "@/lib/web3/commercial-active";
import { explorerAddressUrl } from "@/lib/web3/network-explorer";
import { cn } from "@/lib/utils";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";

type Props = {
  row: CommercePauseOpsRow;
  onPaused: () => void;
};

export function CommercePauseOpsRowCard({ row, onPaused }: Props) {
  const { runTx, busy, error, syncLagged } = useTxSync(row.chainId);
  const { writeContractAsync } = useEvmWriteContract();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const confirm = pauseConfirmCopy({
    mode: row.mode,
    chainLabel: row.chainLabel,
  });

  const statusLabel =
    row.paused === true ? "Paused" : row.paused === false ? "Running" : "Unknown";

  async function onConfirmPause() {
    const ok = await runTx(() =>
      writeContractAsync({
        address: row.address,
        abi: commerceModeAbi(row.mode),
        functionName: "pause",
        chainId: row.chainId,
      }),
    );
    if (ok) {
      setConfirmOpen(false);
      onPaused();
    }
  }

  return (
    <section className={cn(instrumentReadoutPanel, "flex flex-col gap-4")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className={serialLabel}>
            {row.modeLabel} · {row.chainLabel}
          </p>
          <p className="font-mono text-sm tabular-nums text-text-primary">
            {statusLabel}
          </p>
        </div>
        {row.control.canPause ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            Pause
          </Button>
        ) : null}
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-text-secondary">Guardian</dt>
          <dd>
            {row.guardian ? (
              <EnsWalletLink
                address={row.guardian}
                className={monoLinkSm}
                externalHref={explorerAddressUrl(requireCommercialActive(row.chainId), row.guardian)}
              />
            ) : (
              <span className="font-mono text-xs text-text-secondary">—</span>
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-text-secondary">Owner (timelock)</dt>
          <dd>
            {row.owner ? (
              <EnsWalletLink
                address={row.owner}
                className={monoLinkSm}
                externalHref={explorerAddressUrl(requireCommercialActive(row.chainId), row.owner)}
              />
            ) : (
              <span className="font-mono text-xs text-text-secondary">—</span>
            )}
          </dd>
        </div>
      </dl>

      {row.control.showUnpauseHint ? (
        <p className="text-sm text-text-secondary">{UNPAUSE_HINT}</p>
      ) : null}

      {error ? (
        <p className="text-sm text-status-error" role="alert">
          {error}
        </p>
      ) : null}
      {syncLagged ? (
        <p className="text-sm text-text-secondary">
          Transaction confirmed; indexer may still be catching up.
        </p>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent showClose className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm.title}</DialogTitle>
            <DialogDescription className="text-sm text-text-secondary">
              {confirm.body}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-row justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void onConfirmPause()}
            >
              {busy ? "Confirming…" : "Pause now"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
