import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decryptPrivateKeyV1,
  decryptPrivateKeyV2,
  deriveNostrSkFromSignature,
  encryptPrivateKeyV1,
  encryptPrivateKeyV2,
  isV2Blob,
  nostrLinkMessage,
  skMatchesSignature,
  type StoredEncryptedV1,
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

  it("roundtrips v1 blob encryption with address-derived AES", async () => {
    const sk = deriveNostrSkFromSignature(SIGNATURE_A);
    const blob = await encryptPrivateKeyV1(ADDRESS_LOWER, sk);
    const restored = await decryptPrivateKeyV1(ADDRESS_LOWER, blob);
    assert.equal(restored, sk);
    assert.equal(isV2Blob(blob), false);
  });

  it("roundtrips v2 blob encryption with signature-derived AES", async () => {
    const sk = deriveNostrSkFromSignature(SIGNATURE_A);
    const blob = await encryptPrivateKeyV2(SIGNATURE_A, ADDRESS_LOWER, sk);
    const restored = await decryptPrivateKeyV2(SIGNATURE_A, blob);
    assert.equal(restored, sk);
    assert.equal(isV2Blob(blob), true);
  });

  it("does not decrypt v1 ciphertext with v2 AES key", async () => {
    const sk = deriveNostrSkFromSignature(SIGNATURE_A);
    const v1 = await encryptPrivateKeyV1(ADDRESS_LOWER, sk);
    await assert.rejects(async () => {
      await decryptPrivateKeyV2(SIGNATURE_A, {
        version: 2,
        address: ADDRESS_LOWER,
        ivHex: v1.ivHex,
        cipherHex: v1.cipherHex,
        createdAt: v1.createdAt,
      });
    });
  });

  it("migrates v1 blob to v2 without changing nostr sk", async () => {
    const sk = deriveNostrSkFromSignature(SIGNATURE_A);
    const v1: StoredEncryptedV1 = await encryptPrivateKeyV1(ADDRESS_LOWER, sk);
    const fromV1 = await decryptPrivateKeyV1(ADDRESS_LOWER, v1);
    assert.equal(fromV1, sk);

    const v2: StoredEncryptedV2 = await encryptPrivateKeyV2(SIGNATURE_A, ADDRESS_LOWER, fromV1);
    const fromV2 = await decryptPrivateKeyV2(SIGNATURE_A, v2);
    assert.equal(fromV2, sk);
    assert.ok(skMatchesSignature(fromV2, SIGNATURE_A));
  });

  it("detects v2 blobs by version field", () => {
    const v1: StoredEncryptedV1 = {
      address: ADDRESS_LOWER,
      ivHex: "0x01",
      cipherHex: "0x02",
      createdAt: 1,
    };
    const v2: StoredEncryptedV2 = {
      version: 2,
      address: ADDRESS_LOWER,
      ivHex: "0x01",
      cipherHex: "0x02",
      createdAt: 1,
    };
    assert.equal(isV2Blob(v1), false);
    assert.equal(isV2Blob(v2), true);
  });
});
