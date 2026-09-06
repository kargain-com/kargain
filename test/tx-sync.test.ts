import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseEventLogs,
  zeroAddress,
  type Abi,
  type Log,
  type TransactionReceipt,
} from "viem";

import { claimablePayoutsAbi } from "../lib/claims/claimable-payouts-abi.ts";
import { claimRecordedFromReceipt } from "../lib/claims/receipt-claims.ts";
import {
  KarPassportAbi,
  KarPassportBridgeGatewayAbi,
} from "../lib/contracts/abis.generated.ts";
import {
  INDEXER_SYNC_CONSECUTIVE_FAILURES,
  INDEXER_SYNC_INTERVAL_MS,
  INDEXER_SYNC_MAX_ATTEMPTS,
  type IndexerBlockNumberResult,
  pollUntil,
  waitForIndexerBlock,
} from "../lib/web3/tx-sync.ts";
import {
  runEvmWriteLifecycle,
  type EvmWriteLifecyclePhase,
} from "../lib/web3/evm-write-lifecycle.ts";
import { onftSentGuidFromLogs } from "../lib/web3/bridge/bridge-guid.ts";
import { commercialActive } from "../lib/web3/commercial-active.ts";
import { evmSwitchChainAvailability } from "../lib/web3/active-account.ts";
import { encodeSvmPubkeyBytes } from "../lib/web3/protocol-address.ts";
import {
  awaitWriteReceipt,
  runWriteLifecycle,
} from "../lib/web3/write-lifecycle.ts";
import {
  writeOutcomeHasClaimRecipient,
  type WriteIndexerBarrier,
  type WriteOutcome,
} from "../lib/web3/write-outcome.ts";
import {
  txWriteAvailability,
  txWriteRefusalMessage,
} from "../lib/web3/tx-write-availability.ts";
import {
  FIXTURE_SVM_NAMESPACE,
  FIXTURE_SVM_STACK,
} from "./fixtures/commercial-svm-stack.ts";
import {
  buildPassportMintedBody,
  globalTokenId,
  PASSPORT_MINTED_DISC,
} from "./fixtures/svm-ingest/borsh-fixtures.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CREATE_PASSPORT_WIZARD = path.join(
  ROOT,
  "components/passport/create-passport-wizard.tsx",
);

function fakeWait() {
  const calls: number[] = [];
  return {
    calls,
    wait: async (ms: number) => {
      calls.push(ms);
    },
  };
}

function sequenceFetcher(results: IndexerBlockNumberResult[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    fetchStatus: async () => {
      const result = results[Math.min(calls, results.length - 1)]!;
      calls += 1;
      return result;
    },
  };
}

function fixtureEvmAccount(walletChainId = 84532) {
  const stack = commercialActive(84532);
  if (!stack || stack.vm !== "evm") {
    throw new Error("Missing 84532 EVM commercial stack");
  }
  return {
    status: "connected" as const,
    vm: "evm" as const,
    address: "0x0000000000000000000000000000000000000001" as const,
    namespace: stack.namespace,
    chainId: walletChainId,
  };
}

function fakeReceipt(
  hash: `0x${string}`,
  blockNumber: bigint,
  logs: Log[] = [],
): TransactionReceipt {
  return {
    blockHash: `0x${"a".repeat(64)}`,
    blockNumber,
    contractAddress: null,
    cumulativeGasUsed: 1n,
    effectiveGasPrice: 1n,
    from: "0x0000000000000000000000000000000000000001",
    gasUsed: 1n,
    logs,
    logsBloom: `0x${"0".repeat(512)}`,
    status: "success",
    to: "0x0000000000000000000000000000000000000002",
    transactionHash: hash,
    transactionIndex: 0,
    type: "eip1559",
  } as TransactionReceipt;
}

function fixtureSvmAccount() {
  return {
    status: "connected" as const,
    vm: "svm" as const,
    address: encodeSvmPubkeyBytes(pubkey32FromSeed(7)),
    namespace: FIXTURE_SVM_STACK.namespace,
  };
}

