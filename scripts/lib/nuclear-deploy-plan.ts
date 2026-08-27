/**
 * Pure nuclear deploy plan — shared protocol params on 84532 and 11155111.
 * External addresses + per-feed staleness tolerances from CHAINLINK_FEEDS.
 */

import { getAddress } from "viem";

import {
  commercialEip155Ids,
  isCommercialChainId,
  type CommercialChainId,
} from "../../lib/web3/commercial-active.js";
import {
  CHAINLINK_FEEDS,
  getChainFeedConfig,
  lzEndpointForChain,
  LZ_ENDPOINT_V2_BY_CHAIN,
} from "./chainlink-feeds.js";
import {
  AUCTION_PLATFORM_FEE_BPS,
  DISPUTE_DEPOSIT,
  MARKETPLACE_FEE_BPS,
} from "./verify-constructor-args.js";
import { SEPOLIA_FALLBACK } from "./load-deployment.js";

/** USD-only: no setCurrencyFeed for non-USD entries even when live in CHAINLINK_FEEDS. */
export type NuclearRegistryPolicy = "usd-only";

export const NUCLEAR_DEPLOY_STEPS = [
  "Timelock48h",
  "KarProPass",
  "KarProStaking",
  "setStaking",
  "KarPassport",
  "FixedPriceConsignmentImpl",
  "FixedPriceConsignmentProxy",
  "AscendingHoldLib",
  "AscendingOpenLib",
  "AscendingConsignmentImpl",
  "AscendingConsignmentProxy",
  "addEncumbranceSourceFixedPrice",
  "addEncumbranceSourceAscending",
  "approvePaymentTokenFixedPrice",
  "approvePaymentTokenAscending",
  "KarPassportBridgeGateway",
  "setBridgeGateway",
  "transferFixedPriceOwnership",
  "transferAscendingOwnership",
  "transferPassportOwnership",
  "transferStakingOwnership",
] as const;

export type NuclearDeployStep = (typeof NUCLEAR_DEPLOY_STEPS)[number];

export type NuclearDeployPlan = {
  chainId: CommercialChainId;
  tokenIdOffset: bigint;
  registry: NuclearRegistryPolicy;
  steps: readonly NuclearDeployStep[];
  /** Shared protocol params — must match across commercial chains. */
  params: {
    disputeDeposit: bigint;
    /** FixedPriceConsignment platform fee bps (commerce cutover Phase 1: modes-only). */
    marketplaceFeeBps: bigint;
    /** AscendingConsignment platform fee bps (commerce cutover Phase 1: modes-only). */
    auctionPlatformFeeBps: bigint;
    platformRecipient: `0x${string}`;
  };
  /** Chain-specific externals — only from verified tables (incl. per-feed tolerances). */
  externals: {
    usdc: `0x${string}`;
    /** FixedPrice payment-token feed; zero → admit asset-only + announce fiat unavailable. */
    usdcUsdFeed: `0x${string}`;
    /** Seconds; 0 iff usdcUsdFeed is zero. */
    usdcUsdStalenessTolerance: number;
    nativeUsdFeed: `0x${string}`;
    /** Seconds for native USD feed at FixedPrice initialize. */
    nativeUsdStalenessTolerance: number;
    layerZeroEndpoint: `0x${string}`;
  };
};

export function buildNuclearDeployPlan(chainId: number): NuclearDeployPlan {
  if (!isCommercialChainId(chainId)) {
    throw new Error(
      `Nuclear deploy only supports commercial EIP-155 ids (${commercialEip155Ids().join("|")}), got ${chainId}`,
    );
  }

  const feedConfig = getChainFeedConfig(chainId);
  const table = CHAINLINK_FEEDS[chainId];
  if (!table) {
    throw new Error(`CHAINLINK_FEEDS missing chainId ${chainId}`);
  }

  return {
    chainId,
    tokenIdOffset: BigInt(chainId) << 128n,
    registry: "usd-only",
    steps: NUCLEAR_DEPLOY_STEPS,
    params: {
      disputeDeposit: DISPUTE_DEPOSIT,
      marketplaceFeeBps: MARKETPLACE_FEE_BPS,
      auctionPlatformFeeBps: AUCTION_PLATFORM_FEE_BPS,
      platformRecipient: getAddress(SEPOLIA_FALLBACK.platformRecipient),
    },
    externals: {
      usdc: getAddress(feedConfig.usdc),
      usdcUsdFeed: feedConfig.usdcUsdFeed,
      usdcUsdStalenessTolerance: feedConfig.usdcUsdStalenessTolerance,
      nativeUsdFeed: getAddress(feedConfig.nativeUsdFeed),
      nativeUsdStalenessTolerance: feedConfig.nativeUsdStalenessTolerance,
      layerZeroEndpoint: lzEndpointForChain(chainId),
    },
  };
}

