"use client";

import { useCallback, useEffect, useState } from "react";

import { SpinnerIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { useNostrKey } from "@/hooks/use-nostr-key";

type CardPhase = "idle" | "busy" | "error";

export function IdentityRelinkCard() {
  const { identityMismatch, identityError, resolveIdentity, migrateIdentity } = useNostrKey();
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<CardPhase>("idle");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => setSuccessMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  const handleReconnect = useCallback(async () => {
    setPhase("busy");
    try {
      const ok = await resolveIdentity();
      if (ok) {
        setSuccessMessage("Profile reconnected.");
        return;
      }
      setPhase("idle");
    } catch {
      setPhase("error");
    }
  }, [resolveIdentity]);

  const handleMigrate = useCallback(async () => {
    setPhase("busy");
    try {
      const ok = await migrateIdentity();
      if (ok) {
        setSuccessMessage("Profile moved.");
        return;
      }
      setPhase("error");
    } catch {
      setPhase("error");
    }
  }, [migrateIdentity]);

  if (successMessage) {
    return (
      <p className="text-sm text-text-primary" role="status" aria-live="polite">
        {successMessage}
      </p>
    );
  }

  if (identityMismatch === false || dismissed) {
    return null;
  }

  const isPersistent = identityMismatch === "persistent";
  const busy = phase === "busy";

  return (
    <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
      <p className="font-sans text-sm text-text-primary">
        {isPersistent ? "Move your profile to a new key" : "Reconnect your profile"}
      </p>

      <p className="text-sm text-text-secondary">
        {isPersistent
          ? "Your wallet creates a new signature each time, so the original link to your profile can't be restored on this device. Kargain can safely copy your profile, watchlist, and notification settings to a new link. Your vehicle passports, listings, and funds are not affected."
          : "Your wallet signed in a slightly different way than before, so this device can't be matched to your saved profile and watchlist yet. Nothing is lost — your profile, watchlist, and settings are safe on the network. One more wallet signature usually fixes this."}
      </p>

      {isPersistent && (
        <p className="text-sm text-text-secondary">
          If you use Kargain on other devices, they may ask you to reconnect once.
        </p>
      )}

      {phase === "error" && (
        <div className="space-y-1" role="alert">
          <p className="text-sm text-status-error">
            Could not finish. Your data is unchanged — try again.
          </p>
          {identityError && (
            <p className="font-mono text-xs text-text-tertiary">{identityError}</p>
          )}
        </div>
      )}

      {busy && isPersistent ? (
        <p className="inline-flex items-center gap-2 text-sm text-text-secondary">
          <SpinnerIcon size={16} aria-hidden className="animate-spin" />
          Moving your profile…
        </p>
      ) : isPersistent ? (
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={busy}
            onClick={() => void handleMigrate()}
          >
            Move profile
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={busy}
            onClick={() => setDismissed(true)}
          >
            Not now
          </Button>
        </div>
      ) : (
        <>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => void handleReconnect()}
          >
            Reconnect profile
          </Button>
          <p className="font-mono text-xs text-text-tertiary">profile key mismatch</p>
        </>
      )}
    </div>
  );
}
