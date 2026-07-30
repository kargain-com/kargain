import { stringToHex } from "viem";

/** `Mandate.DenominationKind` — price denominated in the asset or in fiat. */
export const DENOMINATION_KIND = {
  Asset: 0,
  Fiat: 1,
} as const;

export type DenominationKind =
  (typeof DENOMINATION_KIND)[keyof typeof DENOMINATION_KIND];

/** `Mandate.CompensationForm` — agent keeps the margin, or takes commission. */
export const COMPENSATION_FORM = {
  Margin: 0,
  Commission: 1,
} as const;

export type CompensationForm =
  (typeof COMPENSATION_FORM)[keyof typeof COMPENSATION_FORM];

export type Denomination = {
  readonly kind: DenominationKind;
  readonly currencyCode: `0x${string}`;
};

export type Compensation = {
  readonly form: CompensationForm;
  readonly commissionBps: number;
};

/** `bytes32("USD")` — the only fiat code with a live feed today. */
export const CURRENCY_CODE_USD: `0x${string}` = encodeCurrencyCode("USD");

export const ZERO_CURRENCY_CODE: `0x${string}` = `0x${"0".repeat(64)}`;

export function encodeCurrencyCode(code: string): `0x${string}` {
  return stringToHex(code, { size: 32 });
}

/** `bytes32` → ASCII currency code; empty when unset or non-printable. */
export function decodeCurrencyCode(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("0x")) return "";
  let out = "";
  for (let i = 2; i + 1 < raw.length; i += 2) {
    const byte = Number.parseInt(raw.slice(i, i + 2), 16);
    if (!Number.isFinite(byte) || byte === 0) break;
    if (byte < 0x20 || byte > 0x7e) return "";
    out += String.fromCharCode(byte);
  }
  return out;
}

export function parseDenominationKind(
  raw: number | null | undefined,
): DenominationKind | null {
  if (raw === DENOMINATION_KIND.Asset) return DENOMINATION_KIND.Asset;
  if (raw === DENOMINATION_KIND.Fiat) return DENOMINATION_KIND.Fiat;
  return null;
}

export function parseCompensationForm(
  raw: number | null | undefined,
): CompensationForm | null {
  if (raw === COMPENSATION_FORM.Margin) return COMPENSATION_FORM.Margin;
  if (raw === COMPENSATION_FORM.Commission) return COMPENSATION_FORM.Commission;
  return null;
}

export function compensationFormLabel(form: CompensationForm): string {
  return form === COMPENSATION_FORM.Commission ? "Commission" : "Margin";
}

/** Asset-denominated prices carry the payment asset's decimals; fiat is 1e8. */
export const FIAT_PRICE_DECIMALS = 8;

export function denominationLabel(denomination: Denomination): string {
  if (denomination.kind === DENOMINATION_KIND.Fiat) {
    const code = decodeCurrencyCode(denomination.currencyCode);
    return code || "Fiat";
  }
  return "Asset";
}