function bytes32FromBigint(value: bigint): Buffer {
  const out = Buffer.alloc(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function bytes32FromHex(hex: `0x${string}`): Buffer {
  return Buffer.from(hex.slice(2).padStart(64, "0"), "hex");
}

function pubkey32FromSeed(seed: number): Buffer {
  const out = Buffer.alloc(32);
  out[31] = seed & 0xff;
  return out;
}

function u32le(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function u64le(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out;
}

function svmPayload(args: {
  discriminatorHex: string;
  body: Buffer;
  eventName: string;
  contractName: string;
}) {
  const payloadBytes = Buffer.concat([
    Buffer.from(args.discriminatorHex, "hex"),
    args.body,
  ]);
  return {
    id: `${args.contractName}:${args.eventName}`,
    namespace: FIXTURE_SVM_NAMESPACE,
    slot: 123,
    txIndexInBlock: 0,
    logIndex: 0,
    txSignature: "svm-signature-1",
    emittingProgram: FIXTURE_SVM_STACK.karPassport,
    discriminator: Buffer.from(args.discriminatorHex, "hex"),
    eventName: args.eventName,
    contractName: args.contractName,
    payloadBytes,
  };
}

function buildClaimRecordedBody(accountSeed: number): Buffer {
  return Buffer.concat([
    pubkey32FromSeed(accountSeed),
    pubkey32FromSeed(8),
    u64le(42n),
  ]);
}

function buildOnftSentBody(args: {
  guid: `0x${string}`;
  dstEid: number;
  tokenId: bigint;
  fromSeed?: number;
}): Buffer {
  return Buffer.concat([
    bytes32FromHex(args.guid),
    u32le(args.dstEid),
    pubkey32FromSeed(args.fromSeed ?? 9),
    bytes32FromBigint(args.tokenId),
  ]);
}

function makeBaseLog(
  hash: `0x${string}`,
  index: number,
): Omit<Log, "topics" | "data" | "address"> {
  return {
    blockHash: ("0x" + "11".repeat(32)) as `0x${string}`,
    blockNumber: 1n,
    logIndex: index,
    transactionHash: hash,
    transactionIndex: 0,
    removed: false,
  };
}

function makePassportMintedLog(
  hash: `0x${string}`,
  tokenId: bigint,
  uri = "ar://passport",
): Log {
  const topics = encodeEventTopics({
    abi: KarPassportAbi as Abi,
    eventName: "PassportMinted",
    args: { tokenId },
  });
  return {
    address: "0x3333333333333333333333333333333333333333",
    data: encodeAbiParameters([{ type: "string" }], [uri]),
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    ...makeBaseLog(hash, 0),
  };
}

function makeClaimRecordedLog(
  hash: `0x${string}`,
  account: `0x${string}`,
  amount = 100n,
): Log {
  const topics = encodeEventTopics({
    abi: claimablePayoutsAbi,
    eventName: "ClaimRecorded",
    args: { account, asset: zeroAddress },
  });
  return {
    address: "0x4444444444444444444444444444444444444444",
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    ...makeBaseLog(hash, 1),
  };
}

function makeOnftSentLog(
  hash: `0x${string}`,
  guid: `0x${string}`,
): Log {
  const topics = encodeEventTopics({
    abi: KarPassportBridgeGatewayAbi as Abi,
    eventName: "ONFTSent",
    args: {
      guid,
      fromAddress: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
    },
  });
  return {
    address: "0x5555555555555555555555555555555555555555",
    data: encodeAbiParameters(
      [{ type: "uint32" }, { type: "uint256" }],
      [40161, 1n],
    ),
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    ...makeBaseLog(hash, 2),
  };
}

type LegacyLifecycleOptions = {
  account: ReturnType<typeof fixtureEvmAccount>;
  chainId: number;
  switchChain: (chainId: number) => Promise<void>;
  writeFn: () => Promise<string>;
  fetchIndexerStatus: () => Promise<IndexerBlockNumberResult>;
  wait: (ms: number) => Promise<void>;
  onPhase?: (phase: EvmWriteLifecyclePhase) => void;
  confirmTransaction: (
    _config: never,
    hash: `0x${string}`,
  ) => Promise<TransactionReceipt>;
  resolveTargetChainId?: (chainId: number) => number;
};

type LegacyEvmLifecycleSuccess = {
  receipt: TransactionReceipt;
  synced: boolean;
};

async function legacyRunEvmWriteLifecycle({
  account,
  chainId,
  switchChain,
  writeFn,
  fetchIndexerStatus,
  wait,
  onPhase,
  confirmTransaction,
  resolveTargetChainId = (value) => value,
}: LegacyLifecycleOptions): Promise<LegacyEvmLifecycleSuccess> {
  const avail = txWriteAvailability(account, chainId);
  if (!avail.available) {
    throw new Error(txWriteRefusalMessage(avail.cause));
  }
  onPhase?.("wallet");
  const targetChainId = resolveTargetChainId(chainId);
  if (avail.vm !== "evm") {
    throw new Error(txWriteRefusalMessage("wrong_vm"));
  }
  if (avail.walletChainId !== targetChainId) {
    const switchAvail = evmSwitchChainAvailability(account);
    if (!switchAvail.available) {
      throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
    }
    await switchChain(chainId);
  }
  const hash = await writeFn();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error("Transaction hash is not a valid EVM hash.");
  }
  const txHash = hash as `0x${string}`;
  onPhase?.("confirming");
  const receipt = await confirmTransaction(undefined as never, txHash);
  onPhase?.("indexing");
  const { synced } = await waitForIndexerBlock({
    targetBlock: receipt.blockNumber,
    fetchStatus: fetchIndexerStatus,
    wait,
  });
  return {
    receipt,
    synced,
  };
}

function legacyMintedPassportTokenId(receipt: TransactionReceipt): string | null {
  const parsed = parseEventLogs({
    abi: KarPassportAbi,
    logs: receipt.logs,
    eventName: "PassportMinted",
  });
  const minted = parsed[0];
  if (!minted || minted.eventName !== "PassportMinted") return null;
  return minted.args.tokenId.toString();
}

function mintedRouteForLegacyReceipt(
  receipt: TransactionReceipt,
  chainId: number,
): string | null {
  const tokenId = legacyMintedPassportTokenId(receipt);
  if (tokenId == null) return null;
  return `/marketplace/${tokenId}/created?chain=${chainId}&tx=${receipt.transactionHash}`;
}

function mintedRouteForWriteOutcome(
  outcome: WriteOutcome,
  chainId: number,
): string | null {
  const minted = outcome.mintedPassportTokenId;
  if (!minted.ok) return null;
  return `/marketplace/${minted.tokenId}/created?chain=${chainId}&tx=${outcome.writeReference}`;
}

function legacyClaimRecordedForAccount(
  receipt: TransactionReceipt,
  account: `0x${string}`,
): boolean {
  return claimRecordedFromReceipt(receipt, account).length > 0;
}

function claimRecordedForOutcome(
  outcome: WriteOutcome,
  account: string,
): boolean {
  return writeOutcomeHasClaimRecipient(outcome, account);
}

function typecheckPublicWriteOutcomeSeam(outcome: WriteOutcome) {
  const barrier: WriteIndexerBarrier = outcome.indexerBarrier;
  const writeRef: string = outcome.writeReference;
  void barrier;
  void writeRef;
}

void typecheckPublicWriteOutcomeSeam;

describe("waitForIndexerBlock", () => {
  it("catches up on the first poll", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([{ ok: true, blockNumber: 100 }]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: true });
    assert.equal(status.calls, 1);
    assert.deepEqual(clock.calls, []);
  });

  it("catches up on the Nth poll", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([
      { ok: true, blockNumber: 98 },
      { ok: true, blockNumber: 99 },
      { ok: true, blockNumber: 100 },
    ]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: true });
    assert.equal(status.calls, 3);
    assert.deepEqual(clock.calls, [
      INDEXER_SYNC_INTERVAL_MS,
      INDEXER_SYNC_INTERVAL_MS,
    ]);
  });

  it("tolerates unavailable responses mid-poll", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([
      { ok: true, blockNumber: 99 },
      { ok: false },
      { ok: true, blockNumber: 100 },
    ]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: true });
    assert.equal(status.calls, 3);
    assert.equal(clock.calls.length, 2);
  });

  it("fast-fails after exactly three consecutive unavailable responses", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([{ ok: false }]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: false });
    assert.equal(status.calls, INDEXER_SYNC_CONSECUTIVE_FAILURES);
    assert.equal(clock.calls.length, INDEXER_SYNC_CONSECUTIVE_FAILURES - 1);
    assert.ok(clock.calls.every((ms) => ms === INDEXER_SYNC_INTERVAL_MS));
  });

  it("resets the consecutive-failure counter on a lagging ok response", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([
      { ok: false },
      { ok: false },
      { ok: true, blockNumber: 99 },
      { ok: false },
      { ok: false },
      { ok: true, blockNumber: 100 },
    ]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: true });
    assert.equal(status.calls, 6);
    assert.equal(clock.calls.length, 5);
  });

  it("exhausts the full attempt cap when ok responses stay behind the target", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([{ ok: true, blockNumber: 99 }]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: false });
    assert.equal(status.calls, INDEXER_SYNC_MAX_ATTEMPTS);
    assert.equal(clock.calls.length, INDEXER_SYNC_MAX_ATTEMPTS - 1);
    assert.ok(clock.calls.every((ms) => ms === INDEXER_SYNC_INTERVAL_MS));
  });
});

