/**
 * Prompt-free estimate of wallet signatures needed to enable messaging.
 * Does not issue prompts — callers supply held-key / attestation facts.
 */

export type EnableWalletSignatureFacts = {
  /** Private key already in NostrKeyProvider memory. */
  keyHeld: boolean;
  /** Coverage + verifyProfileAttestationCore (cached after probe / successful publish). */
  attestationValid: boolean;
  /** XMTP createWithSigner still required (no local client). */
  needsCreate: boolean;
};

/**
 * Cold enable (no key, no attestation, need create) → unlock + attest + create.
 * Warm key held + attestation + create still needed → create only.
 */
export function deriveEnableWalletSignatures(facts: EnableWalletSignatureFacts): number {
  let n = 0;
  if (!facts.keyHeld) n += 1;
  if (!facts.attestationValid) n += 1;
  if (facts.needsCreate) n += 1;
  return n;
}

/** Setup-card body copy from the projected count (sentence case). */
export function enableWalletSignaturesCopy(count: number): string {
  if (count <= 1) {
    return "Turning on messages needs 1 wallet signature.";
  }
  return `Turning on messages needs ${count} wallet signatures.`;
}
