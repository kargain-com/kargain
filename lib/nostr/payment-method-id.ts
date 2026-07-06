export type PaymentMethodId = "eth" | "usdc" | "lightning";

const KNOWN_PAYMENT_METHODS: readonly PaymentMethodId[] = [
  "eth",
  "usdc",
  "lightning",
] as const;

const KNOWN_SET = new Set<string>(KNOWN_PAYMENT_METHODS);

export function isPaymentMethodId(value: string): value is PaymentMethodId {
  return KNOWN_SET.has(value);
}

/** Parse and dedupe a kind 0 verifierPaymentMethods array; empty/invalid → null. */
export function normalizeVerifierPaymentMethods(raw: unknown): PaymentMethodId[] | null {
  if (!Array.isArray(raw)) return null;

  const seen = new Set<PaymentMethodId>();
  const result: PaymentMethodId[] = [];

  for (const item of raw) {
    if (typeof item !== "string" || !isPaymentMethodId(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }

  return result.length > 0 ? result : null;
}
