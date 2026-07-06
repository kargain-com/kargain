import type { PaymentMethodId } from "@/lib/nostr/payment-method-id";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";

const ALL_PAYMENT_METHODS: PaymentMethodId[] = ["eth", "usdc", "lightning"];

/** Resolved accepted methods for a verifier profile; absent field = all three. */
export function acceptedPaymentMethods(
  profile: NostrProfileData | null,
): Set<PaymentMethodId> {
  const methods = profile?.verifierPaymentMethods;
  if (!methods || methods.length === 0) {
    return new Set(ALL_PAYMENT_METHODS);
  }
  return new Set(methods);
}

export function paymentMethodIdsToArray(set: Set<PaymentMethodId>): PaymentMethodId[] {
  return ALL_PAYMENT_METHODS.filter((id) => set.has(id));
}