/** Fail if shared protocol params / registry / step order differ. Externals may differ by chain. */
export function assertNuclearParamParity(
  a: NuclearDeployPlan,
  b: NuclearDeployPlan,
): void {
  if (a.registry !== b.registry) {
    throw new Error(`registry mismatch: ${a.registry} vs ${b.registry}`);
  }
  if (a.steps.length !== b.steps.length || a.steps.some((s, i) => s !== b.steps[i])) {
    throw new Error("deploy step list mismatch between commercial chains");
  }
  const keys = Object.keys(a.params) as (keyof NuclearDeployPlan["params"])[];
  for (const key of keys) {
    const left = a.params[key];
    const right = b.params[key];
    if (typeof left === "bigint" && typeof right === "bigint") {
      if (left !== right) throw new Error(`param ${key}: ${left} vs ${right}`);
    } else if (String(left).toLowerCase() !== String(right).toLowerCase()) {
      throw new Error(`param ${key}: ${left} vs ${right}`);
    }
  }
}

/** True when every external address equals the committed table entry for that chain. */
export function externalsMatchTables(plan: NuclearDeployPlan): boolean {
  const { chainId, externals } = plan;
  const feeds = CHAINLINK_FEEDS[chainId];
  return (
    externals.usdc.toLowerCase() === feeds.usdc.toLowerCase() &&
    externals.usdcUsdFeed.toLowerCase() === feeds.usdcUsdFeed.toLowerCase() &&
    externals.usdcUsdStalenessTolerance === feeds.usdcUsdStalenessTolerance &&
    externals.nativeUsdFeed.toLowerCase() === feeds.nativeUsdFeed.toLowerCase() &&
    externals.nativeUsdStalenessTolerance === feeds.nativeUsdStalenessTolerance &&
    externals.layerZeroEndpoint.toLowerCase() ===
      LZ_ENDPOINT_V2_BY_CHAIN[chainId].toLowerCase()
  );
}

export function formatNuclearParityTable(
  base: NuclearDeployPlan,
  eth: NuclearDeployPlan,
): string {
  const rows: [string, string, string][] = [
    ["chainId", String(base.chainId), String(eth.chainId)],
    ["registry", base.registry, eth.registry],
    ["disputeDeposit", base.params.disputeDeposit.toString(), eth.params.disputeDeposit.toString()],
    [
      "marketplaceFeeBps",
      base.params.marketplaceFeeBps.toString(),
      eth.params.marketplaceFeeBps.toString(),
    ],
    [
      "auctionPlatformFeeBps",
      base.params.auctionPlatformFeeBps.toString(),
      eth.params.auctionPlatformFeeBps.toString(),
    ],
    ["platformRecipient", base.params.platformRecipient, eth.params.platformRecipient],
    ["tokenIdOffset", base.tokenIdOffset.toString(), eth.tokenIdOffset.toString()],
    ["usdc", base.externals.usdc, eth.externals.usdc],
    ["usdcUsdFeed", base.externals.usdcUsdFeed, eth.externals.usdcUsdFeed],
    [
      "usdcUsdStalenessTolerance",
      String(base.externals.usdcUsdStalenessTolerance),
      String(eth.externals.usdcUsdStalenessTolerance),
    ],
    ["nativeUsdFeed", base.externals.nativeUsdFeed, eth.externals.nativeUsdFeed],
    [
      "nativeUsdStalenessTolerance",
      String(base.externals.nativeUsdStalenessTolerance),
      String(eth.externals.nativeUsdStalenessTolerance),
    ],
    ["layerZeroEndpoint", base.externals.layerZeroEndpoint, eth.externals.layerZeroEndpoint],
  ];

  const col0 = Math.max(...rows.map((r) => r[0].length), "param".length);
  const col1 = Math.max(...rows.map((r) => r[1].length), "84532".length);
  const col2 = Math.max(...rows.map((r) => r[2].length), "11155111".length);
  const pad = (s: string, n: number) => s.padEnd(n);

  const lines = [
    `${pad("param", col0)}  ${pad("84532", col1)}  ${pad("11155111", col2)}`,
    `${"-".repeat(col0)}  ${"-".repeat(col1)}  ${"-".repeat(col2)}`,
  ];
  for (const [k, v1, v2] of rows) {
    lines.push(`${pad(k, col0)}  ${pad(v1, col1)}  ${pad(v2, col2)}`);
  }
  lines.push("");
  lines.push(
    "Shared params identical; per-feed staleness tolerances differ by chain (heartbeat property of each feed)",
  );
  return lines.join("\n");
}