describe("pollUntil", () => {
  it("matches a predicate on the first attempt", async () => {
    const clock = fakeWait();
    const result = await pollUntil({
      poll: async () => 3,
      predicate: (value) => value === 3,
      intervalMs: 25,
      maxAttempts: 4,
      wait: clock.wait,
    });

    assert.deepEqual(result, { status: "matched", value: 3, attempts: 1 });
    assert.deepEqual(clock.calls, []);
  });

  it("matches a passport-style predicate on the Nth attempt", async () => {
    const clock = fakeWait();
    const values = [
      { ok: true, indexerPending: true },
      { ok: false, indexerPending: false },
      { ok: true, indexerPending: false },
    ];
    let index = 0;

    const result = await pollUntil({
      poll: async () => values[index++]!,
      predicate: (value) => value.ok && !value.indexerPending,
      intervalMs: 3_000,
      maxAttempts: 5,
      wait: clock.wait,
    });

    assert.equal(result.status, "matched");
    assert.equal(result.attempts, 3);
    assert.deepEqual(clock.calls, [3_000, 3_000]);
  });

  it("treats poll and predicate failures as attempts", async () => {
    const clock = fakeWait();
    let attempts = 0;
    const result = await pollUntil({
      poll: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("unavailable");
        return attempts;
      },
      predicate: (value) => {
        if (value === 2) throw new Error("invalid");
        return value === 3;
      },
      intervalMs: 10,
      maxAttempts: 3,
      wait: clock.wait,
    });

    assert.deepEqual(result, { status: "matched", value: 3, attempts: 3 });
    assert.deepEqual(clock.calls, [10, 10]);
  });

  it("exhausts at the custom cap and preserves the latest value", async () => {
    const clock = fakeWait();
    let value = 0;
    const result = await pollUntil({
      poll: async () => {
        value += 1;
        return value;
      },
      predicate: () => false,
      intervalMs: 50,
      maxAttempts: 4,
      wait: clock.wait,
    });

    assert.deepEqual(result, {
      status: "exhausted",
      value: 4,
      attempts: 4,
    });
    assert.deepEqual(clock.calls, [50, 50, 50]);
  });

  it("cancels before the first poll", async () => {
    const clock = fakeWait();
    let polls = 0;
    const result = await pollUntil({
      poll: async () => {
        polls += 1;
        return false;
      },
      predicate: Boolean,
      intervalMs: 10,
      maxAttempts: 3,
      wait: clock.wait,
      shouldContinue: () => false,
    });

    assert.deepEqual(result, {
      status: "cancelled",
      value: undefined,
      attempts: 0,
    });
    assert.equal(polls, 0);
  });

  it("cancels after a poll before waiting", async () => {
    const clock = fakeWait();
    let active = true;
    const result = await pollUntil({
      poll: async () => {
        active = false;
        return "pending";
      },
      predicate: () => false,
      intervalMs: 10,
      maxAttempts: 3,
      wait: clock.wait,
      shouldContinue: () => active,
    });

    assert.deepEqual(result, {
      status: "cancelled",
      value: "pending",
      attempts: 1,
    });
    assert.deepEqual(clock.calls, []);
  });

  it("does not poll again when cancelled while waiting", async () => {
    let active = true;
    let polls = 0;
    const result = await pollUntil({
      poll: async () => {
        polls += 1;
        return false;
      },
      predicate: Boolean,
      intervalMs: 10,
      maxAttempts: 3,
      wait: async () => {
        active = false;
      },
      shouldContinue: () => active,
    });

    assert.equal(result.status, "cancelled");
    assert.equal(result.attempts, 1);
    assert.equal(polls, 1);
  });
});

