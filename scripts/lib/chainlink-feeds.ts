import { type PublicClient, getAddress, type Hex, type Abi } from "viem";

import {
  isCommercialEip155Id,
  type CommercialChainId,
} from "../../lib/web3/commercial-active.js";

export type CurrencyFeedEntry = {
  code: string;
  feed: `0x${string}`;
  /**
   * Seconds of allowed age when this currency feed is admitted via `setCurrencyFeed`.
   * Zero iff feed is zero. Must sit in FixedPrice [MIN_FEED_STALENESS, MAX_FEED_STALENESS].
   */
  stalenessTolerance: number;
};

export type ChainFeedConfig = {
  chainId: number;
  nativeUsdFeed: `0x${string}`;
  /**
   * Freshness window (seconds) for `nativeUsdFeed` at FixedPrice initialize /
   * `setNativeUsdStalenessTolerance`. Per-chain — ETH/USD heartbeats differ.
   */
  nativeUsdStalenessTolerance: number;
  usdc: `0x${string}`;
  /**
   * Chainlink USDC/USD aggregator for FixedPrice fiat conversion.
   * `0x0…0` means none — Nuclear still admits USDC with feed=0 (asset-only);
   * fiat opens are refused on-chain (`PaymentTokenFeedRequired`). Never invent a feed.
   */
  usdcUsdFeed: `0x${string}`;
  /**
   * Freshness window for USDC/USD at `approvePaymentToken`. Zero iff `usdcUsdFeed` is zero.
   * Derived via `deriveFeedStalenessTolerance` (P4 rule).
   */
  usdcUsdStalenessTolerance: number;
  currencies: CurrencyFeedEntry[];
};

/**
 * Governance bounds — mirrored from FixedPriceConsignment.
 * MIN: below this, block-time / RPC skew dominate.
 * MAX: must admit `FEED_STALENESS_MULTIPLIER × max(observedMax, publishedHeartbeat)`
 * for the longest commercial feeds (daily USDC/FX). Raised 48h → 72h because 48h was
 * exactly 2×86400 with zero slack when observed gap exceeds published heartbeat.
 */
export const MIN_FEED_STALENESS = 60;
export const MAX_FEED_STALENESS = 259_200;

/**
 * Single multiplier for every feed (P4 derivation rule).
 * One quiet period is expected at `max(obs, hb)`; a second covers one delayed
 * publication without refusing trade. Deviation-triggered updates still arrive
 * on depeg regardless of tolerance width — so generosity on stables is safer
 * than a thin margin that fails on silence.
 */
export const FEED_STALENESS_MULTIPLIER = 2;

/**
 * `tolerance = FEED_STALENESS_MULTIPLIER × max(observedMaxInterRoundGap, publishedHeartbeat)`.
 * Observed max is a floor (quiet-period sample), not the estimate alone.
 * Published heartbeat from Chainlink reference-data directory.
 * Result must sit in [MIN_FEED_STALENESS, MAX_FEED_STALENESS] — if it does not,
 * raise MAX (or change the rule); never hand-clamp a single feed.
 */
export function deriveFeedStalenessTolerance(
  observedMaxInterRoundGapSeconds: number,
  publishedHeartbeatSeconds: number,
): number {
  if (
    !Number.isFinite(observedMaxInterRoundGapSeconds) ||
    !Number.isFinite(publishedHeartbeatSeconds) ||
    observedMaxInterRoundGapSeconds < 0 ||
    publishedHeartbeatSeconds <= 0
  ) {
    throw new Error(
      `deriveFeedStalenessTolerance: invalid inputs obs=${observedMaxInterRoundGapSeconds} hb=${publishedHeartbeatSeconds}`,
    );
  }
  const base = Math.max(
    Math.ceil(observedMaxInterRoundGapSeconds),
    Math.ceil(publishedHeartbeatSeconds),
  );
  const tolerance = FEED_STALENESS_MULTIPLIER * base;
  assertStalenessToleranceInBounds(tolerance, "deriveFeedStalenessTolerance");
  return tolerance;
}

/**
 * Committed Chainlink proxy addresses — bytecode verified at deploy via RPC.
 * Tolerances from P4 rule (probe + directory 2026-07-30) — see deriveFeedStalenessTolerance.
 * Mainnet rows (1, 8453) are configuration only; Nuclear deploy stays
 * `isCommercialEip155Id` → 84532 | 11155111 (§7.6 / commercial allowlist).
 */
