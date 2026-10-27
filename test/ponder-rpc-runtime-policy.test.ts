/**
 * Policy: commercial Ponder chains take ethGetLogsBlockRange + rpc list from env;
 * no URL literal fallback; no maxRequestsPerSecond.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPonderRuntime,
  resolveCommercialRpcUrls,
  resolveGetLogsBlockRange,
} from "../scripts/lib/ponder-env.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PONDER_ENV = join(ROOT, "scripts/lib/ponder-env.ts");

const HUB = 84532;
const SPOKE = 11155111;

function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  const keys = Object.keys(env);
  const prior = new Map<string, string | undefined>();
  for (const k of keys) {
    prior.set(k, process.env[k]);
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Ensure local-only paths stay off unless the test sets them.
  const localKeys = ["PONDER_ENABLE_LOCAL", "PONDER_LOCAL_ONLY"] as const;
  for (const k of localKeys) {
    if (!(k in env)) {
      prior.set(k, process.env[k]);
      delete process.env[k];
    }
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of prior) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function commercialEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    [`PONDER_RPC_URLS_${HUB}`]: "https://base-sepolia.gateway.tenderly.co",
    [`PONDER_RPC_URLS_${SPOKE}`]: "https://rpc.sepolia.ethpandaops.io",
    [`PONDER_GETLOGS_BLOCK_RANGE_${HUB}`]: "50000",
    [`PONDER_GETLOGS_BLOCK_RANGE_${SPOKE}`]: "30000",
    ...extra,
  } as NodeJS.ProcessEnv;
}

describe("ponder-rpc-runtime-policy", () => {
  it("commercial chains expose numeric ethGetLogsBlockRange and rpc string[] from env", () => {
    withEnv(commercialEnv(), () => {
      const { chains } = buildPonderRuntime();
      assert.ok(chains.baseSepolia);
      assert.ok(chains.ethereumSepolia);
      assert.equal(chains.baseSepolia.ethGetLogsBlockRange, 50000);
      assert.equal(chains.ethereumSepolia.ethGetLogsBlockRange, 30000);
      assert.deepEqual(chains.baseSepolia.rpc, [
        "https://base-sepolia.gateway.tenderly.co",
      ]);
      assert.deepEqual(chains.ethereumSepolia.rpc, [
        "https://rpc.sepolia.ethpandaops.io",
      ]);
      assert.equal(
        "maxRequestsPerSecond" in chains.baseSepolia,
        false,
      );
      assert.equal(
        "maxRequestsPerSecond" in chains.ethereumSepolia,
        false,
      );
    });
  });

  it("negative: missing getLogs window refuses by name", () => {
    assert.throws(
      () =>
        resolveGetLogsBlockRange(HUB, {
          [`PONDER_GETLOGS_BLOCK_RANGE_${HUB}`]: undefined,
        } as NodeJS.ProcessEnv),
      /missing_getlogs_block_range/,
    );
    assert.throws(
      () =>
        resolveGetLogsBlockRange(HUB, {
          [`PONDER_GETLOGS_BLOCK_RANGE_${HUB}`]: "0",
        } as NodeJS.ProcessEnv),
      /missing_getlogs_block_range/,
    );
  });

  it("negative: missing or empty RPC list refuses by name", () => {
    assert.throws(
      () =>
        resolveCommercialRpcUrls(HUB, {
          [`PONDER_RPC_URLS_${HUB}`]: undefined,
        } as NodeJS.ProcessEnv),
      /missing_rpc_urls/,
    );
    assert.throws(
      () =>
        resolveCommercialRpcUrls(HUB, {
          [`PONDER_RPC_URLS_${HUB}`]: "  ,  , ",
        } as NodeJS.ProcessEnv),
      /empty_rpc_urls/,
    );
  });

  it("negative: duplicate URL refuses by name", () => {
    assert.throws(
      () =>
        resolveCommercialRpcUrls(HUB, {
          [`PONDER_RPC_URLS_${HUB}`]:
            "https://a.example/rpc,https://a.example/rpc",
        } as NodeJS.ProcessEnv),
      /duplicate_rpc_url/,
    );
  });

  it("negative: ponder-env has no URL literal fallback for commercial RPC", () => {
    const src = readFileSync(PONDER_ENV, "utf8");
    assert.equal(
      /base-sepolia-rpc\.publicnode\.com/.test(src),
      false,
      "no publicnode Base fallback literal",
    );
    assert.equal(
      /ethereum-sepolia-rpc\.publicnode\.com/.test(src),
      false,
      "no publicnode Eth fallback literal",
    );
    assert.equal(
      /ETHEREUM_SEPOLIA_PUBLIC_RPC/.test(src),
      false,
      "no ETHEREUM_SEPOLIA_PUBLIC_RPC duplicate in ponder-env",
    );
    assert.equal(
      /PONDER_RPC_URL_84532|PONDER_RPC_URL_11155111/.test(src),
      false,
      "no singular commercial PONDER_RPC_URL_*",
    );
    assert.equal(
      /\?\?[\s\n]*["']https:\/\//.test(src),
      false,
      "no ?? https URL fallback",
    );
  });

  it("negative: maxRequestsPerSecond and ponder-max-rps are gone", () => {
    const src = readFileSync(PONDER_ENV, "utf8");
    assert.equal(/maxRequestsPerSecond/.test(src), false);
    assert.equal(/ponder-max-rps/.test(src), false);
    assert.equal(/PONDER_MAX_RPS_/.test(src), false);
    assert.throws(
      () => readFileSync(join(ROOT, "scripts/lib/ponder-max-rps.ts")),
      /ENOENT/,
    );
  });
});
