"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletClient } from "wagmi";

import { LightningAddressField, isLightningAddressInvalid } from "@/components/profile/lightning-address-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { KAR_PRO_PAYMENTS_NETWORK_SCOPE } from "@/lib/kar-pro/membership-roster";
import type { PaymentMethodId } from "@/lib/nostr/payment-method-id";
import { publishNostrProfile } from "@/lib/nostr/profile";
import { acceptedPaymentMethods, paymentMethodIdsToArray } from "@/lib/verifier/payment-methods";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type KarProPaymentsSectionProps = {
  chainId: number;
  address: `0x${string}`;
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethodId, string> = {
  eth: "ETH",
  usdc: "USDC",
  lightning: "Lightning",
};

export function KarProPaymentsSection({ chainId, address }: KarProPaymentsSectionProps) {
  const wc = wagmiChainId(chainId);
  const { data: walletClient } = useWalletClient({ chainId: wc });

  const { profile: ownProfile, loading: ownProfileLoading, refetch: refetchProfile } = useNostrProfile(address);

  const resolvedMethods = useMemo(
    () => acceptedPaymentMethods(ownProfile),
    [ownProfile],
  );

  const [methodsDraft, setMethodsDraft] = useState<Set<PaymentMethodId>>(new Set(["eth", "usdc", "lightning"]));
  const [methodsInitialized, setMethodsInitialized] = useState(false);
  const [lud16Draft, setLud16Draft] = useState("");
  const [lud16Touched, setLud16Touched] = useState(false);
  const [lud16Editing, setLud16Editing] = useState(false);
  const [methodsSaving, setMethodsSaving] = useState(false);
  const [methodsSaved, setMethodsSaved] = useState(false);
  const [methodsError, setMethodsError] = useState<string | null>(null);

  useEffect(() => {
    if (methodsInitialized) return;
    setMethodsDraft(new Set(resolvedMethods));
    setLud16Draft(ownProfile?.lud16 ?? "");
    setMethodsInitialized(true);
  }, [methodsInitialized, resolvedMethods, ownProfile?.lud16]);

  const methodsDirty = useMemo(() => {
    if (!methodsInitialized) return false;
    const current = paymentMethodIdsToArray(resolvedMethods).join(",");
    const draft = paymentMethodIdsToArray(methodsDraft).join(",");
    const lud16Changed = (lud16Draft.trim() || "") !== (ownProfile?.lud16 ?? "");
    return current !== draft || lud16Changed;
  }, [methodsInitialized, resolvedMethods, methodsDraft, lud16Draft, ownProfile?.lud16]);

  const lightningEnabled = methodsDraft.has("lightning");
  const lud16Invalid =
    lightningEnabled && (lud16Draft.trim() === "" || isLightningAddressInvalid(lud16Draft));
  const onlyOneMethod = methodsDraft.size === 1;

  const toggleMethod = useCallback(
    (id: PaymentMethodId, checked: boolean) => {
      setMethodsDraft((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(id);
        } else if (next.size > 1) {
          next.delete(id);
        }
        return next;
      });
      setMethodsSaved(false);
    },
    [],
  );

  const onSaveMethods = async () => {
    if (!walletClient) {
      setMethodsError("Connect your wallet to save payment methods.");
      return;
    }
    if (lud16Invalid) {
      setLud16Touched(true);
      return;
    }

    setMethodsError(null);
    setMethodsSaved(false);
    setMethodsSaving(true);

    const methodsArray = paymentMethodIdsToArray(methodsDraft);
    const lud16Trimmed = lud16Draft.trim();
    const patch: {
      verifierPaymentMethods: PaymentMethodId[];
      lud16?: string;
    } = { verifierPaymentMethods: methodsArray };

    if (lightningEnabled) {
      patch.lud16 = lud16Trimmed;
    }

    try {
      const ok = await publishNostrProfile(patch, address, {
        signMessage: (msg) => walletClient.signMessage({ message: msg }),
      });
      if (!ok) {
        setMethodsError("Could not publish profile. Try again.");
        return;
      }
      refetchProfile();
      setMethodsSaved(true);
      setLud16Editing(false);
    } catch (err) {
      setMethodsError(err instanceof Error ? err.message : "Save failed. Try again.");
    } finally {
      setMethodsSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-border-default bg-bg-card p-6 md:p-8">
      <div className="space-y-4">
        <div>
          <p className={categoryLabel}>Accepted payment methods</p>
          <p className="mt-1 font-sans text-xs text-text-secondary">
            Owners see only the methods you enable when paying your verification fee.
          </p>
          <p className="mt-1 font-sans text-xs text-text-tertiary">
            {KAR_PRO_PAYMENTS_NETWORK_SCOPE}
          </p>
        </div>

        <div className="space-y-3">
          {(["eth", "usdc", "lightning"] as const).map((id) => (
            <div key={id} className="flex items-center justify-between gap-4">
              <Label htmlFor={`payment-method-${id}`} className="font-sans text-sm text-text-primary">
                {PAYMENT_METHOD_LABELS[id]}
              </Label>
              <Switch
                id={`payment-method-${id}`}
                checked={methodsDraft.has(id)}
                disabled={methodsSaving || (methodsDraft.has(id) && onlyOneMethod)}
                onCheckedChange={(checked) => toggleMethod(id, checked)}
              />
            </div>
          ))}
        </div>

        {onlyOneMethod && (
          <p className="font-sans text-xs text-text-secondary">
            At least one payment method must stay enabled.
          </p>
        )}

        {lightningEnabled && (
          <div className="space-y-3">
            {ownProfile?.lud16 && !lud16Editing ? (
              <div className="space-y-2">
                <p className="font-sans text-xs text-text-tertiary">Lightning address</p>
                <p className="font-mono text-sm text-text-primary">{ownProfile.lud16}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={methodsSaving}
                  onClick={() => {
                    setLud16Draft(ownProfile.lud16 ?? "");
                    setLud16Editing(true);
                  }}
                >
                  Edit address
                </Button>
              </div>
            ) : (
              <LightningAddressField
                id="kar-pro-lightning-address"
                value={lud16Draft}
                touched={lud16Touched}
                disabled={methodsSaving}
                onChange={(value) => {
                  setLud16Draft(value);
                  setMethodsSaved(false);
                }}
                onBlur={() => setLud16Touched(true)}
              />
            )}
            {lightningEnabled && lud16Draft.trim() === "" && lud16Touched && (
              <p role="alert" className="font-sans text-sm text-status-error">
                Add a Lightning address to accept Lightning payments.
              </p>
            )}
            <p className="font-sans text-xs text-text-secondary">
              Used for verification fee payments. Car sale payment details are set per listing.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={methodsSaving || !methodsDirty || lud16Invalid || ownProfileLoading}
            onClick={() => void onSaveMethods()}
          >
            {methodsSaving ? "Saving…" : "Save payment methods"}
          </Button>
          {methodsSaved && (
            <p className="font-sans text-sm text-text-secondary" role="status">
              Payment methods saved
            </p>
          )}
        </div>

        {methodsError && (
          <p role="alert" className="font-sans text-sm text-status-error">
            {methodsError}
          </p>
        )}
      </div>
    </div>
  );
}
