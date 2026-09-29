/**
 * Unit T — EVM confirm owner: timeout on every wait; Outcome classification;
 * deposit maps only WaitForTransactionReceiptTimeoutError → timeout;
 * landed revert carries revertData Hex from eth_call replay; getClient({ chainId }).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BaseError,
  encodeErrorResult,
  WaitForTransactionReceiptTimeoutError,
  type Hex,
} from "viem";
import { createConfig, http } from "wagmi";
import { hardhat as hardhatChain } from "viem/chains";

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  decodeCustomErrorData,
  extractRevertDataHex,
} from "@/lib/web3/decode-custom-error";
import {
  confirmEvmTransaction,
  confirmEvmTransactionConfirmations,
  EvmConfirmRefusal,
} from "@/lib/web3/evm-tx-confirm";
import {
  evmLandedRevertCopy,
  REVERT_COPY,
  txErrorMessage,
} from "@/lib/marketplace/tx-error-message";
import { writeConfirmRevertedCopy } from "@/lib/web3/write-confirm-copy";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVM_CONFIRM = path.join(ROOT, "lib/web3/evm-tx-confirm.ts");

const WAIT_WITHOUT_TIMEOUT =
  /waitForTransactionReceipt\s*\(\s*[^,]+,\s*\{(?![^}]*\btimeout\b)[^}]*\}\s*\)/;

function waitWithoutTimeoutPredicate(
  rel: string,
  source: string,
): string | false {
  if (!WAIT_WITHOUT_TIMEOUT.test(source)) return false;
  return `waitForTransactionReceipt without timeout (${rel})`;
}

const HASH = `0x${"ab".repeat(32)}` as const;
const FROM = `0x${"11".repeat(20)}` as const;
const TO = `0x${"22".repeat(20)}` as const;
const SAME_URI = encodeErrorResult({
  abi: KarPassportAbi,
  errorName: "SameURI",
}) as Hex;

function receiptRpc(status: "0x0" | "0x1") {
  return {
    transactionHash: HASH,
    transactionIndex: "0x0",
    blockHash: `0x${"cd".repeat(32)}`,
    blockNumber: "0x2a",
    from: FROM,
    to: TO,
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    contractAddress: null,
    logs: [],
    logsBloom: `0x${"0".repeat(512)}`,
    status,
    type: "0x2",
    effectiveGasPrice: "0x1",
  };
}

function txnRpc() {
  return {
    hash: HASH,
    nonce: "0x0",
    blockHash: `0x${"cd".repeat(32)}`,
    blockNumber: "0x2a",
    transactionIndex: "0x0",
    from: FROM,
    to: TO,
    value: "0x0",
    gasPrice: "0x1",
    gas: "0x5208",
    input: "0x1234",
    type: "0x0",
    chainId: "0x7a69",
    v: "0x0",
    r: `0x${"1".repeat(64)}`,
    s: `0x${"2".repeat(64)}`,
  };
}

type ReplayMode = "throw_custom" | "succeed" | "transport_fail";

function mockConfig(args: {
  receiptStatus: "0x0" | "0x1";
  replay: ReplayMode;
  chainIdSeen: number[];
}) {
  const transport = http("http://127.0.0.1:9", {
    // Unused — we override getClient.request below via a thin Config shim.
  });
  const base = createConfig({
    chains: [hardhatChain],
    transports: { [hardhatChain.id]: transport },
  });

  return {
    ...base,
    getClient: ({ chainId }: { chainId?: number } = {}) => {
      if (chainId != null) args.chainIdSeen.push(chainId);
      const client = base.getClient({ chainId: hardhatChain.id });
      return {
        ...client,
        request: async ({
          method,
          params,
        }: {
          method: string;
          params?: unknown;
        }) => {
          if (
            method === "eth_getTransactionReceipt" ||
            method === "eth_getTransactionByHash"
          ) {
            const want =
              method === "eth_getTransactionReceipt" ? receiptRpc(args.receiptStatus) : txnRpc();
            return want;
          }
          if (method === "eth_call") {
            if (args.replay === "succeed") {
              return "0x";
            }
            if (args.replay === "transport_fail") {
              throw new Error("rpc_unavailable");
            }
            // JSON-RPC execution revert — viem wraps as CallExecutionError carrying data.
            throw {
              code: 3,
              message: "execution reverted",
              data: SAME_URI,
            };
          }
          // Poll helpers for waitForTransactionReceipt
          if (method === "eth_blockNumber") return "0x2a";
          if (method === "eth_getBlockByNumber") {
            return {
              number: "0x2a",
              hash: `0x${"cd".repeat(32)}`,
              timestamp: "0x1",
              transactions: [],
            };
          }
          throw new Error(`unexpected rpc ${method} ${JSON.stringify(params)}`);
        },
      };
    },
  } as unknown as ReturnType<typeof createConfig>;
}

describe("evm-tx-confirm policy — Unit T", () => {
  it("EVM_TX_CONFIRM_TIMEOUT_MS reaches both waits", () => {
    const source = readFileSync(EVM_CONFIRM, "utf8");
    assert.match(source, /export const EVM_TX_CONFIRM_TIMEOUT_MS = 180_000/);
    assert.match(source, /viem's own default/);
    const confirmFn = source.slice(
      source.indexOf("export async function confirmEvmTransaction"),
      source.indexOf("export type EvmDepositConfirmOutcome"),
    );
    assert.match(confirmFn, /timeout:\s*EVM_TX_CONFIRM_TIMEOUT_MS/);
    const depositFn = source.slice(
      source.indexOf("export async function confirmEvmTransactionConfirmations"),
    );
    assert.match(depositFn, /timeout:\s*EVM_TX_CONFIRM_TIMEOUT_MS/);
  });

  it("confirmEvmTransaction returns EvmConfirmOutcome (not bare receipt)", () => {
    const source = readFileSync(EVM_CONFIRM, "utf8");
    assert.match(
      source,
      /export async function confirmEvmTransaction\([\s\S]*?\): Promise<EvmConfirmOutcome>/,
    );
    assert.match(source, /kind: "landed_ok"/);
    assert.match(source, /kind: "reverted"/);
    assert.match(source, /revertData/);
    assert.match(source, /getClient\(\{\s*chainId\s*\}\)/);
    assert.match(source, /kind: "superseded"/);
    assert.match(source, /kind: "status_unknown"/);
    assert.match(source, /WaitForTransactionReceiptTimeoutError/);
    assert.match(source, /from "viem\/actions"/);
    assert.equal(/from "wagmi\/actions"/.test(source), false);
  });

  it("both waits take explicit chainId (signature pin)", () => {
    const source = readFileSync(EVM_CONFIRM, "utf8");
    assert.match(
      source,
      /export async function confirmEvmTransaction\(\s*config: Config,\s*hash: `0x\$\{string\}`,\s*chainId: number,/,
    );
    assert.match(
      source,
      /export async function confirmEvmTransactionConfirmations\(\s*config: Config,\s*hash: `0x\$\{string\}`,\s*minConfirmations: number,\s*expectedTo: `0x\$\{string\}`,\s*chainId: number,/,
    );
  });

  it("deposit confirm maps only timeout class to timeout (not catch-all)", () => {
    const source = readFileSync(EVM_CONFIRM, "utf8");
    const depositFn = source.slice(
      source.indexOf("export async function confirmEvmTransactionConfirmations"),
    );
    assert.match(
      depositFn,
      /err instanceof WaitForTransactionReceiptTimeoutError/,
    );
    assert.equal(/catch\s*\{\s*return \{ kind: "timeout" \}/.test(depositFn), false);
    const plant = `} catch {\n    return { kind: "timeout" };\n  }`;
    assert.match(plant, /catch\s*\{/);
    assert.match(plant, /kind: "timeout"/);
  });

  it("product scan: waitForTransactionReceipt without timeout is banned outside owner", () => {
    const scan = scanProductSources(waitWithoutTimeoutPredicate, {
      owners: ["lib/web3/evm-tx-confirm.ts"],
    });
    assertCleanProductScan(scan, { owners: ["lib/web3/evm-tx-confirm.ts"] });
  });

  it("in-memory plant: wait without timeout is red", () => {
    const dirty = `await waitForTransactionReceipt(client, { hash });\n`;
    assert.equal(
      waitWithoutTimeoutPredicate("lib/web3/planted.ts", dirty),
      "waitForTransactionReceipt without timeout (lib/web3/planted.ts)",
    );
    const clean = `await waitForTransactionReceipt(client, { hash, timeout: EVM_TX_CONFIRM_TIMEOUT_MS });\n`;
    assert.equal(waitWithoutTimeoutPredicate("lib/web3/evm-tx-confirm.ts", clean), false);
  });

  it("WaitForTransactionReceiptTimeoutError is the timeout class (instanceof plant)", () => {
    const err = new WaitForTransactionReceiptTimeoutError({
      hash: `0x${"0".repeat(64)}`,
    });
    assert.ok(err instanceof WaitForTransactionReceiptTimeoutError);
    assert.equal(err.name, "WaitForTransactionReceiptTimeoutError");
  });

  it("extractRevertDataHex + decodeCustomErrorData name SameURI", () => {
    const err = Object.assign(new BaseError("execution reverted"), {
      data: SAME_URI,
      walk(fn: (e: unknown) => boolean) {
        const self = this as { data: Hex };
        return fn(self) ? self : null;
      },
    });
    const hex = extractRevertDataHex(err);
    assert.equal(hex, SAME_URI);
    const decoded = decodeCustomErrorData(SAME_URI, KarPassportAbi as never);
    assert.ok(decoded != null);
    assert.equal(decoded!.name, "SameURI");
    assert.equal(evmLandedRevertCopy(SAME_URI), REVERT_COPY.SameURI);
    assert.equal(evmLandedRevertCopy(null), writeConfirmRevertedCopy());
  });

  it("reverted receipt + replay throw with custom-error → revertData set + REVERT_COPY", async () => {
    const seen: number[] = [];
    const config = mockConfig({
      receiptStatus: "0x0",
      replay: "throw_custom",
      chainIdSeen: seen,
    });
    const outcome = await confirmEvmTransaction(config, HASH, 31337);
    assert.equal(outcome.kind, "reverted");
    if (outcome.kind === "reverted") {
      assert.equal(outcome.revertData, SAME_URI);
      assert.equal(outcome.blockNumber, 42n);
    }
    assert.deepEqual(seen, [31337]);
    assert.equal(
      txErrorMessage(new EvmConfirmRefusal(outcome as never)),
      REVERT_COPY.SameURI,
    );
  });

  it("replay succeeds → revertData null + generic sentence; no throw", async () => {
    const seen: number[] = [];
    const config = mockConfig({
      receiptStatus: "0x0",
      replay: "succeed",
      chainIdSeen: seen,
    });
    const outcome = await confirmEvmTransaction(config, HASH, 84532);
    assert.equal(outcome.kind, "reverted");
    if (outcome.kind === "reverted") {
      assert.equal(outcome.revertData, null);
    }
    assert.equal(
      txErrorMessage(new EvmConfirmRefusal(outcome as never)),
      writeConfirmRevertedCopy(),
    );
    assert.deepEqual(seen, [84532]);
  });

  it("replay transport failure → revertData null; no throw from confirm", async () => {
    const seen: number[] = [];
    const config = mockConfig({
      receiptStatus: "0x0",
      replay: "transport_fail",
      chainIdSeen: seen,
    });
    const outcome = await confirmEvmTransaction(config, HASH, 11155111);
    assert.equal(outcome.kind, "reverted");
    if (outcome.kind === "reverted") {
      assert.equal(outcome.revertData, null);
    }
    assert.deepEqual(seen, [11155111]);
  });

  it("deposit confirm getClient receives write chainId", async () => {
    const seen: number[] = [];
    const config = mockConfig({
      receiptStatus: "0x1",
      replay: "succeed",
      chainIdSeen: seen,
    });
    const outcome = await confirmEvmTransactionConfirmations(
      config,
      HASH,
      1,
      TO,
      84532,
    );
    assert.equal(outcome.kind, "confirmed");
    assert.deepEqual(seen, [84532]);
  });
});
