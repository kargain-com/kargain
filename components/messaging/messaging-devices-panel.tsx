"use client";

/**
 * Sole messaging device chrome — count / ages / Free / Revoke+confirm.
 * Settings (management home) and setup-error (installation_limit) compose this.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { InstallationDisplay } from "@/lib/messaging/installation-display";
import { MESSAGING_INSTALLATION_LIMIT } from "@/lib/messaging/ports";

type Props = {
  /** When true, leads with the limit-reached error line (setup recovery). */
  limitReached?: boolean;
  busy: boolean;
  installations: InstallationDisplay | null;
  revokeAllOnCooldown: boolean;
  onFreeDeviceSlot: () => void;
  onRevokeAllDevices: () => void;
  /** Optional secondary diagnostic under the panel (setup only). */
  diagnostic?: string | null;
};

export function MessagingDevicesPanel({
  limitReached = false,
  busy,
  installations,
  revokeAllOnCooldown,
  onFreeDeviceSlot,
  onRevokeAllDevices,
  diagnostic = null,
}: Props) {
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);
  const canFreeSlot = Boolean(installations?.currentInstallationId);

  return (
    <div className="space-y-3" role={limitReached ? "alert" : "region"} aria-label="Message devices">
      {limitReached && (
        <p className="text-sm text-status-error">Message device limit reached.</p>
      )}
      <p className="text-sm text-text-secondary">
        {installations === null ? (
          "Loading registered devices…"
        ) : (
          <>
            <span className="font-mono text-text-primary tabular-nums">
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
          Not available on this browser — no installation to keep. Revoke all devices to continue on
          this device.
        </p>
      )}
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          className="text-sm text-text-secondary link-underline disabled:opacity-50"
          disabled={busy || !canFreeSlot}
          onClick={() => void onFreeDeviceSlot()}
        >
          {canFreeSlot
            ? "Free a device slot"
            : "Free a device slot (needs this browser's installation)"}
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
      {diagnostic ? (
        <p className="text-text-tertiary font-mono text-xs">{diagnostic}</p>
      ) : null}

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
