"use client";

import { useMemo, type ReactNode } from "react";

import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import {
  monoLink,
  monoNumeric,
  serialLabel,
} from "@/lib/design/instrument-classes";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import type { PassportCustody } from "@/lib/marketplace/passport-custody";
import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import { formatMileage } from "@/lib/passport/format-mileage";
import type { PassportStatus } from "@/lib/types/ponder";

type Props = {
  listing?: {
    active: boolean;
    fiatPrice1e8: string;
    fiatCurrency: number;
  } | null;
  mileageKm?: number | null;
  status: PassportStatus;
  verifier: string;
  custody: PassportCustody;
};

type DataStripCell = {
  key: string;
  label: string;
  value: ReactNode;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function PassportDataStrip({
  listing,
  mileageKm,
  status,
  verifier,
  custody,
}: Props) {
  const { convertPrice } = useDisplayCurrency();

  const cells = useMemo<DataStripCell[]>(() => {
    const next: DataStripCell[] = [];

    if (listing?.active) {
      next.push({
        key: "price",
        label: "Price",
        value: (
          <p className={monoNumeric}>
            {convertPrice(
              BigInt(listing.fiatPrice1e8),
              normalizeListingFiatCurrency(listing.fiatCurrency),
            )}
          </p>
        ),
      });
    }

    if (typeof mileageKm === "number" && Number.isFinite(mileageKm)) {
      next.push({
        key: "mileage",
        label: "Mileage",
        value: <p className={monoNumeric}>{formatMileage(mileageKm)}</p>,
      });
    }

    const hasVerifier =
      status === "VERIFIED" &&
      verifier.trim() &&
      verifier !== ZERO_ADDRESS;
    if (hasVerifier) {
      next.push({
        key: "verifier",
        label: "Verifier",
        value: (
          <EnsWalletLink
            address={verifier}
            href={`/profile/${verifier}`}
            className={`${monoLink} text-fluid-sm tabular-nums text-text-primary`}
          />
        ),
      });
    }

    next.push({
      key: "custody",
      label: custody.isEscrowed ? "Seller" : "Owner",
      value: (
        <EnsWalletLink
          address={custody.profileAddress}
          href={`/profile/${custody.profileAddress}`}
          className={`${monoLink} text-fluid-sm tabular-nums text-text-primary`}
        />
      ),
    });

    return next;
  }, [convertPrice, custody, listing, mileageKm, status, verifier]);

  if (cells.length < 2) return null;

  return (
    <section
      className="flex flex-wrap gap-x-5 gap-y-3 border-y border-dashed border-border-default py-3.5 md:gap-x-8"
      aria-label="Passport quick data strip"
    >
      {cells.map((cell) => (
        <div key={cell.key}>
          <p className={serialLabel}>{cell.label}</p>
          <div className="mt-1">{cell.value}</div>
        </div>
      ))}
    </section>
  );
}
