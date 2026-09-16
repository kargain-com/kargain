/**
 * U9.1 / U9.1-fix — headless product SetPassportUri send on Devnet.
 *
 * Drives {@link executeSetPassportUri} only. Does not encode, derive PDAs,
 * assemble TransactionInstruction, or call sendSvmInstruction. A node
 * {@link SvmSignAndSendPort} signs the wire bytes the product adapter hands
 * it and submits them — a second port implementation, not a second write path.
 *
 * Blockhash stays on the product default (`NEXT_PUBLIC_SOLANA_RPC_URL` via
 * fetchProductSvmLatestBlockhash). `--rpc` owns port submit + confirm only.
 *
 *   pnpm svm:product-send -- \
 *     --rpc <url> \
 *     --owner-keypair <path> \
 *     --token-id <decimal> \
 *     --uri <ar://...> \
 *     [--dry-run]
 *
 * Founder runs live. Do not mint here.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  executeSetPassportUri,
  planSetPassportUri,
} from "../lib/passport/set-passport-uri.ts";
import {
  requireSvmCommercialActive,
  walletStandardChainOf,
} from "../lib/web3/commercial-active.ts";
import type { ActiveAccountSvm } from "../lib/web3/active-account.ts";
import {
  AccountRole,
  type SvmSignAndSendPort,
} from "../lib/web3/svm-write-adapter.ts";
import type { WalletStandardChain } from "../lib/web3/wallet-standard-chain.ts";
import { getBase58Encoder } from "@solana/kit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, "../svm/lab/package.json"));
const {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} = require("@solana/web3.js") as typeof import("@solana/web3.js");

/**
 * Solana Devnet commercial namespace. The product owner field is named
 * `chainId` but is passed straight to commercialActive(namespace) — on SVM
 * callers must put 2000040168 here (not an EIP-155 id). Rename is queued
 * separately; do not "fix" the name in this unit.
 */
const SVM_DEVNET_NAMESPACE = 2_000_040_168;

export const EVM_ARM_UNREACHABLE = "evm_arm_unreachable" as const;
export const WRONG_WALLET_STANDARD_CHAIN =
  "wrong_wallet_standard_chain" as const;
export const CONFIRMED_SLOT_ABSENT = "confirmed_slot_absent" as const;
export const WIRE_PLAN_MISMATCH = "wire_plan_mismatch" as const;

/** Projection lag observer — not a send failure when timed out. */
export const PROJECTION_POLL_TIMEOUT_MS = 120_000;
export const PROJECTION_POLL_INTERVAL_MS = 2_000;
export const CONFIRM_POLL_TIMEOUT_MS = 60_000;
export const CONFIRM_POLL_INTERVAL_MS = 400;

const PONDER_PASSPORT_DETAIL_BASE =
  "https://ponder.kargain.com/passports";

export type ProductSendProjectionOutcome =
  | { kind: "projection_observed"; tokenUri: string }
  | {
      kind: "projection_not_observed_within_timeout";
      elapsedSeconds: number;
    };

export type ProductSendPlanSlice = {
  programId: string;
  data: Uint8Array;
  accounts: readonly { address: string; role: AccountRole }[];
  feePayer: string;
};