export const CHAINLINK_FEEDS: Record<number, ChainFeedConfig> = {
  84532: {
    chainId: 84532,
    nativeUsdFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
    // obs max 1222s, published hb 1200s → 2×1222 = 2444 (obs governs).
    nativeUsdStalenessTolerance: 2444,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    // No Chainlink USDC/USD aggregator on Base Sepolia (RPC-probed 2026-07-30:
    // mainnet Base feed, Eth Sepolia feed, and claimed Base Sepolia candidates
    // all have no bytecode on 84532; ETH/USD + BTC/USD feeds respond).
    usdcUsdFeed: "0x0000000000000000000000000000000000000000",
    usdcUsdStalenessTolerance: 0,
    currencies: [
      {
        code: "USD",
        feed: "0x0000000000000000000000000000000000000000",
        stalenessTolerance: 0,
      },
    ],
  },
  11155111: {
    chainId: 11155111,
    nativeUsdFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    // obs max 3696s, published hb 3600s → 2×3696 = 7392 (obs governs).
    nativeUsdStalenessTolerance: 7392,
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    usdcUsdFeed: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
    // obs max 86496s, published hb 86400s → 2×86496 = 172992 (obs governs).
    usdcUsdStalenessTolerance: 172_992,
    currencies: [
      {
        code: "USD",
        feed: "0x0000000000000000000000000000000000000000",
        stalenessTolerance: 0,
      },
      {
        code: "EUR",
        feed: "0x1a81afB8146aeFfCFc5E50e8479e826E7D55b910",
        // obs 86484, hb 86400 → 172968.
        stalenessTolerance: 172_968,
      },
      {
        code: "GBP",
        feed: "0x91FAB41F5f3bE955963a986366edAcff1aaeaa83",
        // obs 86496, hb 86400 → 172992.
        stalenessTolerance: 172_992,
      },
      {
        code: "JPY",
        feed: "0x8A6af2B75F23831ADc973ce6288e5329F63D86c6",
        // obs 86496, hb 86400 → 172992.
        stalenessTolerance: 172_992,
      },
    ],
  },
  80002: {
    chainId: 80002,
    nativeUsdFeed: "0x001382149eBa3441043c1c66972b4772963f5D43",
    // Non-commercial; P4 inputs not probed this pass — do not copy as a template.
    nativeUsdStalenessTolerance: 3600,
    usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    usdcUsdFeed: "0x0000000000000000000000000000000000000000",
    usdcUsdStalenessTolerance: 0,
    currencies: [
      {
        code: "USD",
        feed: "0x0000000000000000000000000000000000000000",
        stalenessTolerance: 0,
      },
    ],
  },
  8453: {
    chainId: 8453,
    nativeUsdFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    // obs max 1230s, published hb 1200s → 2×1230 = 2460 (obs governs).
    nativeUsdStalenessTolerance: 2460,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    usdcUsdFeed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B",
    // obs max 86434s, published hb 86400s → 2×86434 = 172868 (obs governs).
    usdcUsdStalenessTolerance: 172_868,
    currencies: [
      {
        code: "USD",
        feed: "0x0000000000000000000000000000000000000000",
        stalenessTolerance: 0,
      },
      {
        code: "EUR",
        feed: "0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F",
        // obs 3632, hb 3600 → 7264.
        stalenessTolerance: 7264,
      },
      {
        code: "GBP",
        // Directory proxy (prior address had no bytecode on Base).
        feed: "0xCceA6576904C118037695eB71195a5425E69Fa15",
        // obs 86430, hb 86400 → 172860.
        stalenessTolerance: 172_860,
      },
      {
        code: "CAD",
        feed: "0xA840145F87572E82519d578b1F36340368a25D5d",
        // obs 3632, hb 3600 → 7264.
        stalenessTolerance: 7264,
      },
      // No Chainlink AUD/USD aggregator committed on Base (left zero).
      {
        code: "AUD",
        feed: "0x0000000000000000000000000000000000000000",
        stalenessTolerance: 0,
      },
    ],
  },
  1: {
    chainId: 1,
    nativeUsdFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
    // obs max 3660s, published hb 3600s → 2×3660 = 7320 (obs governs).
    nativeUsdStalenessTolerance: 7320,
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    usdcUsdFeed: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
    // obs max 82848s, published hb 82800s → 2×82848 = 165696 (obs governs).
    usdcUsdStalenessTolerance: 165_696,
    currencies: [
      {
        code: "USD",
        feed: "0x0000000000000000000000000000000000000000",
        stalenessTolerance: 0,
      },
    ],
  },
};

