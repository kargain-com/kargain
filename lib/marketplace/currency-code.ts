import { getAddress, type Hex } from "viem";

/** Decode ISO-style bytes32 currency code from MarketplaceEscrow events. */
export function decodeCurrencyCode(code: Hex | string): string {
  const hex = code.startsWith("0x") ? code.slice(2) : code;
  if (hex.length !== 64) return "";
  let out = "";
  for (let i = 0; i < 64; i += 2) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16);
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

/** Map v2 currencyCode to legacy v1 fiat enum for API/filter compat (0=USD, 1=EUR). */
export function legacyFiatFromCurrencyCode(code: string): 0 | 1 {
  return code.toUpperCase() === "EUR" ? 1 : 0;
}

/** Map v2 payToken to legacy payAsset enum (0=native, 1=USDC). */
export function payTokenToLegacyPayAsset(
  payToken: string,
  usdcAddress: string,
): 0 | 1 {
  if (!payToken || payToken === "0x0000000000000000000000000000000000000000") {
    return 0;
  }
  try {
    return getAddress(payToken) === getAddress(usdcAddress) ? 1 : 0;
  } catch {
    return 0;
  }
}