describe("runEvmWriteLifecycle equivalence", () => {
  it("matches the legacy observable sequence for a successful write", async () => {
    const events: string[] = [];
    const account = fixtureEvmAccount(84532);
    const hash = `0x${"1".repeat(64)}` as const;
    const receipt = fakeReceipt(hash, 100n);
    const wait = async (ms: number) => {
      events.push(`wait:${ms}`);
    };
    const shared = {
      account,
      chainId: 84532,
      switchChain: async (target: number) => {
        events.push(`switch:${target}`);
      },
      writeFn: async () => {
        events.push("write");
        return hash;
      },
      fetchIndexerStatus: async () => ({ ok: true, blockNumber: 100 }),
      wait,
      onPhase: (phase: EvmWriteLifecyclePhase) => {
        events.push(`phase:${phase}`);
      },
      confirmTransaction: async (_config: never, confirmedHash: `0x${string}`) => {
        events.push(`confirm:${confirmedHash}`);
        return receipt;
      },
      resolveTargetChainId: (value: number) => value,
    } satisfies LegacyLifecycleOptions;

    const legacyEvents: string[] = [];
    const legacy = await legacyRunEvmWriteLifecycle({
      ...shared,
      onPhase: (phase) => legacyEvents.push(`phase:${phase}`),
      switchChain: async (target) => {
        legacyEvents.push(`switch:${target}`);
      },
      writeFn: async () => {
        legacyEvents.push("write");
        return hash;
      },
      fetchIndexerStatus: async () => {
        const result = {
          ok: true,
          blockNumber: legacyEvents.includes("status:99") ? 100 : 99,
        } as IndexerBlockNumberResult;
        legacyEvents.push(`status:${result.ok ? result.blockNumber : "unavailable"}`);
        return result;
      },
      wait: async (ms) => {
        legacyEvents.push(`wait:${ms}`);
      },
      confirmTransaction: async (_config, confirmedHash) => {
        legacyEvents.push(`confirm:${confirmedHash}`);
        return receipt;
      },
    });

    const actual = await runEvmWriteLifecycle({
      account,
      chainId: 84532,
      config: undefined as never,
      switchChain: async (target) => {
        events.push(`switch:${target}`);
      },
      writeFn: async () => {
        events.push("write");
        return hash;
      },
      fetchIndexerStatus: async () => {
        const result = {
          ok: true,
          blockNumber: events.includes("status:99") ? 100 : 99,
        } as IndexerBlockNumberResult;
        events.push(`status:${result.ok ? result.blockNumber : "unavailable"}`);
        return result;
      },
      wait,
      onPhase: (phase: EvmWriteLifecyclePhase) => {
        events.push(`phase:${phase}`);
      },
      confirmTransaction: async (_config, confirmedHash) => {
        events.push(`confirm:${confirmedHash}`);
        return receipt;
      },
      resolveTargetChainId: (value: number) => value,
    });

    assert.deepEqual(actual.indexerBarrier, { status: "observed" });
    assert.equal(actual.writeReference, legacy.receipt.transactionHash);
    assert.deepEqual(events, legacyEvents);
  });

  it("matches the legacy observable sequence for a wrong-chain write that switches first", async () => {
    const account = fixtureEvmAccount(11155111);
    const hash = `0x${"2".repeat(64)}` as const;
    const receipt = fakeReceipt(hash, 55n);
    const legacyEvents: string[] = [];
    const actualEvents: string[] = [];

    const legacy = await legacyRunEvmWriteLifecycle({
      account,
      chainId: 84532,
      switchChain: async (target) => {
        legacyEvents.push(`switch:${target}`);
      },
      writeFn: async () => {
        legacyEvents.push("write");
        return hash;
      },
      fetchIndexerStatus: async () => {
        legacyEvents.push("status:55");
        return { ok: true, blockNumber: 55 };
      },
      wait: async (ms) => {
        legacyEvents.push(`wait:${ms}`);
      },
      onPhase: (phase) => legacyEvents.push(`phase:${phase}`),
      confirmTransaction: async (_config, confirmedHash) => {
        legacyEvents.push(`confirm:${confirmedHash}`);
        return receipt;
      },
      resolveTargetChainId: (value) => value,
    });

    const actual = await runEvmWriteLifecycle({
      account,
      chainId: 84532,
      config: undefined as never,
      switchChain: async (target) => {
        actualEvents.push(`switch:${target}`);
      },
      writeFn: async () => {
        actualEvents.push("write");
        return hash;
      },
      fetchIndexerStatus: async () => {
        actualEvents.push("status:55");
        return { ok: true, blockNumber: 55 };
      },
      wait: async (ms) => {
        actualEvents.push(`wait:${ms}`);
      },
      onPhase: (phase) => actualEvents.push(`phase:${phase}`),
      confirmTransaction: async (_config, confirmedHash) => {
        actualEvents.push(`confirm:${confirmedHash}`);
        return receipt;
      },
      resolveTargetChainId: (value) => value,
    });

    assert.deepEqual(actual.indexerBarrier, { status: "observed" });
    assert.equal(actual.writeReference, legacy.receipt.transactionHash);
    assert.deepEqual(actualEvents, legacyEvents);
  });

  it("matches the legacy failure sequence when the write throws", async () => {
    const account = fixtureEvmAccount(84532);
    const legacyEvents: string[] = [];
    const actualEvents: string[] = [];

    await assert.rejects(
      () =>
        legacyRunEvmWriteLifecycle({
          account,
          chainId: 84532,
          switchChain: async (target) => {
            legacyEvents.push(`switch:${target}`);
          },
          writeFn: async () => {
            legacyEvents.push("write");
            throw new Error("boom");
          },
          fetchIndexerStatus: async () => {
            legacyEvents.push("status:unexpected");
            return { ok: false };
          },
          wait: async (ms) => {
            legacyEvents.push(`wait:${ms}`);
          },
          onPhase: (phase) => legacyEvents.push(`phase:${phase}`),
          confirmTransaction: async () => {
            legacyEvents.push("confirm:unexpected");
            throw new Error("unexpected");
          },
        }),
      /boom/,
    );

    await assert.rejects(
      () =>
        runEvmWriteLifecycle({
          account,
          chainId: 84532,
          config: undefined as never,
          switchChain: async (target) => {
            actualEvents.push(`switch:${target}`);
          },
          writeFn: async () => {
            actualEvents.push("write");
            throw new Error("boom");
          },
          fetchIndexerStatus: async () => {
            actualEvents.push("status:unexpected");
            return { ok: false };
          },
          wait: async (ms) => {
            actualEvents.push(`wait:${ms}`);
          },
          onPhase: (phase) => actualEvents.push(`phase:${phase}`),
          confirmTransaction: async () => {
            actualEvents.push("confirm:unexpected");
            throw new Error("unexpected");
          },
        }),
      /boom/,
    );

    assert.deepEqual(actualEvents, legacyEvents);
  });

  it("awaitWriteReceipt preserves the legacy confirming path", async () => {
    const account = fixtureEvmAccount(84532);
    const hash = `0x${"3".repeat(64)}` as const;
    const phases: string[] = [];
    const receipt = fakeReceipt(hash, 77n);
    const result = await awaitWriteReceipt({
      account,
      chainId: 84532,
      config: { wagmiConfig: undefined as never },
      hash,
      onPhase: (phase) => phases.push(phase),
      confirmTransaction: async (_config, confirmedHash) => {
        assert.equal(confirmedHash, hash);
        return receipt;
      },
    });
    assert.equal(result.transactionHash, hash);
    assert.deepEqual(phases, ["confirming"]);
  });

  it("preserves the minted-route outcome before and after normalization", async () => {
    const hash = `0x${"4".repeat(64)}` as const;
    const receipt = fakeReceipt(hash, 88n, [
      makePassportMintedLog(hash, 28764749040560770193485982315422230450798602n),
    ]);
    const legacy = mintedRouteForLegacyReceipt(receipt, 84532);
    const outcome = await runEvmWriteLifecycle({
      account: fixtureEvmAccount(84532),
      chainId: 84532,
      config: undefined as never,
      switchChain: async () => {},
      writeFn: async () => hash,
      fetchIndexerStatus: async () => ({ ok: true, blockNumber: 88 }),
      wait: async () => {},
      confirmTransaction: async () => receipt,
      resolveTargetChainId: (value) => value,
    });
    assert.equal(
      mintedRouteForWriteOutcome(outcome, 84532),
      legacy,
    );
  });

  it("preserves claim-credit detection for both claim surfaces after normalization", async () => {
    const hash = `0x${"5".repeat(64)}` as const;
    const account = fixtureEvmAccount(84532).address;
    const receipt = fakeReceipt(hash, 89n, [makeClaimRecordedLog(hash, account)]);
    const outcome = await runEvmWriteLifecycle({
      account: fixtureEvmAccount(84532),
      chainId: 84532,
      config: undefined as never,
      switchChain: async () => {},
      writeFn: async () => hash,
      fetchIndexerStatus: async () => ({ ok: true, blockNumber: 89 }),
      wait: async () => {},
      confirmTransaction: async () => receipt,
      resolveTargetChainId: (value) => value,
    });
    assert.equal(legacyClaimRecordedForAccount(receipt, account), true);
    assert.equal(claimRecordedForOutcome(outcome, account), true);
    assert.equal(claimRecordedForOutcome(outcome, "0x2222222222222222222222222222222222222222"), false);
  });

  it("preserves bridge guid propagation after normalization", async () => {
    const hash = `0x${"6".repeat(64)}` as const;
    const guid =
      "0x93f0463fc0cd85f24087e86d415447e74d56dd3d9f941c54968608b195e11670" as const;
    const receipt = fakeReceipt(hash, 90n, [makeOnftSentLog(hash, guid)]);
    const legacyGuid = onftSentGuidFromLogs(
      KarPassportBridgeGatewayAbi as Abi,
      receipt.logs,
    );
    const outcome = await runEvmWriteLifecycle({
      account: fixtureEvmAccount(84532),
      chainId: 84532,
      config: undefined as never,
      switchChain: async () => {},
      writeFn: async () => hash,
      fetchIndexerStatus: async () => ({ ok: true, blockNumber: 90 }),
      wait: async () => {},
      confirmTransaction: async () => receipt,
      resolveTargetChainId: (value) => value,
    });
    const actualGuid = outcome.bridgeSendGuid;
    assert.equal(actualGuid.ok, true);
    if (actualGuid.ok) {
      assert.equal(actualGuid.guid, legacyGuid);
    }
  });

  it("returns a named refusal when the minted fact is absent", async () => {
    const hash = `0x${"7".repeat(64)}` as const;
    const outcome = await runEvmWriteLifecycle({
      account: fixtureEvmAccount(84532),
      chainId: 84532,
      config: undefined as never,
      switchChain: async () => {},
      writeFn: async () => hash,
      fetchIndexerStatus: async () => ({ ok: true, blockNumber: 91 }),
      wait: async () => {},
      confirmTransaction: async () => fakeReceipt(hash, 91n),
      resolveTargetChainId: (value) => value,
    });
    assert.deepEqual(outcome.mintedPassportTokenId, {
      ok: false,
      cause: "missing_minted_passport",
    });
  });

  it("create-passport wizard maps missing minted fact to the existing parse-failure message", () => {
    const source = fs.readFileSync(CREATE_PASSPORT_WIZARD, "utf8");
    assert.match(source, /result\.mintedPassportTokenId/);
    assert.match(source, /missing_minted_passport/);
    assert.match(
      source,
      /Mint succeeded but token ID could not be read\. Check your wallet for the NFT\./,
    );
  });
});

