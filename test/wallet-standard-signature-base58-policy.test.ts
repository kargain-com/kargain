/**
 * Wallet Standard signature bytes → base58: sole owner behavioural proof.
 * Pins the HEAD Irys failure class (`"undefined"` from fractional base58 size).
 * Inputs are committed 64-byte vectors — no randomness in this suite.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

import {
  IrysSolanaSignatureRefusalError,
  toIrysSolanaProvider,
} from "../adapters/irys-solana/to-irys-provider.ts";
import { IRYS_DEVNET_BUNDLER_URL } from "../lib/storage/irys-upload-plan.ts";
import {
  WALLET_STANDARD_SIGNATURE_BYTE_LENGTH,
  walletStandardSignatureBase58,
} from "../lib/web3/svm-write-adapter.ts";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Fixed Ed25519 signatures produced once offline with Node crypto
 * Ed25519 keygen + sign over the named UTF-8 message, then committed as
 * literals. The generator script was not checked in.
 *
 * HEAD_BUG_NO_LEADING_ZERO: message "head-bug-quote"; first byte ≠ 0x00.
 * HEAD_BUG_LEADING_ZERO: message "head-bug-quote-leading-zero"; first byte
 *   === 0x00 (hex starts with 00…); resampled until constraint held.
 * REF_A/B/C: messages "kargain-sig-a|b|c".
 * IRYS_ADAPTER: message "irys-adapter-known".
 */
