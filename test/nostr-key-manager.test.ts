import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decryptPrivateKeyV2,
  deriveNostrSkFromSignature,
  encryptPrivateKeyV2,
  isIdentityBlob,
  nostrLinkMessage,
  skMatchesSignature,
  type StoredEncryptedV2,
} from "../lib/nostr/key-manager-crypto.ts";

const ADDRESS = "0xAbC12345678901234567890123456789012345678" as `0x${string}`;
const ADDRESS_LOWER = "0xabc12345678901234567890123456789012345678" as `0x${string}`;
const SIGNATURE_A =
  "0x1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111" as `0x${string}`;
const SIGNATURE_B =
  "0x2222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222" as `0x${string}`;

describe("nostr key-manager crypto", () => {
  it("builds a domain-free canonical link message", () => {
    assert.equal(
      nostrLinkMessage(ADDRESS),
      "kargain-nostr-v1:0xabc12345678901234567890123456789012345678",
    );
  });

  it("derives a stable nostr sk from signature", () => {
    const sk1 = deriveNostrSkFromSignature(SIGNATURE_A);
    const sk2 = deriveNostrSkFromSignature(SIGNATURE_A);
    assert.equal(sk1, sk2);
    assert.match(sk1, /^0x[0-9a-f]{64}$/);
  });

  it("derives different sk values for different signatures", () => {
    const skA = deriveNostrSkFromSignature(SIGNATURE_A);
    const skB = deriveNostrSkFromSignature(SIGNATURE_B);
    assert.notEqual(skA, skB);
  });

  it("roundtrips identity blob encryption with signature-derived AES", async () => {
    const sk = deriveNostrSkFromSignature(SIGNATURE_A);
    const blob = await encryptPrivateKeyV2(SIGNATURE_A, ADDRESS_LOWER, sk);
    const restored = await decryptPrivateKeyV2(SIGNATURE_A, blob);
    assert.equal(restored, sk);
    assert.equal(isIdentityBlob(blob), true);
    assert.ok(skMatchesSignature(restored, SIGNATURE_A));
  });

  it("rejects decrypt with a different signature", async () => {
    const sk = deriveNostrSkFromSignature(SIGNATURE_A);
    const blob = await encryptPrivateKeyV2(SIGNATURE_A, ADDRESS_LOWER, sk);
    await assert.rejects(async () => {
      await decryptPrivateKeyV2(SIGNATURE_B, blob);
    });
  });

  it("isIdentityBlob requires version 2 shape", () => {
    const v2: StoredEncryptedV2 = {
      version: 2,
      address: ADDRESS_LOWER,
      ivHex: "0x01",
      cipherHex: "0x02",
      createdAt: 1,
    };
    assert.equal(isIdentityBlob(v2), true);
    assert.equal(isIdentityBlob({ address: ADDRESS_LOWER, ivHex: "0x01", cipherHex: "0x02" }), false);
    assert.equal(isIdentityBlob(null), false);
  });
});
