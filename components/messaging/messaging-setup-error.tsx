"use client";

import type { SessionReason } from "@/lib/messaging/ports";

type Props = {
  actionError: string | null;
  storeError: string | null;
  createErrorKind: SessionReason | null;
  showResetIdentity?: boolean;
  busy: boolean;
  onResetIdentity: () => void;
  onRevokeAndRetry: () => void;
};

export function MessagingSetupError({
  actionError,
  storeError,
  createErrorKind,
  showResetIdentity = false,
  busy,
  onResetIdentity,
  onRevokeAndRetry,
}: Props) {
  if (createErrorKind === "installation_limit") {
    return (
      <div className="space-y-2" role="alert">
        <p className="text-sm text-status-error">Message device limit reached.</p>
        {storeError && actionError && storeError !== actionError && (
          <p className="text-text-tertiary font-mono text-xs">{storeError}</p>
        )}
        <button
          type="button"
          className="text-sm text-text-secondary link-underline disabled:opacity-50"
          disabled={busy}
          onClick={() => void onRevokeAndRetry()}
        >
          Free device slots and retry
        </button>
        <p className="text-sm text-text-secondary">
          Messages on your other devices will need one-time reactivation.
        </p>
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
      {showResetIdentity && (
        <>
          <button
            type="button"
            className="text-sm text-text-secondary link-underline disabled:opacity-50"
            disabled={busy}
            onClick={() => void onResetIdentity()}
          >
            Reset messaging identity
          </button>
          <p className="text-sm text-text-secondary">
            Message history on this device will be re-downloaded from the network.
          </p>
        </>
      )}
    </div>
  );
}