/** LayerZero EndpointV2 — EVM hex per commercial EIP-155 (values follow VM; map is not the commercial definition). */
export const LZ_ENDPOINT_V2_BY_CHAIN: {
  readonly [K in CommercialChainId]: `0x${string}`;
} = {
  84532: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  11155111: "0x6EDCE65403992e310A62460808c4b910D972f10f",
};

export function lzEndpointForChain(chainId: number): `0x${string}` {
  if (!isCommercialEip155Id(chainId)) {
    throw new Error(`No LayerZero EndpointV2 map for chainId ${chainId}`);
  }
  return getAddress(LZ_ENDPOINT_V2_BY_CHAIN[chainId]);
}

export function currencyCodeBytes32(code: string): Hex {
  const padded = code.padEnd(32, "\0");
  let hex = "0x";
  for (let i = 0; i < padded.length; i++) {
    hex += padded.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex as Hex;
}

export async function verifyFeedBytecode(
  publicClient: PublicClient,
  feed: `0x${string}`,
): Promise<boolean> {
  if (feed === "0x0000000000000000000000000000000000000000") return true;
  const bytecode = await publicClient.getBytecode({ address: feed });
  return Boolean(bytecode && bytecode !== "0x");
}

export async function filterLiveFeeds(
  publicClient: PublicClient,
  config: ChainFeedConfig,
): Promise<CurrencyFeedEntry[]> {
  const nativeOk = await verifyFeedBytecode(publicClient, config.nativeUsdFeed);
  if (!nativeOk) {
    throw new Error(`Native USD feed has no bytecode on chain ${config.chainId}: ${config.nativeUsdFeed}`);
  }

  const live: CurrencyFeedEntry[] = [];
  for (const entry of config.currencies) {
    if (entry.code === "USD" || entry.code === "NATIVE") {
      live.push(entry);
      continue;
    }
    if (entry.feed === "0x0000000000000000000000000000000000000000") continue;
    if (await verifyFeedBytecode(publicClient, entry.feed)) {
      live.push(entry);
    }
  }
  return live;
}

export function getChainFeedConfig(chainId: number): ChainFeedConfig {
  const config = CHAINLINK_FEEDS[chainId];
  if (!config) throw new Error(`No Chainlink feed map for chainId ${chainId}`);
  const zero = "0x0000000000000000000000000000000000000000";
  return {
    ...config,
    nativeUsdFeed: getAddress(config.nativeUsdFeed),
    usdc: getAddress(config.usdc),
    usdcUsdFeed:
      config.usdcUsdFeed === zero ? zero : getAddress(config.usdcUsdFeed),
    currencies: config.currencies.map((c) => ({
      ...c,
      feed: c.feed === zero ? c.feed : getAddress(c.feed),
    })),
  };
}

export const ZERO_USDC_USD_FEED =
  "0x0000000000000000000000000000000000000000" as const;

/**
 * Exact deploy/dry-run limitation line when Nuclear admits USDC with feed=0.
 * Must stay visible — never treat zero as a silent $1 peg.
 */
export function usdcFiatUnavailableAnnouncement(chainId: number): string {
  return (
    `Fiat-denominated sales in USDC are unavailable on chain ${chainId}: ` +
    `no USDC/USD Chainlink aggregator is configured (usdcUsdFeed is zero). ` +
    `Asset-denominated USDC sales remain available. ` +
    `Timelock may later approvePaymentToken with a non-zero feed and its stalenessTolerance; ` +
    `once a non-zero feed is set, the feed cannot be cleared.`
  );
}

export type UsdcUsdFeedAdmitResolution = {
  feed: `0x${string}`;
  stalenessTolerance: number;
  /** Non-null when admitting with zero feed — deploy/dry-run must print this. */
  fiatLimitation: string | null;
};

/**
 * Nuclear FixedPrice USDC admit resolution.
 * Non-zero feed → admit with measured oracle + per-feed tolerance.
 * Zero feed → admit asset-only (tolerance 0) and announce the fiat limitation.
 */
export function resolveUsdcUsdFeedForAdmit(
  config: Pick<ChainFeedConfig, "usdcUsdFeed" | "usdcUsdStalenessTolerance" | "chainId">,
): UsdcUsdFeedAdmitResolution {
  if (config.usdcUsdFeed.toLowerCase() === ZERO_USDC_USD_FEED) {
    if (config.usdcUsdStalenessTolerance !== 0) {
      throw new Error(
        `usdcUsdStalenessTolerance must be 0 when usdcUsdFeed is zero (chain ${config.chainId})`,
      );
    }
    return {
      feed: ZERO_USDC_USD_FEED,
      stalenessTolerance: 0,
      fiatLimitation: usdcFiatUnavailableAnnouncement(config.chainId),
    };
  }
  assertStalenessToleranceInBounds(config.usdcUsdStalenessTolerance, "usdcUsdStalenessTolerance");
  return {
    feed: getAddress(config.usdcUsdFeed),
    stalenessTolerance: config.usdcUsdStalenessTolerance,
    fiatLimitation: null,
  };
}

export function assertStalenessToleranceInBounds(
  tolerance: number,
  label: string,
): void {
  if (
    !Number.isInteger(tolerance) ||
    tolerance < MIN_FEED_STALENESS ||
    tolerance > MAX_FEED_STALENESS
  ) {
    throw new Error(
      `${label}=${tolerance} outside FixedPrice bounds [${MIN_FEED_STALENESS}, ${MAX_FEED_STALENESS}]`,
    );
  }
}

const AGGREGATOR_LATEST_ROUND_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const satisfies Abi;

export type FeedFreshnessCheck = {
  feed: `0x${string}`;
  label: string;
  stalenessTolerance: number;
  updatedAt: bigint;
  ageSeconds: bigint;
  answer: bigint;
};

/**
 * Fail-closed dry-run / pre-admit check: feed must be fresh within its configured
 * tolerance (not merely present). Mirrors FixedPrice `_checkFeedFresh`.
 */
export async function assertFeedFreshWithinTolerance(
  publicClient: PublicClient,
  feed: `0x${string}`,
  stalenessTolerance: number,
  label: string,
  nowSeconds?: bigint,
): Promise<FeedFreshnessCheck> {
  if (feed === ZERO_USDC_USD_FEED) {
    throw new Error(`${label}: cannot freshness-check zero feed`);
  }
  assertStalenessToleranceInBounds(stalenessTolerance, label);
  const bytecode = await publicClient.getBytecode({ address: feed });
  if (!bytecode || bytecode === "0x") {
    throw new Error(`${label}: feed ${feed} has no bytecode`);
  }
  const round = await publicClient.readContract({
    address: feed,
    abi: AGGREGATOR_LATEST_ROUND_ABI,
    functionName: "latestRoundData",
  });
  const answer = round[1];
  const updatedAt = round[3];
  if (answer <= 0n) {
    throw new Error(`${label}: feed ${feed} BadOracleAnswer (answer=${answer})`);
  }
  const now =
    nowSeconds ??
    BigInt(
      (await publicClient.getBlock({ blockTag: "latest" })).timestamp,
    );
  const age = now - updatedAt;
  if (age > BigInt(stalenessTolerance)) {
    throw new Error(
      `${label}: StalePrice — feed ${feed} age ${age}s exceeds stalenessTolerance ${stalenessTolerance}s ` +
        `(updatedAt=${updatedAt}, now=${now})`,
    );
  }
  return {
    feed: getAddress(feed),
    label,
    stalenessTolerance,
    updatedAt,
    ageSeconds: age,
    answer,
  };
}

/**
 * Nuclear dry-run: verify every non-zero feed we will admit against its own tolerance.
 */
export async function assertNuclearFeedsFresh(
  publicClient: PublicClient,
  config: ChainFeedConfig,
): Promise<FeedFreshnessCheck[]> {
  assertStalenessToleranceInBounds(
    config.nativeUsdStalenessTolerance,
    "nativeUsdStalenessTolerance",
  );
  const checks: FeedFreshnessCheck[] = [];
  checks.push(
    await assertFeedFreshWithinTolerance(
      publicClient,
      config.nativeUsdFeed,
      config.nativeUsdStalenessTolerance,
      `nativeUsdFeed chain ${config.chainId}`,
    ),
  );
  const usdcAdmit = resolveUsdcUsdFeedForAdmit(config);
  if (usdcAdmit.feed !== ZERO_USDC_USD_FEED) {
    checks.push(
      await assertFeedFreshWithinTolerance(
        publicClient,
        usdcAdmit.feed,
        usdcAdmit.stalenessTolerance,
        `usdcUsdFeed chain ${config.chainId}`,
      ),
    );
  }
  return checks;
}