const HEAD_BUG_NO_LEADING_ZERO = new Uint8Array([
  0x0a, 0xfb, 0xe7, 0x18, 0x77, 0xc2, 0x65, 0x4a, 0x14, 0x1c, 0xfe, 0xd9, 0x5b,
  0xc6, 0x10, 0xa1, 0xa8, 0x0d, 0x61, 0x6e, 0xbb, 0xd8, 0xbf, 0x99, 0xf8, 0xc3,
  0x9f, 0x90, 0x2e, 0x5f, 0x0f, 0x6b, 0x5b, 0x8b, 0x2b, 0xcf, 0xa2, 0x34, 0x17,
  0x61, 0xb8, 0xae, 0x67, 0xbe, 0x16, 0x84, 0x4e, 0x59, 0x77, 0xd9, 0x78, 0xad,
  0xb9, 0xeb, 0x14, 0x93, 0x0b, 0xce, 0x3b, 0x6f, 0x37, 0xa9, 0x96, 0x04,
]);
const HEAD_BUG_LEADING_ZERO = new Uint8Array([
  0x00, 0xf1, 0x24, 0x9a, 0x95, 0xdc, 0xa2, 0x6e, 0x4e, 0x84, 0x5d, 0xf9, 0xa4,
  0x06, 0xcc, 0xf6, 0x91, 0x91, 0x28, 0xd0, 0x30, 0x98, 0xa4, 0x04, 0xe6, 0x1a,
  0xe5, 0x29, 0x9e, 0xf3, 0xd3, 0xe9, 0xd2, 0xbe, 0x9e, 0xb6, 0xeb, 0xd1, 0x2a,
  0xf1, 0x7b, 0x04, 0x3a, 0xa3, 0x8d, 0x28, 0x91, 0x1f, 0x36, 0xbe, 0x4e, 0x04,
  0xd6, 0xd4, 0xbf, 0x73, 0x76, 0xb7, 0x04, 0x49, 0xe4, 0x72, 0x5b, 0x0b,
]);
const REF_SIGNATURE_A = new Uint8Array([
  0x29, 0x4c, 0x28, 0x32, 0x76, 0x4e, 0x80, 0x5a, 0x31, 0xec, 0xe3, 0x3e, 0xd9,
  0xaa, 0xc9, 0x03, 0x83, 0x7c, 0xa3, 0xaf, 0xf9, 0x17, 0xbc, 0x7b, 0xdf, 0x65,
  0xcc, 0x55, 0x4f, 0x38, 0xf8, 0x61, 0xd2, 0x8b, 0xfa, 0xa2, 0x39, 0xbe, 0x80,
  0x2c, 0x42, 0xbe, 0xdf, 0x22, 0xc1, 0x3f, 0x5d, 0xf1, 0xe2, 0xbd, 0xb3, 0x25,
  0xcb, 0xb0, 0xd3, 0x03, 0x71, 0xf8, 0x48, 0xe7, 0x67, 0x21, 0x57, 0x05,
]);
const REF_SIGNATURE_B = new Uint8Array([
  0x1b, 0xc6, 0x04, 0xf7, 0xbb, 0xda, 0x01, 0x8e, 0xa0, 0xba, 0x81, 0xec, 0xe5,
  0x20, 0xa6, 0xda, 0x0d, 0x22, 0x0e, 0xfc, 0x71, 0x46, 0xff, 0x44, 0x7e, 0xc3,
  0x64, 0xaf, 0xbc, 0xb3, 0x8d, 0x40, 0xd9, 0x7e, 0x59, 0xac, 0xb8, 0x81, 0xa1,
  0xe8, 0x52, 0x45, 0x1c, 0x6a, 0xf5, 0xb3, 0x25, 0xba, 0x47, 0x46, 0x32, 0x37,
  0x45, 0x07, 0xf1, 0xf0, 0x97, 0x4c, 0xc0, 0x03, 0x34, 0x8e, 0x10, 0x00,
]);
const REF_SIGNATURE_C = new Uint8Array([
  0xbc, 0x43, 0x62, 0x4c, 0x0e, 0x01, 0x8b, 0x3f, 0x3c, 0x92, 0x02, 0x7f, 0x8d,
  0x71, 0x11, 0xfb, 0x92, 0xb3, 0x43, 0xbc, 0xb9, 0xe2, 0x36, 0xa8, 0xbf, 0xe4,
  0x68, 0x9b, 0x64, 0xc6, 0x64, 0xf6, 0x05, 0xc2, 0x11, 0x2e, 0x14, 0x31, 0x3f,
  0xf3, 0x37, 0xf2, 0x0a, 0x0d, 0x37, 0x37, 0x3c, 0x38, 0x49, 0x3c, 0xb9, 0xfa,
  0x20, 0x84, 0xdd, 0x25, 0x1f, 0xb1, 0xf1, 0x7f, 0x74, 0xfb, 0x8a, 0x09,
]);
const IRYS_ADAPTER_SIGNATURE = new Uint8Array([
  0x49, 0x11, 0x87, 0x48, 0x71, 0x2e, 0x95, 0xd3, 0x3f, 0x1a, 0xad, 0x46, 0x15,
  0x38, 0x90, 0x49, 0x6b, 0x89, 0xdb, 0x8f, 0x83, 0xe1, 0x5a, 0xef, 0xd6, 0xf5,
  0x80, 0xff, 0x8e, 0xb4, 0xd0, 0x2e, 0xc7, 0x09, 0xae, 0xc3, 0xbf, 0x6f, 0x8a,
  0x82, 0x36, 0x7a, 0x8e, 0x1a, 0x5d, 0xe8, 0xa1, 0x4c, 0x94, 0x68, 0x0a, 0x9d,
  0x47, 0xa5, 0x14, 0x0c, 0x33, 0xec, 0x12, 0xe6, 0x8d, 0xaa, 0xb6, 0x04,
]);

const REF_SIGNATURES = [
  REF_SIGNATURE_A,
  REF_SIGNATURE_B,
  REF_SIGNATURE_C,
] as const;

/** Correct BigInt reference encoder — independent of kit / product owner. */
function referenceBase58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  let n = 0n;
  for (let i = zeros; i < bytes.length; i += 1) {
    n = n * 256n + BigInt(bytes[i]!);
  }
  let out = "";
  while (n > 0n) {
    const rem = Number(n % 58n);
    n = n / 58n;
    out = BASE58_ALPHABET[rem]! + out;
  }
  return "1".repeat(zeros) + out;
}