/** Port that satisfies {@link SvmSignAndSendPort} and records handed wire bytes. */
export type NodeSvmSignAndSendPort = SvmSignAndSendPort & {
  lastSignedTransaction: Uint8Array | null;
};

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) {
    throw new Error(`missing ${name}`);
  }
  return process.argv[i + 1]!;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function loadKp(p: string): InstanceType<typeof Keypair> {
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function roleLabel(role: AccountRole): string {
  const name = AccountRole[role];
  return typeof name === "string" ? name : String(role);
}

function bytesContain(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0) return true;
  if (needle.byteLength > haystack.byteLength) return false;
  outer: for (let i = 0; i <= haystack.byteLength - needle.byteLength; i++) {
    for (let j = 0; j < needle.byteLength; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Confirmed status must carry a real slot — never invent 0 for absence.
 */
export function requireConfirmedSlot(
  slot: number | bigint | null | undefined,
): bigint {
  if (slot == null) {
    throw new Error(
      `${CONFIRMED_SLOT_ABSENT}: confirmed signature has no slot`,
    );
  }
  if (typeof slot === "bigint") return slot;
  if (typeof slot === "number" && Number.isFinite(slot)) return BigInt(slot);
  throw new Error(
    `${CONFIRMED_SLOT_ABSENT}: confirmed signature has no slot`,
  );
}

/**
 * Containment proof: planned instruction data + pubkey encodings appear in
 * the wire the port was handed. No message decompiler.
 */
export function assertWireContainsPlan(
  wire: Uint8Array,
  plan: ProductSendPlanSlice,
): void {
  if (!bytesContain(wire, plan.data)) {
    throw new Error(
      `${WIRE_PLAN_MISMATCH}: planned instruction data not found in wire`,
    );
  }
  const programBytes = new PublicKey(plan.programId).toBytes();
  if (!bytesContain(wire, programBytes)) {
    throw new Error(
      `${WIRE_PLAN_MISMATCH}: programId ${plan.programId} not found in wire`,
    );
  }
  for (const meta of plan.accounts) {
    const addrBytes = new PublicKey(meta.address).toBytes();
    if (!bytesContain(wire, addrBytes)) {
      throw new Error(
        `${WIRE_PLAN_MISMATCH}: account ${meta.address} not found in wire`,
      );
    }
  }
}

/**
 * Node implementation of {@link SvmSignAndSendPort}.
 * Refuses by name when Wallet Standard chain ≠ stack expectation.
 * Records the transaction bytes handed in (unmodified) on the port object.
 */
export function createNodeSvmSignAndSendPort(opts: {
  owner: InstanceType<typeof Keypair>;
  rpcUrl: string;
  expectedChain: WalletStandardChain;
}): NodeSvmSignAndSendPort {
  const connection = new Connection(opts.rpcUrl, "confirmed");
  const port: NodeSvmSignAndSendPort = {
    lastSignedTransaction: null,
    async signAndSendTransaction({ transaction, chain }) {
      if (chain !== opts.expectedChain) {
        throw new Error(
          `${WRONG_WALLET_STANDARD_CHAIN}: expected ${opts.expectedChain}, received ${chain}`,
        );
      }
      port.lastSignedTransaction = new Uint8Array(transaction);
      const tx = VersionedTransaction.deserialize(Buffer.from(transaction));
      tx.sign([opts.owner]);
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      const bytes = getBase58Encoder().encode(signature);
      return new Uint8Array(bytes);
    },
  };
  return port;
}

export async function confirmSignatureSlot(
  rpcUrl: string,
  signature: string,
): Promise<bigint> {
  const connection = new Connection(rpcUrl, "confirmed");
  const deadline = Date.now() + CONFIRM_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const row = value[0];
    if (row?.err) {
      throw new Error(`confirm failed: ${JSON.stringify(row.err)}`);
    }
    const status = row?.confirmationStatus;
    if (status === "confirmed" || status === "finalized") {
      return requireConfirmedSlot(row?.slot);
    }
    await new Promise((r) => setTimeout(r, CONFIRM_POLL_INTERVAL_MS));
  }
  throw new Error(`confirm timeout after ${CONFIRM_POLL_TIMEOUT_MS}ms`);
}

export async function pollProjectionTokenUri(opts: {
  tokenId: string;
  expectedUri: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<ProductSendProjectionOutcome> {
  const timeoutMs = opts.timeoutMs ?? PROJECTION_POLL_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? PROJECTION_POLL_INTERVAL_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const started = Date.now();
  const url = `${PONDER_PASSPORT_DETAIL_BASE}/${encodeURIComponent(opts.tokenId)}`;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const body = (await res.json()) as { tokenUri?: unknown };
        if (
          typeof body.tokenUri === "string" &&
          body.tokenUri === opts.expectedUri
        ) {
          return { kind: "projection_observed", tokenUri: body.tokenUri };
        }
      }
    } catch {
      // lag observer — keep polling until timeout
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return {
    kind: "projection_not_observed_within_timeout",
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
  };
}

function printSvmPlan(plan: ProductSendPlanSlice): void {
  console.log(`programId ${plan.programId}`);
  console.log(`instruction_data_hex ${toHex(plan.data)}`);
  for (let i = 0; i < plan.accounts.length; i++) {
    const meta = plan.accounts[i]!;
    console.log(`account[${i}] ${meta.address} ${roleLabel(meta.role)}`);
  }
  console.log(`feePayer ${plan.feePayer}`);
}

async function main(): Promise<void> {
  const rpc = arg("--rpc");
  const owner = loadKp(arg("--owner-keypair"));
  const tokenId = arg("--token-id");
  const uri = arg("--uri");
  const dryRun = hasFlag("--dry-run");

  const stack = requireSvmCommercialActive(SVM_DEVNET_NAMESPACE);
  const chainResult = walletStandardChainOf(stack);
  if (!chainResult.ok) {
    throw new Error(
      `missing_wallet_standard_chain: ${chainResult.detail}`,
    );
  }

  const account: ActiveAccountSvm = {
    status: "connected",
    vm: "svm",
    address: owner.publicKey.toBase58(),
  };

  // Naming trap: field is chainId; value must be the commercial namespace.
  const chainId = SVM_DEVNET_NAMESPACE;

  const planned = await planSetPassportUri({
    account,
    chainId,
    tokenId,
    uri,
  });
  if (!planned.ok) {
    throw new Error(
      planned.detail.length > 0
        ? planned.detail
        : `planSetPassportUri refused: ${planned.cause}`,
    );
  }
  if (planned.vm !== "svm") {
    throw new Error("planSetPassportUri returned non-SVM plan");
  }

  printSvmPlan(planned.plan);

  if (dryRun) {
    console.log("dry_run ok — not sent");
    return;
  }

  const svmPort = createNodeSvmSignAndSendPort({
    owner,
    rpcUrl: rpc,
    expectedChain: chainResult.chain,
  });

  const signature = await executeSetPassportUri({
    account,
    chainId,
    tokenId,
    uri,
    writeEvmContract: () => {
      throw new Error(
        `${EVM_ARM_UNREACHABLE}: SVM product-send must never enter the EVM arm`,
      );
    },
    svmPort,
    // fetchBlockhash omitted — product default (NEXT_PUBLIC_SOLANA_RPC_URL)
  });

  const wire = svmPort.lastSignedTransaction;
  if (wire == null) {
    throw new Error(
      `${WIRE_PLAN_MISMATCH}: port recorded no transaction bytes`,
    );
  }
  assertWireContainsPlan(wire, planned.plan);
  console.log("wire_matches_plan ok");

  const slot = await confirmSignatureSlot(rpc, signature);
  console.log(`signature ${signature}`);
  console.log(`confirmed_slot ${slot.toString()}`);
  console.log(
    `explorer https://explorer.solana.com/tx/${signature}?cluster=devnet`,
  );

  const projection = await pollProjectionTokenUri({
    tokenId,
    expectedUri: uri,
  });
  if (projection.kind === "projection_observed") {
    console.log(
      `projection_observed tokenUri=${projection.tokenUri}`,
    );
  } else {
    console.log(
      `projection_not_observed_within_timeout elapsed_seconds=${projection.elapsedSeconds}`,
    );
  }
}

const invokedAsCli =
  process.argv[1] != null &&
  /svm-devnet-product-send\.(ts|js)$/.test(path.resolve(process.argv[1]));

if (invokedAsCli) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  });
}
