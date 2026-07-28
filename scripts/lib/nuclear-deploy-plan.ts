/**
 * Pure nuclear deploy plan — identical protocol params on 84532 and 11155111.
 * External addresses only from CHAINLINK_FEEDS / LZ_ENDPOINT_V2_BY_CHAIN.
 */

import { getAddress } from "viem";

import {
  CHAINLINK_FEEDS,
  getChainFeedConfig,
  isCommercialChainId,
  lzEndpointForChain,
  type CommercialChainId,
  LZ_ENDPOINT_V2_BY_CHAIN,
} from "./chainlink-feeds.js";
import {
  AUCTION_PLATFORM_FEE_BPS,
  DISPUTE_DEPOSIT,
  MARKETPLACE_FEE_BPS,
  MARKETPLACE_MAX_FEED_STALENESS,
  MARKETPLACE_PRO_FEE_BPS,
} from "./verify-constructor-args.js";
import { SEPOLIA_FALLBACK } from "./load-deployment.js";

export const COMMERCIAL_CHAIN_IDS = [84532, 11155111] as const satisfies readonly CommercialChainId[];

/** USD-only: no setCurrencyFeed for non-USD entries even when live in CHAINLINK_FEEDS. */
export type NuclearRegistryPolicy = "usd-only";

export const NUCLEAR_DEPLOY_STEPS = [
  "Timelock48h",
  "KarProPass",
  "KarProStaking",
  "setStaking",
  "KarPassport",
  "MarketplaceEscrowImpl",
  "MarketplaceEscrowProxy",
  "approvePaymentToken",
  "transferUpgradeAuthority",
  "AuctionEscrowImpl",
  "AuctionEscrowProxy",
  "KarPassportBridgeGateway",
  "setBridgeGateway",
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
    marketplaceFeeBps: bigint;
    marketplaceProFeeBps: bigint;
    maxFeedStaleness: bigint;
    auctionPlatformFeeBps: bigint;
    platformRecipient: `0x${string}`;
  };
  /** Chain-specific externals — only from verified tables. */
  externals: {
    usdc: `0x${string}`;
    nativeUsdFeed: `0x${string}`;
    layerZeroEndpoint: `0x${string}`;
  };
};

export function buildNuclearDeployPlan(chainId: number): NuclearDeployPlan {
  if (!isCommercialChainId(chainId)) {
    throw new Error(`Nuclear deploy only supports 84532|11155111, got ${chainId}`);
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
      marketplaceProFeeBps: MARKETPLACE_PRO_FEE_BPS,
      maxFeedStaleness: MARKETPLACE_MAX_FEED_STALENESS,
      auctionPlatformFeeBps: AUCTION_PLATFORM_FEE_BPS,
      platformRecipient: getAddress(SEPOLIA_FALLBACK.platformRecipient),
    },
    externals: {
      usdc: getAddress(feedConfig.usdc),
      nativeUsdFeed: getAddress(feedConfig.nativeUsdFeed),
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
    externals.nativeUsdFeed.toLowerCase() === feeds.nativeUsdFeed.toLowerCase() &&
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
      "marketplaceProFeeBps",
      base.params.marketplaceProFeeBps.toString(),
      eth.params.marketplaceProFeeBps.toString(),
    ],
    [
      "maxFeedStaleness",
      base.params.maxFeedStaleness.toString(),
      eth.params.maxFeedStaleness.toString(),
    ],
    [
      "auctionPlatformFeeBps",
      base.params.auctionPlatformFeeBps.toString(),
      eth.params.auctionPlatformFeeBps.toString(),
    ],
    ["platformRecipient", base.params.platformRecipient, eth.params.platformRecipient],
    ["tokenIdOffset", base.tokenIdOffset.toString(), eth.tokenIdOffset.toString()],
    ["usdc", base.externals.usdc, eth.externals.usdc],
    ["nativeUsdFeed", base.externals.nativeUsdFeed, eth.externals.nativeUsdFeed],
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
  lines.push("84532 vs 11155111 parameters identical (shared params + usd-only registry)");
  return lines.join("\n");
}