/**
 * The deleted Irys hand-roll: fractional size → `"undefined"` for real 64-byte sigs.
 * Kept as a negative control so the HEAD failure cannot be forgotten.
 */
function encodeIrysSolanaSignatureBase58HeadBug(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const size = ((bytes.length - zeros) * 138) / 100 + 1;
  const b58 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i]!;
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k -= 1, j += 1) {
      carry += 256 * b58[k]!;
      b58[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }
  let i = size - length;
  while (i < size && b58[i] === 0) i += 1;
  let out = "1".repeat(zeros);
  for (; i < size; i += 1) {
    out += BASE58_ALPHABET[b58[i]!]!;
  }
  return out;
}

/** Banned identifiers assembled from parts so this file does not self-match. */
function suiteRandomnessViolations(source: string): string[] {
  const banned = [
    ["generate", "KeyPairSync"],
    ["random", "Bytes"],
    ["Math", ".random"],
  ] as const;
  const hits: string[] = [];
  for (const parts of banned) {
    const name = parts.join("");
    if (source.includes(name)) hits.push(name);
  }
  return hits;
}

const DEVNET_PLAN = {
  paymentToken: "solana" as const,
  bundlerUrl: IRYS_DEVNET_BUNDLER_URL,
  rpcUrl: "https://api.devnet.solana.com",
  devnet: true,
};

describe("walletStandardSignatureBase58 owner", () => {
  it("HEAD bug quoted: no leading zero yields the string undefined", () => {
    assert.equal(
      HEAD_BUG_NO_LEADING_ZERO.byteLength,
      WALLET_STANDARD_SIGNATURE_BYTE_LENGTH,
    );
    assert.notEqual(HEAD_BUG_NO_LEADING_ZERO[0], 0);
    assert.equal(
      encodeIrysSolanaSignatureBase58HeadBug(HEAD_BUG_NO_LEADING_ZERO),
      "undefined",
    );
  });

  it("HEAD bug quoted: leading zero byte yields 1undefined", () => {
    assert.equal(
      HEAD_BUG_LEADING_ZERO.byteLength,
      WALLET_STANDARD_SIGNATURE_BYTE_LENGTH,
    );
    assert.equal(HEAD_BUG_LEADING_ZERO[0], 0x00);
    assert.equal(
      encodeIrysSolanaSignatureBase58HeadBug(HEAD_BUG_LEADING_ZERO),
      "1undefined",
    );
  });

  it("three fixed Ed25519 signatures match the BigInt reference encoding", () => {
    let compared = 0;
    for (const signatureBytes of REF_SIGNATURES) {
      assert.equal(signatureBytes.byteLength, 64);
      const reference = referenceBase58Encode(signatureBytes);
      const result = walletStandardSignatureBase58(signatureBytes);
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected ok");
      assert.equal(result.signature, reference);
      compared += 1;
    }
    assert.equal(compared, 3);
  });

  it("leading zero bytes are preserved as base58 ones", () => {
    const signatureBytes = new Uint8Array(64);
    signatureBytes[0] = 0;
    signatureBytes[1] = 0;
    signatureBytes[2] = 7;
    for (let i = 3; i < 64; i += 1) signatureBytes[i] = (i * 17) & 0xff;
    const reference = referenceBase58Encode(signatureBytes);
    assert.ok(reference.startsWith("11"));
    const result = walletStandardSignatureBase58(signatureBytes);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected ok");
    assert.equal(result.signature, reference);
  });

  it("63-byte and 65-byte inputs refuse by name", () => {
    assert.deepEqual(walletStandardSignatureBase58(new Uint8Array(63).fill(1)), {
      ok: false,
      cause: "signature_not_64_bytes",
    });
    assert.deepEqual(walletStandardSignatureBase58(new Uint8Array(65).fill(1)), {
      ok: false,
      cause: "signature_not_64_bytes",
    });
    assert.deepEqual(walletStandardSignatureBase58(new Uint8Array(0)), {
      ok: false,
      cause: "wallet_returned_no_signature",
    });
    assert.deepEqual(walletStandardSignatureBase58(null), {
      ok: false,
      cause: "wallet_returned_no_signature",
    });
  });
});

