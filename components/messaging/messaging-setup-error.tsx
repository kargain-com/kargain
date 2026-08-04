"use client";

import { MessagingDevicesPanel } from "@/components/messaging/messaging-devices-panel";
import type { InstallationDisplay } from "@/lib/messaging/installation-display";
import type { SessionReason } from "@/lib/messaging/ports";

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

export type { InstallationDisplay };

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
  if (createErrorKind === "installation_limit") {
    const diagnostic =
      storeError && actionError && storeError !== actionError ? storeError : null;
    return (
      <MessagingDevicesPanel
        limitReached
        busy={busy}
        installations={installations}
        revokeAllOnCooldown={revokeAllOnCooldown}
        onFreeDeviceSlot={onFreeDeviceSlot}
        onRevokeAllDevices={onRevokeAllDevices}
        diagnostic={diagnostic}
      />
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
