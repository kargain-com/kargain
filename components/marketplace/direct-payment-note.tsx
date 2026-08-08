"use client";

import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { QrCode } from "@/components/ui/qr-code";
import { useMarketRatesRequest } from "@/hooks/use-market-rates-request";
import {
  DENOMINATION_KIND,
  type DenominationKind,
} from "@/lib/commerce/denomination";
import { deriveListingAskingPrice } from "@/lib/commerce/listing-price-display";
import { instrumentReadoutPanel } from "@/lib/design/instrument-classes";
import {
  detectPaymentIdentifiers,
  LIGHTNING_ADVISORY_USD_1E8,
  paymentIdentifierUri,
  type PaymentIdentifier,
} from "@/lib/lightning/payment-identifiers";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import { pickPartialFxRates } from "@/lib/marketplace/fx-rate-registry";
import {
  listingToUsd1e8,
  normalizeListingFiatCurrency,
} from "@/lib/marketplace/price-normalize";

type DirectPaymentNoteProps = {
  note: string;
  chainId: number;
  price: string | bigint;
  denominationKind: DenominationKind;
  asset?: string | null;
  currencyCode?: string | null;
  fiatCurrency: number;
  erc20Decimals?: number | null;
};

function kindLabel(kind: PaymentIdentifier["kind"]): string {
  switch (kind) {
    case "bolt12":
      return "Lightning offer";
    case "bolt11":
      return "Lightning invoice";
    case "lud16":
      return "Lightning address";
    case "btc-address":
      return "Bitcoin address";
  }
}

function IdentifierBlock({ id }: { id: PaymentIdentifier }) {
  const [copyDone, setCopyDone] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(id.value);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 2000);
    } catch {
      setCopyDone(false);
    }
  }, [id.value]);

  return (
    <div className={`${instrumentReadoutPanel} space-y-3`}>
      <p className="font-sans text-xs text-text-secondary">{kindLabel(id.kind)}</p>
      <p className="break-all font-mono text-xs text-text-primary">{id.value}</p>
      <QrCode
        value={paymentIdentifierUri(id)}
        size={144}
        ariaLabel={`${kindLabel(id.kind)} QR code`}
      />
      <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopy()}>
        {copyDone ? "Copied" : "Copy"}
      </Button>
      {id.kind === "bolt11" && (
        <p className="font-sans text-xs text-text-secondary">
          Lightning invoices expire. Ask the seller for a fresh invoice before paying.
        </p>
      )}
    </div>
  );
}

export function DirectPaymentNote({
  note,
  chainId,
  price,
  denominationKind,
  asset,
  currencyCode,
  fiatCurrency,
  erc20Decimals,
}: DirectPaymentNoteProps) {
  const identifiers = useMemo(() => detectPaymentIdentifiers(note), [note]);
  const hasLightningIdentifier = identifiers.some((id) => id.kind !== "btc-address");

  useMarketRatesRequest(hasLightningIdentifier);

  const displayRates = useDisplayCurrency();
  const rates = useMemo(() => pickPartialFxRates(displayRates), [displayRates]);

  const asking = useMemo(
    () =>
      deriveListingAskingPrice({
        denominationKind,
        price,
        currencyCode,
        asset,
        chainId,
        erc20Decimals,
      }),
    [denominationKind, price, currencyCode, asset, chainId, erc20Decimals],
  );

  const listingUsd1e8 = useMemo(() => {
    // Asset lots have no fiat USD without inventing FX — skip advisory threshold.
    if (asking.status !== "fiat") return null;
    if (denominationKind !== DENOMINATION_KIND.Fiat) return null;
    return listingToUsd1e8(
      asking.amount1e8,
      normalizeListingFiatCurrency(fiatCurrency),
      rates,
    );
  }, [asking, denominationKind, fiatCurrency, rates]);

  const showLargeAmountAdvisory =
    hasLightningIdentifier &&
    listingUsd1e8 != null &&
    listingUsd1e8 > LIGHTNING_ADVISORY_USD_1E8;

  return (
    <div className="space-y-2 rounded-md border border-border-default bg-bg-surface p-4">
      <p className="font-sans text-sm font-medium text-text-primary">Direct payment</p>

      {identifiers.length > 0 && (
        <div className="space-y-3">
          {identifiers.map((id) => (
            <IdentifierBlock key={`${id.kind}:${id.value}`} id={id} />
          ))}
          {showLargeAmountAdvisory && (
            <p className="font-sans text-xs text-text-secondary">
              Large amounts often fail on Lightning. For this price, prefer the seller&apos;s
              Bitcoin address or another agreed method.
            </p>
          )}
        </div>
      )}

      <p className="font-sans text-xs text-text-secondary whitespace-pre-wrap">{note}</p>
      <p className="font-sans text-xs text-text-tertiary">
        Arrange payment with the seller. Not verified by Kargain.
      </p>
    </div>
  );
}