describe("Irys adapter consumes signature owner", () => {
  it("sendTransaction returns reference base58 for a known 64-byte Wallet Standard signature", async () => {
    const knownSignature = IRYS_ADAPTER_SIGNATURE;
    const expected = referenceBase58Encode(knownSignature);
    assert.notEqual(encodeIrysSolanaSignatureBase58HeadBug(knownSignature), expected);

    const feePayer = new PublicKey("11111111111111111111111111111111");
    const account: WalletAccount = {
      address: feePayer.toBase58(),
      publicKey: feePayer.toBytes(),
      chains: ["solana:devnet"],
      features: ["solana:signAndSendTransaction", "solana:signMessage"],
    };
    const wallet: Wallet = {
      name: "FakeIrysWallet",
      version: "1.0.0",
      icon: "data:image/svg+xml;base64,PHN2Zy8+",
      chains: ["solana:devnet"],
      accounts: [account],
      features: {
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          signAndSendTransaction: async () => [{ signature: knownSignature }],
        },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async () => [{ signature: new Uint8Array(64).fill(2) }],
        },
      },
    };

    const provider = toIrysSolanaProvider(wallet, DEVNET_PLAN);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: feePayer,
        toPubkey: feePayer,
        lamports: 1,
      }),
    );
    tx.feePayer = feePayer;
    tx.recentBlockhash = "EkSnNWid2cvwEVnVx9aBqawnHuC32JMCwVWJEVx1HHS4";

    const returned = await provider.sendTransaction(
      tx,
      {} as Connection,
    );
    assert.equal(returned, expected);
  });

  it("sendTransaction throws typed refusal for wrong-length signature", async () => {
    const feePayer = new PublicKey("11111111111111111111111111111111");
    const account: WalletAccount = {
      address: feePayer.toBase58(),
      publicKey: feePayer.toBytes(),
      chains: ["solana:devnet"],
      features: ["solana:signAndSendTransaction", "solana:signMessage"],
    };
    const wallet: Wallet = {
      name: "FakeIrysWalletBadLen",
      version: "1.0.0",
      icon: "data:image/svg+xml;base64,PHN2Zy8+",
      chains: ["solana:devnet"],
      accounts: [account],
      features: {
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          signAndSendTransaction: async () => [
            { signature: new Uint8Array(63).fill(3) },
          ],
        },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async () => [{ signature: new Uint8Array(64).fill(2) }],
        },
      },
    };

    const provider = toIrysSolanaProvider(wallet, DEVNET_PLAN);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: feePayer,
        toPubkey: feePayer,
        lamports: 1,
      }),
    );
    tx.feePayer = feePayer;
    tx.recentBlockhash = "EkSnNWid2cvwEVnVx9aBqawnHuC32JMCwVWJEVx1HHS4";

    await assert.rejects(
      () => provider.sendTransaction(tx, {} as Connection),
      (err: unknown) => {
        assert.ok(err instanceof IrysSolanaSignatureRefusalError);
        assert.equal(err.signatureCause, "signature_not_64_bytes");
        assert.equal(err.message, "signature_not_64_bytes");
        return true;
      },
    );
  });
});

describe("suite has no randomness", () => {
  it("live source is green; planted banned call is red then green", () => {
    const live = readFileSync(fileURLToPath(import.meta.url), "utf8");
    assert.deepEqual(
      suiteRandomnessViolations(live),
      [],
      "suite must not contain banned randomness identifiers",
    );

    const plantedCall = ["generate", "KeyPairSync", '("ed25519");'].join("");
    const planted = `${live}\n${plantedCall}\n`;
    assert.deepEqual(suiteRandomnessViolations(planted), [
      ["generate", "KeyPairSync"].join(""),
    ]);

    assert.deepEqual(
      suiteRandomnessViolations(live),
      [],
      "green after plant: live source still clean",
    );
  });
});

