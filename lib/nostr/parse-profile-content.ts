import {
  normalizeVerifierPaymentMethods,
  type PaymentMethodId,
} from "@/lib/nostr/payment-method-id";
import {
  parseProfileAttestationField,
  type ProfileAttestationV1,
} from "@/lib/nostr/profile-attestation";

export type { PaymentMethodId };
export type { ProfileAttestationV1 };

export type NostrProfileData = {
  name?: string;
  about?: string;
  picture?: string;
  website?: string;
  /** Lightning address (LUD-16), e.g. name@domain. */
  lud16?: string;
  /** When explicitly false, the user is not accepting direct messages. */
  messagesEnabled?: boolean;
  /** Accepted off-chain payment methods for verification fees. Absent = all accepted. */
  verifierPaymentMethods?: PaymentMethodId[];
  /** Wallet-signed binding of nostr pubkey to ethereum address (NS-1). */
  attestation?: ProfileAttestationV1;
};

export function parseProfileContent(content: string): NostrProfileData | null {
  if (!content.trim()) return {};
  try {
    const raw: unknown = JSON.parse(content);
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
    const obj = raw as Record<string, unknown>;
    const result: NostrProfileData = {};
    if (typeof obj.name === "string") result.name = obj.name;
    if (typeof obj.about === "string") result.about = obj.about;
    if (typeof obj.picture === "string") result.picture = obj.picture;
    if (typeof obj.website === "string") result.website = obj.website;
    if (typeof obj.lud16 === "string") {
      const lud16 = obj.lud16.trim();
      if (lud16) result.lud16 = lud16;
    }
    if (obj.messagesEnabled === false) result.messagesEnabled = false;
    else if (obj.messagesEnabled === true) result.messagesEnabled = true;

    const methods = normalizeVerifierPaymentMethods(obj.verifierPaymentMethods);
    if (methods) result.verifierPaymentMethods = methods;

    const attestation = parseProfileAttestationField(obj.attestation);
    if (attestation) result.attestation = attestation;

    return result;
  } catch {
    return {};
  }
}
