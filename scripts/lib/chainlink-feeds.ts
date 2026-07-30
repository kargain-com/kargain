import { type PublicClient, getAddress, type Hex } from "viem";

export type CurrencyFeedEntry = {
  code: string;
  feed: `0x${string}`;
};

export type ChainFeedConfig = {
  chainId: number;
  nativeUsdFeed: `0x${string}`;
  usdc: `0x${string}`;
  /**
   * Chainlink USDC/USD aggregator for FixedPrice fiat conversion.
   * `0x0…0` means none — Nuclear FixedPrice USDC admit must abort (no silent peg).
   */
  usdcUsdFeed: `0x${string}`;
  currencies: CurrencyFeedEntry[];
};

/** Committed Chainlink proxy addresses — bytecode verified at deploy via RPC. */
export const CHAINLINK_FEEDS: Record<number, ChainFeedConfig> = {
  84532: {
    chainId: 84532,
    nativeUsdFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    // No Chainlink USDC/USD aggregator on Base Sepolia (verified 2026-07-30).
    usdcUsdFeed: "0x0000000000000000000000000000000000000000",
    currencies: [{ code: "USD", feed: "0x0000000000000000000000000000000000000000" }],
  },
  11155111: {
    chainId: 11155111,
    nativeUsdFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    usdcUsdFeed: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
    currencies: [
      { code: "USD", feed: "0x0000000000000000000000000000000000000000" },
      { code: "EUR", feed: "0x1a81afB8146aeFfCFc5E50e8479e826E7D55b910" },
      { code: "GBP", feed: "0x91FAB41F5f3bE955963a986366edAcff1aaeaa83" },
      { code: "JPY", feed: "0x8A6af2B75F23831ADc973ce6288e5329F63D86c6" },
    ],
  },
  80002: {
    chainId: 80002,
    nativeUsdFeed: "0x001382149eBa3441043c1c66972b4772963f5D43",
    usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    usdcUsdFeed: "0x0000000000000000000000000000000000000000",
    currencies: [{ code: "USD", feed: "0x0000000000000000000000000000000000000000" }],
  },
  8453: {
    chainId: 8453,
    nativeUsdFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    // Commit only after RPC bytecode verify of a live USDC/USD aggregator.
    usdcUsdFeed: "0x0000000000000000000000000000000000000000",
    currencies: [
      { code: "USD", feed: "0x0000000000000000000000000000000000000000" },
      { code: "EUR", feed: "0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F" },
      { code: "GBP", feed: "0x9C4424Fd84C6661F97D8d6b3fc3C1aAc2BeDd137" },
      { code: "CAD", feed: "0x933014a09a567634621c170B9a244E4571A37c6C" },
      { code: "AUD", feed: "0x0000000000000000000000000000000000000000" },
    ],
  },
};

/** LayerZero EndpointV2 — same address on Base Sepolia and Ethereum Sepolia today. */
export const LZ_ENDPOINT_V2_BY_CHAIN: Record<84532 | 11155111, `0x${string}`> = {
  84532: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  11155111: "0x6EDCE65403992e310A62460808c4b910D972f10f",
};

export type CommercialChainId = keyof typeof LZ_ENDPOINT_V2_BY_CHAIN;

export function isCommercialChainId(chainId: number): chainId is CommercialChainId {
  return chainId === 84532 || chainId === 11155111;
}

export function lzEndpointForChain(chainId: number): `0x${string}` {
  if (!isCommercialChainId(chainId)) {
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

const ZERO_FEED = "0x0000000000000000000000000000000000000000" as const;

/** Nuclear FixedPrice USDC admit — refuse silent USD peg when no aggregator is configured. */
export function requireUsdcUsdFeed(
  usdcUsdFeed: `0x${string}`,
  chainId: number,
): `0x${string}` {
  if (usdcUsdFeed.toLowerCase() === ZERO_FEED) {
    throw new Error(
      `FixedPrice USDC admit requires a USDC/USD Chainlink feed on chain ${chainId}; none configured — refusing silent peg`,
    );
  }
  return getAddress(usdcUsdFeed);
}
