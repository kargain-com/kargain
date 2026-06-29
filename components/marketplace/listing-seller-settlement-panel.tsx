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
  listingCurrencyCodesForChain,
  type ListingCurrencyCode,
} from "@/lib/marketplace/currency-code";

type Props = {
  chainId: number;
  priceInput: string;
  onPriceInputChange: (value: string) => void;
  askingCurrency: ListingCurrencyCode;
  onAskingCurrencyChange: (code: ListingCurrencyCode) => void;
  settlementNote: string;
  onSettlementNoteChange: (value: string) => void;
  priceInputId?: string;
  disabled?: boolean;
  /** When false, only the settlement explainer + note are shown. */
  showAskingFields?: boolean;
  /** When false, hide direct-payment instructions block. */
  showSettlementFields?: boolean;
};

export function ListingSellerSettlementPanel({
  chainId,
  priceInput,
  onPriceInputChange,
  askingCurrency,
  onAskingCurrencyChange,
  settlementNote,
  onSettlementNoteChange,
  priceInputId = "asking-price",
  disabled = false,
  showAskingFields = true,
  showSettlementFields = true,
}: Props) {
  const currencyOptions = listingCurrencyCodesForChain(chainId);

  return (
    <div className="space-y-4">
      {showAskingFields && (
        <>
          <div className="space-y-2">
            <Label htmlFor={priceInputId}>Asking price</Label>
            <Input
              id={priceInputId}
              inputMode="decimal"
              placeholder="42,000"
              value={priceInput}
              onChange={(e) => onPriceInputChange(e.target.value)}
              disabled={disabled}
              className="border-border-default bg-bg-surface"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${priceInputId}-currency`}>Currency</Label>
            <Select
              value={askingCurrency}
              onValueChange={(v) => onAskingCurrencyChange(v as ListingCurrencyCode)}
              disabled={disabled}
            >
              <SelectTrigger
                id={`${priceInputId}-currency`}
                className="border-border-default bg-bg-surface"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border-default bg-bg-primary">
                {currencyOptions.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {showSettlementFields && (
      <div className="space-y-3 rounded-sm border border-border-default bg-bg-primary/80 p-4">
        <p className="font-sans text-sm font-medium text-text-primary">How you can get paid</p>

        {showAskingFields && (
        <div className="space-y-1.5 border-b border-border-default pb-3">
          <p className="font-sans text-sm text-text-primary">On Kargain</p>
          <p className="font-sans text-xs text-text-secondary">
            Buyers pay in ETH or USDC. You receive crypto in your wallet after the sale.
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
