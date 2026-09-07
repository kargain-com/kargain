/**
 * Read-only: evidence `programs.*.soSha256` ≡ on-chain ProgramData ELF (leading
 * bytes + empty padding) for every commercial census program.
 *
 *   pnpm verify:svm-binary-identity
 *   pnpm verify:svm-binary-identity -- --eid=40168
 *
 * Uses JSON-RPC getAccountInfo only — no solana CLI, no keypair, no config
 * default signer (the upgrade path's read-only CLI lesson: always pass an
 * explicit signer path; this gate avoids that class entirely).
 */
import { config as loadEnv } from "dotenv";

import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.js";
import { requireSvmCommercialActive } from "../lib/web3/commercial-active.js";
import { postSolanaJsonRpc } from "../lib/svm/solana-json-rpc.js";
import {
  assertSvmBinaryIdentity,
  formatSvmBinaryIdentityFailure,
  formatSvmBinaryIdentitySuccessLines,
  programDataAddressFromProgramAccount,
  sliceElfFromProgramDataAccount,
} from "./lib/assert-svm-binary-identity.js";
import {
  requireSvmDevnetEvidence,
  svmDevnetEvidencePath,
} from "./lib/load-deployment.js";
import { maskBase58Id } from "./lib/svm-upgrade-in-place-preflight.js";

loadEnv({ path: ".env.local" });
loadEnv();

const DEFAULT_429_MAX_ATTEMPTS = 6;
const DEFAULT_RPC = "https://api.devnet.solana.com";

type AccountInfoResult = {
  value: {
    data: [string, string];
    owner: string;
  } | null;
};

function parseEid(argv: string[]): number {
  for (const a of argv) {
    const m = /^--eid=(\d+)$/.exec(a);
    if (m) return Number(m[1]);
  }
  return 40168;
}

function isRateLimitError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  if (/\b429\b/.test(message)) return true;
  if (/too many requests/i.test(message)) return true;
  return false;
}

async function with429Backoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = DEFAULT_429_MAX_ATTEMPTS,
): Promise<T> {
  let delayMs = 500;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err) || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 8_000);
    }
  }
  throw lastErr;
}

async function getAccountDataBase64(
  rpcUrl: string,
  address: string,
): Promise<Uint8Array> {
  const result = await with429Backoff(() =>
    postSolanaJsonRpc<AccountInfoResult>(rpcUrl, "getAccountInfo", [
      address,
      { encoding: "base64", commitment: "confirmed" },
    ]),
  );
  if (result.value == null) {
    throw new Error(`account absent on-chain (${maskBase58Id(address)})`);
  }
  const [b64, encoding] = result.value.data;
  if (encoding !== "base64" || typeof b64 !== "string") {
    throw new Error(
      `getAccountInfo unexpected encoding for ${maskBase58Id(address)}`,
    );
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function fetchProgramDataElf(
  rpcUrl: string,
  programId: string,
): Promise<Uint8Array> {
  const programData = await getAccountDataBase64(rpcUrl, programId);
  const parsed = programDataAddressFromProgramAccount(programData);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const pdData = await getAccountDataBase64(rpcUrl, parsed.programDataAddress);
  const sliced = sliceElfFromProgramDataAccount(pdData);
  if (!sliced.ok) {
    throw new Error(sliced.message);
  }
  return sliced.elfRegion;
}

async function main() {
  const eid = parseEid(process.argv.slice(2));
  const rpcEnvPresent = Boolean(process.env.SOLANA_RPC_URL?.trim());
  const rpc = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC;

  let evidence;
  try {
    evidence = requireSvmDevnetEvidence(eid);
  } catch {
    console.error(`Missing ${svmDevnetEvidencePath(eid)} — run deploy:svm first`);
    process.exit(1);
  }

  const namespace = namespaceFromLayerZeroEid(eid);
  const stack = requireSvmCommercialActive(namespace);

  console.log(
    `SVM binary identity — eid ${eid} namespace=${namespace} ` +
      `rpc=${rpc} SOLANA_RPC_URL=${rpcEnvPresent ? "present" : "absent→public-devnet"} ` +
      `evidence=${svmDevnetEvidencePath(eid)} ` +
      `(JSON-RPC getAccountInfo only; no keypair)`,
  );

  const result = await assertSvmBinaryIdentity({
    stack,
    evidence,
    fetchProgramDataElf: (programId) => fetchProgramDataElf(rpc, programId),
  });

  if (!result.ok) {
    console.error(formatSvmBinaryIdentityFailure(result));
    process.exit(1);
  }

  for (const line of formatSvmBinaryIdentitySuccessLines(result)) {
    console.log(line);
  }
  console.log("\nBinary identity intact.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
