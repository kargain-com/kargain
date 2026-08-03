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
import type { SessionReason } from "@/lib/messaging/ports";
import { MESSAGING_INSTALLATION_LIMIT } from "@/lib/messaging/ports";

export type InstallationDisplay = {
  count: number;
  currentInstallationId: string | null;
  rows: Array<{ id: string; ageLabel: string; isCurrent: boolean }>;
};

type Props = {
  actionError: string | null;
  storeError: string | null;
  createErrorKind: SessionReason | null;
  busy: boolean;
  installations: InstallationDisplay | null;
  revokeAllOnCooldown: boolean;
  onFreeDeviceSlot: () => void;
  onRevokeAllDevices: () => void;
};

export function MessagingSetupError({
  actionError,
  storeError,
  createErrorKind,
  busy,
  installations,
  revokeAllOnCooldown,
  onFreeDeviceSlot,
  onRevokeAllDevices,
}: Props) {
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);

  if (createErrorKind === "installation_limit") {
    const canFreeSlot = Boolean(installations?.currentInstallationId);

    return (
      <div className="space-y-3" role="alert">
        <p className="text-sm text-status-error">Message device limit reached.</p>
        <p className="text-sm text-text-secondary">
          {installations === null
            ? "Loading registered devices…"
            : (
              <>
                <span className="font-mono tabular-nums">
                  {installations.count} / {MESSAGING_INSTALLATION_LIMIT}
                </span>{" "}
                devices registered on this account.
              </>
            )}
        </p>
        {installations && installations.rows.length > 0 && (
          <ul className="space-y-1 font-mono text-xs text-text-tertiary tabular-nums">
            {installations.rows.map((row) => (
              <li key={row.id}>
                {row.id.slice(0, 8)}… · {row.ageLabel}
                {row.isCurrent ? " · this browser" : null}
              </li>
            ))}
          </ul>
        )}
        {!canFreeSlot && installations !== null && (
          <p className="text-sm text-text-secondary">
            This browser has no active messaging installation. Freeing a slot while keeping this
            device is unavailable — revoke all devices to continue.
          </p>
        )}
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            className="text-sm text-text-secondary link-underline disabled:opacity-50"
            disabled={busy || !canFreeSlot}
            onClick={() => void onFreeDeviceSlot()}
          >
            Free a device slot
          </button>
          <button
            type="button"
            className="text-sm text-status-error link-underline disabled:opacity-50"
            disabled={busy || revokeAllOnCooldown}
            onClick={() => setConfirmRevokeOpen(true)}
          >
            Revoke all devices
          </button>
        </div>
        {revokeAllOnCooldown && (
          <p className="text-sm text-text-secondary">
            Full device revoke was used recently. Wait before trying again — each revoke spends
            permanent inbox update budget.
          </p>
        )}
        {storeError && actionError && storeError !== actionError && (
          <p className="text-text-tertiary font-mono text-xs">{storeError}</p>
        )}

        <Dialog open={confirmRevokeOpen} onOpenChange={setConfirmRevokeOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Revoke all message devices?</DialogTitle>
              <DialogDescription>
                Every device loses access and must be reactivated with a wallet signature. You are
                undeliverable until reactivation finishes. Each full revoke permanently spends inbox
                update budget — it never resets.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmRevokeOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setConfirmRevokeOpen(false);
                  void onRevokeAllDevices();
                }}
              >
                Revoke all devices
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const primary = actionError ?? storeError;
  if (!primary) return null;

  return (
    <div className="space-y-2" role="alert">
      <p className="text-sm text-status-error">{primary}</p>
      {storeError && actionError && storeError !== actionError && (
        <p className="text-text-tertiary font-mono text-xs">{storeError}</p>
      )}
    </div>
  );
}
