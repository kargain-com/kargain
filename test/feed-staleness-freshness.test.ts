import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Hex, PublicClient } from "viem";

import {
  assertFeedFreshWithinTolerance,
  assertNuclearFeedsFresh,
  assertStalenessToleranceInBounds,
  getChainFeedConfig,
  MAX_FEED_STALENESS,
  MIN_FEED_STALENESS,
  ZERO_USDC_USD_FEED,
} from "../scripts/lib/chainlink-feeds.ts";

const FEED = "0x1111111111111111111111111111111111111111" as const;

function mockPublicClient(params: {
  bytecode?: Hex | null;
  answer?: bigint;
  updatedAt?: bigint;
  blockTimestamp?: bigint;
}): PublicClient {
  const bytecode = params.bytecode ?? "0x1234";
  const answer = params.answer ?? 100n * 10n ** 8n;
  const updatedAt = params.updatedAt ?? 1_000_000n;
  const blockTimestamp = params.blockTimestamp ?? updatedAt;

  return {
    getBytecode: async () => bytecode,
    readContract: async () =>
      [1n, answer, blockTimestamp, updatedAt, 1n] as const,
    getBlock: async () => ({ timestamp: blockTimestamp }),
  } as unknown as PublicClient;
}

describe("feed staleness freshness (chainlink-feeds)", () => {
  it("assertStalenessToleranceInBounds enforces FixedPrice governance window", () => {
    assert.throws(
      () => assertStalenessToleranceInBounds(MIN_FEED_STALENESS - 1, "test"),
      /outside FixedPrice bounds/,
    );
    assert.throws(
      () => assertStalenessToleranceInBounds(MAX_FEED_STALENESS + 1, "test"),
      /outside FixedPrice bounds/,
    );
    assert.doesNotThrow(() => assertStalenessToleranceInBounds(MIN_FEED_STALENESS, "test"));
    assert.doesNotThrow(() => assertStalenessToleranceInBounds(MAX_FEED_STALENESS, "test"));
  });

  it("assertFeedFreshWithinTolerance rejects zero feed address", async () => {
    await assert.rejects(
      assertFeedFreshWithinTolerance(
        mockPublicClient({}),
        ZERO_USDC_USD_FEED,
        3600,
        "zero feed",
      ),
      /cannot freshness-check zero feed/,
    );
  });

  it("assertFeedFreshWithinTolerance rejects missing bytecode", async () => {
    await assert.rejects(
      assertFeedFreshWithinTolerance(
        mockPublicClient({ bytecode: "0x" }),
        FEED,
        3600,
        "missing bytecode",
      ),
      /has no bytecode/,
    );
  });

  it("assertFeedFreshWithinTolerance rejects non-positive answer", async () => {
    await assert.rejects(
      assertFeedFreshWithinTolerance(
        mockPublicClient({ answer: 0n }),
        FEED,
        3600,
        "bad answer",
      ),
      /BadOracleAnswer/,
    );
  });

  it("assertFeedFreshWithinTolerance rejects stale round within tolerance", async () => {
    const now = 2_000_000n;
    const tolerance = 3600;
    await assert.rejects(
      assertFeedFreshWithinTolerance(
        mockPublicClient({
          updatedAt: now - BigInt(tolerance) - 1n,
          blockTimestamp: now,
        }),
        FEED,
        tolerance,
        "stale native",
        now,
      ),
      /StalePrice/,
    );
  });

  it("assertFeedFreshWithinTolerance passes fresh round", async () => {
    const now = 2_000_000n;
    const tolerance = 3600;
    const check = await assertFeedFreshWithinTolerance(
      mockPublicClient({
        updatedAt: now - BigInt(tolerance),
        blockTimestamp: now,
      }),
      FEED,
      tolerance,
      "fresh native",
      now,
    );
    assert.equal(check.stalenessTolerance, tolerance);
    assert.equal(check.ageSeconds, BigInt(tolerance));
    assert.ok(check.answer > 0n);
  });

  it("assertNuclearFeedsFresh checks native feed and skips zero USDC feed (84532)", async () => {
    const config = getChainFeedConfig(84532);
    assert.equal(config.usdcUsdFeed, ZERO_USDC_USD_FEED);
    const now = 3_000_000n;
    const checks = await assertNuclearFeedsFresh(
      mockPublicClient({
        updatedAt: now - BigInt(config.nativeUsdStalenessTolerance),
        blockTimestamp: now,
      }),
      config,
    );
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.label, `nativeUsdFeed chain ${config.chainId}`);
    assert.equal(checks[0]?.stalenessTolerance, config.nativeUsdStalenessTolerance);
  });

  it("assertNuclearFeedsFresh checks native + USDC feeds when USDC feed is non-zero", async () => {
    const config = getChainFeedConfig(11155111);
    assert.notEqual(config.usdcUsdFeed, ZERO_USDC_USD_FEED);
    const now = 4_000_000n;
    const checks = await assertNuclearFeedsFresh(
      mockPublicClient({
        updatedAt: now - 100n,
        blockTimestamp: now,
      }),
      config,
    );
    assert.equal(checks.length, 2);
    assert.equal(checks[0]?.label, `nativeUsdFeed chain ${config.chainId}`);
    assert.equal(checks[1]?.label, `usdcUsdFeed chain ${config.chainId}`);
    assert.equal(checks[1]?.stalenessTolerance, config.usdcUsdStalenessTolerance);
  });
});
