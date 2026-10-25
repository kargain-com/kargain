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
 * Fixed Ed25519 signatures from one documented seed. Reproduce offline with
 * Node crypto (do not commit seed or private-key bytes):
 *
 *   seed = SHA-256(UTF-8 "kargain/test/base58-signature-vectors/v1")
 *   private key = PKCS8 DER prefix 302e020100300506032b657004220420 || seed
 *   public key (32-byte raw, hex) =
 *     7490d1a78f37f940353041c91bf860f920cd91179861a5465124f768111361c7
 *
 * Sign each message below with that key (Ed25519 is deterministic). For the
 * two HEAD-bug vectors, take the smallest decimal counter n such that the
 * signature’s first byte meets the constraint.
 *
 * HEAD_BUG_NO_LEADING_ZERO: "head-bug-quote/0" (first byte ≠ 0x00)
 * HEAD_BUG_LEADING_ZERO: "head-bug-quote-leading-zero/9" (first byte === 0x00;
 *   hex starts with 00…)
 * REF_SIGNATURE_A/B/C: "kargain-sig-a" | "kargain-sig-b" | "kargain-sig-c"
 * IRYS_ADAPTER_SIGNATURE: "irys-adapter-known"
 */
const HEAD_BUG_NO_LEADING_ZERO = new Uint8Array([
  0x82, 0x08, 0x80, 0x9e, 0x71, 0x15, 0xb0, 0xe7, 0xb2, 0x71, 0xad, 0xff, 0xeb,
  0x1e, 0x8d, 0x0c, 0xc8, 0xc4, 0xf8, 0x58, 0x7f, 0x23, 0xa4, 0xcd, 0x38, 0xaf,
  0xf5, 0x07, 0x8b, 0xd3, 0xdd, 0x3d, 0x13, 0xf6, 0xba, 0x13, 0xf5, 0x76, 0x32,
  0x06, 0xb6, 0x06, 0x95, 0xa6, 0xb8, 0xdf, 0xe3, 0x00, 0x71, 0xcc, 0xfa, 0xab,
  0xa0, 0x26, 0xe6, 0x7e, 0xb0, 0x2e, 0xaf, 0xac, 0x9b, 0x5e, 0xde, 0x0e,
]);
const HEAD_BUG_LEADING_ZERO = new Uint8Array([
  0x00, 0x69, 0x27, 0xd0, 0x84, 0xb9, 0xfb, 0x7b, 0x28, 0x17, 0x05, 0x8e, 0x8b,
  0x4c, 0x82, 0xbc, 0x72, 0x95, 0xfe, 0x48, 0xbf, 0x96, 0x4a, 0x4d, 0x6f, 0xc6,
  0x19, 0xf4, 0x8f, 0xc5, 0x37, 0x98, 0x1a, 0xda, 0xdd, 0x7b, 0xac, 0x56, 0xb6,
  0x0d, 0x00, 0x2f, 0xb2, 0xe8, 0xe1, 0x95, 0xb7, 0x79, 0x5c, 0x75, 0x5f, 0x89,
  0x2c, 0xab, 0x9b, 0x78, 0x01, 0x96, 0x66, 0xec, 0x1f, 0xb0, 0xde, 0x00,
]);
const REF_SIGNATURE_A = new Uint8Array([
  0xc8, 0xb3, 0xf4, 0x2b, 0xe4, 0xd6, 0xd1, 0x12, 0xaf, 0xea, 0x7a, 0x45, 0xa0,
  0x16, 0xbe, 0xaa, 0x36, 0x00, 0x86, 0x73, 0x90, 0x13, 0x6a, 0x82, 0x50, 0x06,
  0x97, 0x44, 0xc5, 0x2d, 0x85, 0x16, 0x8e, 0xf8, 0xa6, 0xfe, 0x8f, 0xc0, 0x72,
  0x64, 0xa6, 0xc5, 0x59, 0xca, 0xae, 0xbb, 0xf1, 0xc4, 0xd5, 0x10, 0x1a, 0x80,
  0x52, 0x95, 0xe9, 0x1b, 0x4d, 0x15, 0x6c, 0x0e, 0x77, 0xf5, 0x57, 0x07,
]);
const REF_SIGNATURE_B = new Uint8Array([
  0xa0, 0x4f, 0xb4, 0x7f, 0xe7, 0x4c, 0x73, 0xaf, 0x68, 0x8e, 0xcb, 0x6b, 0x56,
  0x16, 0xda, 0xbe, 0xe0, 0x8c, 0x56, 0x32, 0x38, 0x86, 0xac, 0x04, 0x2a, 0x6f,
  0x29, 0xe7, 0xd9, 0xdf, 0x18, 0x12, 0x38, 0x79, 0xf5, 0x3c, 0x1f, 0x9a, 0xfc,
  0xda, 0x89, 0x76, 0x63, 0x34, 0x6c, 0x74, 0xe8, 0x8f, 0xcb, 0x41, 0x49, 0xcf,
  0x4e, 0xc5, 0xc3, 0x79, 0xd1, 0x2f, 0x34, 0xba, 0x71, 0xae, 0x39, 0x0c,
]);
const REF_SIGNATURE_C = new Uint8Array([
  0x1c, 0x72, 0x28, 0x71, 0xc4, 0xde, 0xa6, 0x81, 0x8b, 0x1c, 0x3e, 0xb1, 0xb2,
  0x0d, 0x49, 0xac, 0x59, 0xd8, 0x8d, 0x49, 0x78, 0x0a, 0x58, 0x62, 0x43, 0x74,
  0x25, 0xdc, 0x51, 0x74, 0x10, 0x6d, 0x7c, 0xde, 0x9c, 0xd9, 0x9e, 0xc3, 0x28,
  0x24, 0x7e, 0x00, 0xf6, 0xb5, 0x94, 0x12, 0xb6, 0x63, 0xd3, 0xb6, 0x06, 0x5b,
  0x71, 0xc4, 0x99, 0xa7, 0xfe, 0xe6, 0x92, 0xa0, 0x1c, 0x71, 0x35, 0x0c,
]);
const IRYS_ADAPTER_SIGNATURE = new Uint8Array([
  0x83, 0x88, 0x9f, 0xce, 0xf5, 0x29, 0x2a, 0xe2, 0xbf, 0x6c, 0x2f, 0x45, 0x58,
  0x04, 0xd9, 0x47, 0xd6, 0x15, 0x74, 0x64, 0xd6, 0x74, 0xeb, 0x10, 0x7b, 0x4b,
  0x5c, 0xba, 0x81, 0x0b, 0xdb, 0x7d, 0x93, 0x05, 0x2f, 0x80, 0x72, 0xcd, 0xa1,
  0x09, 0x06, 0x38, 0x8f, 0x88, 0xa1, 0xcd, 0x7d, 0xff, 0x63, 0x93, 0x23, 0x69,
  0xbf, 0x22, 0x02, 0x69, 0x77, 0x4f, 0xd4, 0x62, 0x7e, 0xda, 0x53, 0x00,
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

/**
 * This suite uses no random source. One table owns every banned form: hit
 * name, needle, and plant snippet. Detector and plants both iterate it.
 * Strings are assembled from parts so the live file does not self-match.
 */
type BannedRandomnessForm = {
  hit: string;
  needle: string;
  plant: string;
};

function bannedRandomnessForms(): BannedRandomnessForm[] {
  const nodeCrypto = ["node", ":", "crypto"].join("");
  const bareCrypto = ["cry", "pto"].join("");
  const mathRandom = ["Math", ".", "random"].join("");
  const webCryptoRand = ["get", "Random", "Values"].join("");
  const solanaKeygen = ["Keypair", ".", "generate"].join("");
  const cryptoDot = ["cry", "pto", "."].join("");
  const globalCrypto = ["globalThis", ".", "cry", "pto"].join("");
  const randomUuid = ["random", "UUID"].join("");

  const forms: BannedRandomnessForm[] = [];

  const addModule = (spec: string) => {
    const quoted = [
      { hit: `from "${spec}"`, open: 'from "', close: '"' },
      { hit: `from '${spec}'`, open: "from '", close: "'" },
      { hit: `require("${spec}")`, open: 'require("', close: '")' },
      { hit: `require('${spec}')`, open: "require('", close: "')" },
      { hit: `import("${spec}")`, open: 'import("', close: '")' },
      { hit: `import('${spec}')`, open: "import('", close: "')" },
    ] as const;
    for (const q of quoted) {
      const needle = `${q.open}${spec}${q.close}`;
      forms.push({
        hit: q.hit,
        needle,
        plant: `${needle};\n`,
      });
    }
  };

  addModule(nodeCrypto);
  addModule(bareCrypto);

  forms.push({
    hit: mathRandom,
    needle: mathRandom,
    plant: ["const x = ", mathRandom, "();\n"].join(""),
  });
  forms.push({
    hit: webCryptoRand,
    needle: webCryptoRand,
    plant: ["void ", webCryptoRand, "(new Uint8Array(1));\n"].join(""),
  });
  forms.push({
    hit: solanaKeygen,
    needle: solanaKeygen,
    plant: ["const k = ", solanaKeygen, "();\n"].join(""),
  });
  forms.push({
    hit: cryptoDot,
    needle: cryptoDot,
    plant: [cryptoDot, randomUuid, "();\n"].join(""),
  });
  forms.push({
    hit: globalCrypto,
    needle: globalCrypto,
    plant: ["void ", globalCrypto, ";\n"].join(""),
  });

  return forms;
}

/** Global Web Crypto property access: bare identifier + dot, word-bounded. */
function sourceHasCryptoPropertyAccess(source: string, cryptoDot: string): boolean {
  let from = 0;
  for (;;) {
    const idx = source.indexOf(cryptoDot, from);
    if (idx < 0) return false;
    const prev = idx === 0 ? "" : source[idx - 1]!;
    if (idx === 0 || !/[A-Za-z0-9_$]/.test(prev)) return true;
    from = idx + cryptoDot.length;
  }
}

function bannedFormMatches(source: string, form: BannedRandomnessForm): boolean {
  const cryptoDot = ["cry", "pto", "."].join("");
  if (form.needle === cryptoDot) {
    return sourceHasCryptoPropertyAccess(source, cryptoDot);
  }
  return source.includes(form.needle);
}

function suiteRandomnessViolations(source: string): string[] {
  return bannedRandomnessForms()
    .filter((form) => bannedFormMatches(source, form))
    .map((form) => form.hit);
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
  it("live source is green; each banned form planted separately is red", () => {
    const live = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const forms = bannedRandomnessForms();
    assert.ok(forms.length > 0, "banned-forms table must not be empty");
    assert.deepEqual(
      suiteRandomnessViolations(live),
      [],
      "suite must use no random source",
    );

    for (const form of forms) {
      const planted = `${live}\n${form.plant}`;
      assert.deepEqual(
        suiteRandomnessViolations(planted),
        [form.hit],
        `plant for ${form.hit} must report only that hit`,
      );
    }
  });
});

