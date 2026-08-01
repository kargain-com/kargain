"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  DENOMINATION_KIND,
  type DenominationKind,
} from "@/lib/commerce/denomination";
import type { OpenableTerms } from "@/lib/commerce/openable-terms";

type Props = {
  openOptions: OpenableTerms;
  openOptionsPending?: boolean;
  settlementAsset: string;
  onSettlementAssetChange: (token: string) => void;
  denominationKind: DenominationKind;
  onDenominationKindChange: (kind: DenominationKind) => void;
  priceInput: string;
  onPriceInputChange: (value: string) => void;
  askingCurrency: string;
  onAskingCurrencyChange: (code: string) => void;
  settlementNote: string;
  onSettlementNoteChange: (value: string) => void;
  priceInputId?: string;
  disabled?: boolean;
  /** When false, only the settlement explainer + note are shown. */
  showAskingFields?: boolean;
  /** Asset / denomination / currency — hide when re-pricing an open lot. */
  showOpenPairingFields?: boolean;
  /** When false, hide direct-payment instructions block. */
  showSettlementFields?: boolean;
};

export function ListingSellerSettlementPanel({
  openOptions,
  openOptionsPending = false,
  settlementAsset,
  onSettlementAssetChange,
  denominationKind,
  onDenominationKindChange,
  priceInput,
  onPriceInputChange,
  askingCurrency,
  onAskingCurrencyChange,
  settlementNote,
  onSettlementNoteChange,
  priceInputId = "asking-price",
  disabled = false,
  showAskingFields = true,
  showOpenPairingFields = true,
  showSettlementFields = true,
}: Props) {
  const selectedAsset = openOptions.assets.find(
    (a) => a.token.toLowerCase() === settlementAsset.toLowerCase(),
  );
  const fiatAllowed = selectedAsset?.fiatDenomination === true;
  const fiatReason = selectedAsset?.fiatUnavailableReason;
  const showFiatControls =
    denominationKind === DENOMINATION_KIND.Fiat && fiatAllowed;

  return (
    <div className="space-y-4">
      {showAskingFields && (
        <>
          {showOpenPairingFields && (
            <>
              {!openOptions.available && !openOptionsPending ? (
                <p className="font-sans text-sm text-text-secondary" role="status">
                  {openOptions.unavailableReason}
                </p>
              ) : null}

              {openOptions.available || openOptionsPending ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor={`${priceInputId}-asset`}>Settlement asset</Label>
                    <Select
                      value={settlementAsset}
                      onValueChange={onSettlementAssetChange}
                      disabled={disabled || openOptionsPending || openOptions.assets.length === 0}
                    >
                      <SelectTrigger
                        id={`${priceInputId}-asset`}
                        className="border-border-default bg-bg-surface"
                      >
                        <SelectValue
                          placeholder={
                            openOptionsPending ? "Loading…" : "Select asset"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent className="border-border-default bg-bg-primary">
                        {openOptions.assets.map((asset) => (
                          <SelectItem key={asset.token} value={asset.token}>
                            {asset.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {openOptions.available && openOptions.assets.length === 0 ? (
                      <p className="font-sans text-xs text-text-secondary" role="status">
                        No settlement assets are available for fixed-price opens on
                        this chain.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`${priceInputId}-denomination`}>Price denomination</Label>
                    <Select
                      value={String(denominationKind)}
                      onValueChange={(v) =>
                        onDenominationKindChange(
                          Number(v) === DENOMINATION_KIND.Asset
                            ? DENOMINATION_KIND.Asset
                            : DENOMINATION_KIND.Fiat,
                        )
                      }
                      disabled={disabled || openOptionsPending || !selectedAsset}
                    >
                      <SelectTrigger
                        id={`${priceInputId}-denomination`}
                        className="border-border-default bg-bg-surface"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-border-default bg-bg-primary">
                        <SelectItem value={String(DENOMINATION_KIND.Asset)}>
                          Asset units
                        </SelectItem>
                        <SelectItem
                          value={String(DENOMINATION_KIND.Fiat)}
                          disabled={!fiatAllowed}
                        >
                          Fiat
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {!fiatAllowed && fiatReason ? (
                      <p className="font-sans text-xs text-text-secondary" role="status">
                        {fiatReason}
                      </p>
                    ) : null}
                  </div>

                  {showFiatControls ? (
                    <div className="space-y-2">
                      <Label htmlFor={`${priceInputId}-currency`}>Currency</Label>
                      {openOptions.fiatCurrencyCodes.length === 0 ? (
                        <p
                          className="font-sans text-sm text-text-secondary"
                          role="status"
                        >
                          No fiat listing currencies are registered for this mode
                          on this chain.
                        </p>
                      ) : (
                        <Select
                          value={askingCurrency}
                          onValueChange={onAskingCurrencyChange}
                          disabled={disabled || openOptionsPending}
                        >
                          <SelectTrigger
                            id={`${priceInputId}-currency`}
                            className="border-border-default bg-bg-surface"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="border-border-default bg-bg-primary">
                            {openOptions.fiatCurrencyCodes.map((code) => (
                              <SelectItem key={code} value={code}>
                                {code}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor={priceInputId}>Asking price</Label>
            <Input
              id={priceInputId}
              inputMode="decimal"
              placeholder={
                denominationKind === DENOMINATION_KIND.Asset ? "1.5" : "42,000"
              }
              value={priceInput}
              onChange={(e) => onPriceInputChange(e.target.value)}
              disabled={disabled}
              className="border-border-default bg-bg-surface"
            />
          </div>
        </>
      )}

      {showSettlementFields && (
      <div className="space-y-3 rounded-md border border-border-default bg-bg-primary/80 p-4">
        <p className="font-sans text-sm font-medium text-text-primary">How you can get paid</p>

        {showAskingFields && (
        <div className="space-y-1.5 border-b border-border-default pb-3">
          <p className="font-sans text-sm text-text-primary">On Kargain</p>
          <p className="font-sans text-xs text-text-secondary">
            Buyers pay in the settlement asset of the listing. You receive it in your
            wallet after the sale.
          </p>
        </div>
        )}

        <div className="space-y-2">
          <p className="font-sans text-sm text-text-primary">Direct with buyer (optional)</p>
          <p className="font-sans text-xs text-text-secondary">
            Bank transfer, BTC, or other terms the buyer pays you outside Kargain.
          </p>
          <Label htmlFor={`${priceInputId}-settlement`} className="sr-only">
            Direct payment instructions
          </Label>
          <Textarea
            id={`${priceInputId}-settlement`}
            value={settlementNote}
            onChange={(e) => onSettlementNoteChange(e.target.value)}
            placeholder="e.g. Bank IBAN, BTC address, or payment instructions for the buyer"
            rows={3}
            disabled={disabled}
            className="border-border-default bg-bg-surface"
          />
        </div>
      </div>
      )}
    </div>
  );
}
