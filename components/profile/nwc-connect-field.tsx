"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type NwcConnectErrorCode,
  type NwcConnectResult,
} from "@/hooks/use-nwc-wallet";
import { wrongVmActionCopy } from "@/hooks/use-active-account";

function connectErrorMessage(code: NwcConnectErrorCode): string {
  switch (code) {
    case "invalid_uri":
      return "Invalid connection string.";
    case "unsupported":
      return "This wallet does not support invoice payments.";
    case "relay_unreachable":
      return "Could not reach your Lightning wallet.";
    case "sign_rejected":
      return "Signature declined.";
    case "storage_failed":
      return "Could not save connection on this device.";
    case "wallet_disconnected":
      return "Connect your wallet first.";
    case "wrong_vm":
      return wrongVmActionCopy("evm");
    default:
      return "Could not connect wallet.";
  }
}

type NwcConnectFieldProps = {
  onConnect: (uri: string) => Promise<NwcConnectResult>;
  disabled?: boolean;
  idPrefix?: string;
  submitLabel?: string;
  onConnected?: () => void;
};

export function NwcConnectField({
  onConnect,
  disabled = false,
  idPrefix = "nwc",
  submitLabel = "Connect",
  onConnected,
}: NwcConnectFieldProps) {
  const [uri, setUri] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleConnect = useCallback(async () => {
    if (pending || disabled) return;
    setError(null);
    setPending(true);
    const result = await onConnect(uri);
    setPending(false);
    if (!result.ok) {
      setError(connectErrorMessage(result.code));
      return;
    }
    setUri("");
    onConnected?.();
  }, [disabled, onConnect, onConnected, pending, uri]);

  return (
    <div className="space-y-2">
      <Label htmlFor={`${idPrefix}-uri`} className="sr-only">
        Lightning wallet connection string
      </Label>
      <Input
        id={`${idPrefix}-uri`}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={uri}
        disabled={disabled || pending}
        placeholder="Paste NWC connection string"
        className="font-mono text-xs"
        onChange={(e) => {
          setError(null);
          setUri(e.target.value);
        }}
      />
      {error && (
        <p className="font-sans text-xs text-status-error" role="alert">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || pending || uri.trim().length === 0}
        onClick={() => void handleConnect()}
      >
        {pending ? "Connecting…" : submitLabel}
      </Button>
    </div>
  );
}

export { connectErrorMessage as nwcConnectErrorMessage };
