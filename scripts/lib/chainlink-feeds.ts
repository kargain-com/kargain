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
   * `0x0…0` means none — Nuclear still admits USDC with feed=0 (asset-only);
   * fiat opens are refused on-chain (`PaymentTokenFeedRequired`). Never invent a feed.
   */
  usdcUsdFeed: `0x${string}`;
  currencies: CurrencyFeedEntry[];
};

/**
 * Committed Chainlink proxy addresses — bytecode verified at deploy via RPC.
 * Mainnet rows (1, 8453) are configuration only; Nuclear deploy stays
 * `isCommercialChainId` → 84532 | 11155111 (§7.6 / commercial allowlist).
 */
export const CHAINLINK_FEEDS: Record<number, ChainFeedConfig> = {
  84532: {
    chainId: 84532,
    nativeUsdFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    // No Chainlink USDC/USD aggregator on Base Sepolia (RPC-probed 2026-07-30:
    // mainnet Base feed, Eth Sepolia feed, and claimed Base Sepolia candidates
    // all have no bytecode on 84532; ETH/USD + BTC/USD feeds respond).
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
    // RPC 2026-07-30: description USDC/USD; decimals 8; answer 99974007;
    // updatedAt 2026-07-29T14:29:41.000Z (publicnode).
    usdcUsdFeed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B",
    currencies: [
      { code: "USD", feed: "0x0000000000000000000000000000000000000000" },
      { code: "EUR", feed: "0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F" },
      { code: "GBP", feed: "0x9C4424Fd84C6661F97D8d6b3fc3C1aAc2BeDd137" },
      { code: "CAD", feed: "0x933014a09a567634621c170B9a244E4571A37c6C" },
      // No Chainlink AUD/USD aggregator committed on Base (left zero).
      { code: "AUD", feed: "0x0000000000000000000000000000000000000000" },
    ],
  },
  1: {
    chainId: 1,
    nativeUsdFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    // RPC 2026-07-30: description USDC/USD; decimals 8; answer 99973741;
    // updatedAt 2026-07-30T08:00:47.000Z (publicnode).
    usdcUsdFeed: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
    currencies: [{ code: "USD", feed: "0x0000000000000000000000000000000000000000" }],
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
    `Timelock may later approvePaymentToken with a non-zero feed; once set, the feed cannot be cleared.`
  );
}

export type UsdcUsdFeedAdmitResolution = {
  feed: `0x${string}`;
  /** Non-null when admitting with zero feed — deploy/dry-run must print this. */
  fiatLimitation: string | null;
};

/**
 * Nuclear FixedPrice USDC admit resolution.
 * Non-zero feed → admit with measured oracle. Zero feed → admit asset-only and announce
 * the fiat limitation (contracts already refuse fiat open/quote via PaymentTokenFeedRequired).
 */
export function resolveUsdcUsdFeedForAdmit(
  usdcUsdFeed: `0x${string}`,
  chainId: number,
): UsdcUsdFeedAdmitResolution {
  if (usdcUsdFeed.toLowerCase() === ZERO_USDC_USD_FEED) {
    return {
      feed: ZERO_USDC_USD_FEED,
      fiatLimitation: usdcFiatUnavailableAnnouncement(chainId),
    };
  }
  return { feed: getAddress(usdcUsdFeed), fiatLimitation: null };
}
