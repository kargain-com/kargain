/** On-chain fiat is stored with 8 decimals (Chainlink-style 1e8). */
export function formatFiat1e8(raw: string | bigint): string {
  const n = typeof raw === "bigint" ? raw : BigInt(raw);
  const neg = n < 0n;
  const v = neg ? -n : n;
  const whole = v / 100_000_000n;
  const frac = v % 100_000_000n;
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  const core = fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
  return neg ? `-${core}` : core;
}

export function fiatCurrencyLabel(currency: number): "USD" | "EUR" {
  return currency === 1 ? "EUR" : "USD";
}
