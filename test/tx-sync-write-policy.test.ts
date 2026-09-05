import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const COMPONENTS = path.join(ROOT, "components");
const HOOKS = path.join(ROOT, "hooks");

/** Sole owners of React Query invalidation after a synced write. */
const INVALIDATE_ALLOWLIST = new Set([
  path.join(HOOKS, "use-tx-sync.ts"),
]);

/** Sole owner of post-truth `router.refresh` (via `syncReads`). */
const ROUTER_REFRESH_ALLOWLIST = new Set([
  path.join(HOOKS, "use-tx-sync.ts"),
]);

const TX_SYNC_HOOK = path.join(HOOKS, "use-tx-sync.ts");

const TX_SYNC_EVM_SPECIFICS = [
  /\buseConfig\b/,
  /\bconfirmEvmTransaction\b/,
  /\bwaitForTransactionReceipt\b/,
  /\bTransactionReceipt\b/,
  /\bwagmiChainId\b/,
  /\btxWriteAvailability\b/,
  /\btxWriteRefusalMessage\b/,
  /\bwalletChainId\b/,
  /\bisEvmTxHash\b/,
] as const;

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsxFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("tx-sync write policy", () => {
  it("use-tx-sync stays free of direct EVM sequencing specifics", () => {
    const text = fs.readFileSync(TX_SYNC_HOOK, "utf8");
    for (const pattern of TX_SYNC_EVM_SPECIFICS) {
      assert.doesNotMatch(text, pattern, `use-tx-sync must not match ${pattern}`);
    }
    assert.match(text, /\brunEvmWriteLifecycle\b/);
    assert.match(text, /\bawaitEvmWriteReceipt\b/);
  });

  it("constructed dirty hook import is red for wagmi / receipt / hash-shape specifics", () => {
    const dirty = `
import { useConfig } from "wagmi";
import type { TransactionReceipt } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import { confirmEvmTransaction } from "@/lib/web3/evm-tx-confirm";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { txWriteAvailability, txWriteRefusalMessage } from "@/lib/web3/tx-write-availability";
const walletChainId = 1;
const target = wagmiChainId(84532);
function isEvmTxHash(value: string) { return value.startsWith("0x"); }
void waitForTransactionReceipt;
void confirmEvmTransaction;
void TransactionReceipt;
void txWriteAvailability;
void txWriteRefusalMessage;
void target;
`;
    for (const pattern of TX_SYNC_EVM_SPECIFICS) {
      assert.match(dirty, pattern);
    }
  });

  it("requires useTxSync in every component that calls writeContractAsync", () => {
    const missing: string[] = [];
    for (const file of listTsxFiles(COMPONENTS)) {
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes("writeContractAsync(")) continue;
      if (!text.includes("useTxSync")) {
        missing.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(missing, []);
  });

  it("forbids panel/hook invalidateQueries outside useTxSync", () => {
    const violations: string[] = [];
    for (const dir of [COMPONENTS, HOOKS]) {
      for (const file of listTsxFiles(dir)) {
        if (INVALIDATE_ALLOWLIST.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (text.includes("invalidateQueries(")) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("forbids bare router.refresh outside useTxSync.syncReads", () => {
    const violations: string[] = [];
    for (const dir of [COMPONENTS, HOOKS]) {
      for (const file of listTsxFiles(dir)) {
        if (ROUTER_REFRESH_ALLOWLIST.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (text.includes("router.refresh(")) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("bridge transit catch-up consumes useTxSync.syncReads (no parallel invalidate)", () => {
    const transitHook = path.join(HOOKS, "use-bridge-transit.ts");
    const text = fs.readFileSync(transitHook, "utf8");
    assert.match(text, /useTxSync/);
    assert.match(text, /syncReads/);
    assert.match(text, /getPassportDetailLive/);
    assert.match(text, /isBridgeDestinationCustodyIndexed/);
    assert.match(text, /pollUntil/);
    assert.equal(text.includes("invalidateQueries("), false);
    assert.equal(text.includes("location.reload"), false);

    const bridgeHook = path.join(HOOKS, "use-bridge.ts");
    const bridgeText = fs.readFileSync(bridgeHook, "utf8");
    assert.equal(bridgeText.includes('| "delivered"'), false);
    assert.equal(bridgeText.includes('setPhase("delivered")'), false);
    assert.match(bridgeText, /indexer_catchup/);
    assert.match(bridgeText, /setPhase\("idle"\)/);
  });

  it("passport indexer entity catch-up consumes useTxSync.syncReads", () => {
    const hook = path.join(HOOKS, "use-passport-indexer-sync.ts");
    const text = fs.readFileSync(hook, "utf8");
    assert.match(text, /useTxSync/);
    assert.match(text, /syncReads/);
    assert.match(text, /getPassportDetailLive/);
    assert.match(text, /INDEXER_SYNC_INTERVAL_MS/);
    assert.match(text, /INDEXER_SYNC_MAX_ATTEMPTS/);
    assert.equal(text.includes("router.refresh("), false);
    assert.equal(text.includes("KAR_PRO_VERIFIER_POLL"), false);
  });

  it("sole updateTag / revalidateTag owner is revalidate-indexer-cache action", () => {
    const allow = path.join(ROOT, "app/actions/revalidate-indexer-cache.ts");
    const violations: string[] = [];
    for (const dir of [
      path.join(ROOT, "app"),
      path.join(ROOT, "lib"),
      path.join(ROOT, "hooks"),
      path.join(ROOT, "components"),
    ]) {
      if (!fs.existsSync(dir)) continue;
      for (const file of listTsxFiles(dir)) {
        if (file === allow) continue;
        const text = fs.readFileSync(file, "utf8");
        if (text.includes("updateTag(") || text.includes("revalidateTag(")) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
    const owner = fs.readFileSync(allow, "utf8");
    assert.match(owner, /updateTag\(/);
    assert.match(owner, /INDEXER_QUERY_KEY_PREFIXES/);
  });

  it("syncReads invokes revalidateIndexerCache before refresh", () => {
    const text = fs.readFileSync(path.join(HOOKS, "use-tx-sync.ts"), "utf8");
    assert.match(text, /revalidateIndexerCache/);
    assert.ok(
      text.indexOf("revalidateIndexerCache") < text.indexOf("router.refresh()"),
    );
  });

  it("does not resurrect auction post-tx dual-path symbols", () => {
    const banned = [/auctionChainQueryKey/, /invalidateAfterTx/];
    const hits: string[] = [];
    for (const dir of [COMPONENTS, HOOKS]) {
      for (const file of listTsxFiles(dir)) {
        const text = fs.readFileSync(file, "utf8");
        for (const re of banned) {
          if (re.test(text)) {
            hits.push(`${path.relative(ROOT, file)}: ${re.source}`);
          }
        }
      }
    }
    assert.deepEqual(hits, []);
  });
});
