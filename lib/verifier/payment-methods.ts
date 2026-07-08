import type { PaymentMethodId } from "@/lib/nostr/payment-method-id";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { parseLud16 } from "@/lib/lightning/lud16";

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

export function showLightningChip(profile: NostrProfileData | null): boolean {
  return (
    acceptedPaymentMethods(profile).has("lightning") &&
    parseLud16(profile?.lud16 ?? "") != null
  );
}

const CHIP_ORDER: PaymentMethodId[] = ["eth", "usdc", "lightning"];

/** Public chip IDs in stable display order; mirrors pay-modal segment visibility. */
export function paymentMethodChipIds(
  profile: NostrProfileData | null,
): PaymentMethodId[] {
  const accepted = acceptedPaymentMethods(profile);
  return CHIP_ORDER.filter((id) => {
    if (id === "lightning") return showLightningChip(profile);
    return accepted.has(id);
  });
}
