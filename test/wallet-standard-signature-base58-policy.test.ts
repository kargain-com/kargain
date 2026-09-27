/**
 * Wallet Standard signature bytes → base58: sole owner behavioural proof.
 * Pins the HEAD Irys failure class (`"undefined"` from fractional base58 size).
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
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

function ed25519Signature(message: string): Uint8Array {
  const { privateKey } = generateKeyPairSync("ed25519");
  return new Uint8Array(sign(null, Buffer.from(message, "utf8"), privateKey));
}

const DEVNET_PLAN = {
  paymentToken: "solana" as const,
  bundlerUrl: IRYS_DEVNET_BUNDLER_URL,
  rpcUrl: "https://api.devnet.solana.com",
  devnet: true,
};

describe("walletStandardSignatureBase58 owner", () => {
  it("HEAD bug quoted: fractional base58 size yields the string undefined", () => {
    const sample = ed25519Signature("head-bug-quote");
    assert.equal(sample.byteLength, WALLET_STANDARD_SIGNATURE_BYTE_LENGTH);
    assert.equal(encodeIrysSolanaSignatureBase58HeadBug(sample), "undefined");
  });

  it("three real Ed25519 signatures match the BigInt reference encoding", () => {
    const messages = ["kargain-sig-a", "kargain-sig-b", "kargain-sig-c"] as const;
    let compared = 0;
    for (const message of messages) {
      const signatureBytes = ed25519Signature(message);
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
    const knownSignature = ed25519Signature("irys-adapter-known");
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