describe("runWriteLifecycle dispatcher", () => {
  const svmRegistry = {
    [FIXTURE_SVM_NAMESPACE]: FIXTURE_SVM_STACK,
  } as const;

  it("selects the SVM sibling only via injected fixture registry", async () => {
    const tokenId = globalTokenId(FIXTURE_SVM_NAMESPACE, 77);
    const claimRecipient = encodeSvmPubkeyBytes(pubkey32FromSeed(7));
    const phases: string[] = [];
    let createConfirmPortCalls = 0;

    const result = await runWriteLifecycle({
      account: fixtureSvmAccount(),
      chainId: FIXTURE_SVM_NAMESPACE,
      config: { wagmiConfig: undefined as never },
      switchChain: async () => {
        throw new Error("switchChain should not run for SVM");
      },
      writeFn: async () => "svm-signature-1",
      fetchIndexerStatus: async () => ({ ok: true, blockNumber: 1 }),
      wait: async () => undefined,
      onPhase: (phase) => phases.push(phase),
      registry: svmRegistry,
      createConfirmPort: (stack) => {
        createConfirmPortCalls += 1;
        assert.equal(stack.namespace, FIXTURE_SVM_STACK.namespace);
        return {
          confirmSignature: async (signature) => ({ signature, slot: 123n }),
        };
      },
      fetchStructuredPayloads: async () => [
        svmPayload({
          discriminatorHex: PASSPORT_MINTED_DISC,
          body: buildPassportMintedBody({ tokenId }),
          eventName: "PassportMinted",
          contractName: "KarPassport",
        }),
        svmPayload({
          discriminatorHex: "2eb720503bab8ae0",
          body: buildClaimRecordedBody(7),
          eventName: "ClaimRecorded",
          contractName: "KarPassport",
        }),
        svmPayload({
          discriminatorHex: "b6f8fb5cdad3ab62",
          body: buildOnftSentBody({
            guid: `0x${"ab".repeat(32)}`,
            dstEid: 40161,
            tokenId,
          }),
          eventName: "ONFTSent",
          contractName: "KarPassportBridgeGateway",
        }),
      ],
    });

    assert.equal(createConfirmPortCalls, 1);
    assert.deepEqual(phases, ["wallet", "confirming", "indexing"]);
    assert.equal(result.writeReference, "svm-signature-1");
    assert.deepEqual(result.indexerBarrier, {
      status: "unavailable",
      cause: "svm_ingest_unavailable",
    });
    assert.deepEqual(result.claimRecipients, [claimRecipient]);
    assert.equal(writeOutcomeHasClaimRecipient(result, claimRecipient), true);
    assert.deepEqual(result.mintedPassportTokenId, {
      ok: true,
      tokenId: tokenId.toString(),
    });
    assert.deepEqual(result.bridgeSendGuid, {
      ok: true,
      guid: `0x${"ab".repeat(32)}`,
    });
  });

  it("live product registry now dispatches the SVM arm without fixture-only injection", async () => {
    const result = await runWriteLifecycle({
      account: fixtureSvmAccount(),
      chainId: FIXTURE_SVM_NAMESPACE,
      config: { wagmiConfig: undefined as never },
      switchChain: async () => undefined,
      writeFn: async () => "svm-signature-1",
      fetchIndexerStatus: async () => ({ ok: true, blockNumber: 1 }),
      wait: async () => undefined,
      createConfirmPort: () => ({
        confirmSignature: async (signature) => ({ signature, slot: 1n }),
      }),
      fetchStructuredPayloads: async () => [],
    });

    assert.equal(result.writeReference, "svm-signature-1");
    assert.deepEqual(result.indexerBarrier, {
      status: "unavailable",
      cause: "svm_ingest_unavailable",
    });
  });

  it("keeps EVM lagging distinct from SVM barrier unavailable", async () => {
    const evmHash = `0x${"4".repeat(64)}` as const;
    const evmOutcome = await runWriteLifecycle({
      account: fixtureEvmAccount(84532),
      chainId: 84532,
      config: { wagmiConfig: undefined as never },
      switchChain: async () => undefined,
      writeFn: async () => evmHash,
      fetchIndexerStatus: async () => ({ ok: true, blockNumber: 10 }),
      wait: async () => undefined,
      confirmTransaction: async () => fakeReceipt(evmHash, 11n),
      resolveTargetChainId: (chainId) => chainId,
    });

    const svmOutcome = await runWriteLifecycle({
      account: fixtureSvmAccount(),
      chainId: FIXTURE_SVM_NAMESPACE,
      config: { wagmiConfig: undefined as never },
      switchChain: async () => undefined,
      writeFn: async () => "svm-signature-1",
      fetchIndexerStatus: async () => ({ ok: true, blockNumber: 1 }),
      wait: async () => undefined,
      registry: svmRegistry,
      createConfirmPort: () => ({
        confirmSignature: async (signature) => ({ signature, slot: 1n }),
      }),
      fetchStructuredPayloads: async () => [],
    });

    assert.deepEqual(evmOutcome.indexerBarrier, { status: "lagging" });
    assert.deepEqual(svmOutcome.indexerBarrier, {
      status: "unavailable",
      cause: "svm_ingest_unavailable",
    });
    assert.notDeepEqual(evmOutcome.indexerBarrier, svmOutcome.indexerBarrier);
  });

  it("returns named SVM fact absences when program events do not carry them", async () => {
    const result = await runWriteLifecycle({
      account: fixtureSvmAccount(),
      chainId: FIXTURE_SVM_NAMESPACE,
      config: { wagmiConfig: undefined as never },
      switchChain: async () => undefined,
      writeFn: async () => "svm-signature-1",
      fetchIndexerStatus: async () => ({ ok: true, blockNumber: 1 }),
      wait: async () => undefined,
      registry: svmRegistry,
      createConfirmPort: () => ({
        confirmSignature: async (signature) => ({ signature, slot: 1n }),
      }),
      fetchStructuredPayloads: async () => [],
    });

    assert.deepEqual(result.mintedPassportTokenId, {
      ok: false,
      cause: "missing_minted_passport",
    });
    assert.deepEqual(result.bridgeSendGuid, {
      ok: false,
      cause: "missing_bridge_send_guid",
    });
  });
});
