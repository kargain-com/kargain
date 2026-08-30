/**
 * Materialize SOLANA_DEPLOYER_PRIVATE_KEY to a 0600 JSON keypair file.
 * Never logs the secret.
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { resolveSolanaDeployerPrivateKey } from "./svm-deploy-plan.js";

const require = createRequire(import.meta.url);

function loadBs58(): { decode: (s: string) => Uint8Array | number[] } {
  try {
    return require("bs58");
  } catch {
    const root = join(process.cwd(), "node_modules/.pnpm");
    const hit = readdirSync(root).find((d) => d.startsWith("bs58@"));
    if (!hit) throw new Error("bs58 not found");
    return require(join(root, hit, "node_modules/bs58"));
  }
}

function loadKeypair(): {
  Keypair: {
    fromSecretKey: (s: Uint8Array) => {
      publicKey: { toBase58: () => string };
      secretKey: Uint8Array;
    };
    fromSeed: (s: Uint8Array) => {
      publicKey: { toBase58: () => string };
      secretKey: Uint8Array;
    };
  };
} {
  try {
    return require("@solana/web3.js");
  } catch {
    const root = join(process.cwd(), "node_modules/.pnpm");
    const hit = readdirSync(root).find((d) => d.startsWith("@solana+web3.js@"));
    if (!hit) throw new Error("@solana/web3.js not found");
    return require(join(root, hit, "node_modules/@solana/web3.js"));
  }
}

export type MaterializedDeployer = {
  pubkey: string;
  keypairPath: string;
  workDir: string;
};

/**
 * Derive deployer pubkey from SOLANA_DEPLOYER_PRIVATE_KEY without writing a file.
 */
export function solanaDeployerPubkeyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = resolveSolanaDeployerPrivateKey(env);
  const bs58 = loadBs58();
  const { Keypair } = loadKeypair();
  let raw: Uint8Array;
  try {
    const decoded = bs58.decode(secret);
    raw = decoded instanceof Uint8Array ? decoded : Uint8Array.from(decoded);
  } catch {
    throw new Error("SOLANA_DEPLOYER_PRIVATE_KEY is not valid base58");
  }
  const kp =
    raw.length === 64
      ? Keypair.fromSecretKey(raw)
      : raw.length === 32
        ? Keypair.fromSeed(raw)
        : null;
  if (!kp) {
    throw new Error(
      `SOLANA_DEPLOYER_PRIVATE_KEY length ${raw.length} (want 64-byte secret or 32-byte seed)`,
    );
  }
  return kp.publicKey.toBase58();
}

/** Write deployer keypair under a fresh 0700 work dir. Caller must shred workDir. */
export function materializeSolanaDeployer(
  env: NodeJS.ProcessEnv = process.env,
): MaterializedDeployer {
  const secret = resolveSolanaDeployerPrivateKey(env);
  const bs58 = loadBs58();
  const { Keypair } = loadKeypair();
  let raw: Uint8Array;
  try {
    const decoded = bs58.decode(secret);
    raw = decoded instanceof Uint8Array ? decoded : Uint8Array.from(decoded);
  } catch {
    throw new Error("SOLANA_DEPLOYER_PRIVATE_KEY is not valid base58");
  }
  const kp =
    raw.length === 64
      ? Keypair.fromSecretKey(raw)
      : raw.length === 32
        ? Keypair.fromSeed(raw)
        : null;
  if (!kp) {
    throw new Error(
      `SOLANA_DEPLOYER_PRIVATE_KEY length ${raw.length} (want 64-byte secret or 32-byte seed)`,
    );
  }
  const workDir = join(
    tmpdir(),
    `kargain-svm-deploy-${randomBytes(8).toString("hex")}`,
  );
  mkdirSync(workDir, { mode: 0o700 });
  const keypairPath = join(workDir, "deployer.json");
  writeFileSync(keypairPath, JSON.stringify(Array.from(kp.secretKey)), {
    mode: 0o600,
  });
  return { pubkey: kp.publicKey.toBase58(), keypairPath, workDir };
}
