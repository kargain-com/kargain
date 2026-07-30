/**
 * Committed commercial stacks keyed by chainId (SPEC §I.12.12).
 * Canonical human tables: docs/contracts/SPEC.md Part I.9.x
 *
 * Resolution for Ponder/tooling: optional PONDER_* env (84532 debug) →
 * local deployments/<chainId>.json → COMMERCIAL_ACTIVE[chainId].
 * Gitignored manifests stay deploy-machine artifacts only.
 */

export type CommercialActiveBlocks = {
  timelock?: number;
  karProPass?: number;
  karProStaking?: number;
  karPassport?: number;
  bridgeGateway?: number;
  /** Present after Nuclear #2 mode deploy. */
  fixedPriceConsignment?: number;
  fixedPriceConsignmentImpl?: number;
  ascendingConsignment?: number;
  ascendingConsignmentImpl?: number;
};

export type CommercialActiveStack = {
  chainId: number;
  karPassport: `0x${string}`;
  karProPass: `0x${string}`;
  karProStaking: `0x${string}`;
  usdc: `0x${string}`;
  nativeFeed: `0x${string}`;
  /** Optional display/FX helper; may be unset on USD-only stacks. */
  eurFeed?: `0x${string}`;
  timelock: `0x${string}`;
  /** KarPassportBridgeGateway. */
  bridgeGateway: `0x${string}`;
  /** Commerce modes — Nuclear #2 (July 30, 2026). */
  fixedPriceConsignment?: `0x${string}`;
  fixedPriceConsignmentImpl?: `0x${string}`;
  ascendingConsignment?: `0x${string}`;
  ascendingConsignmentImpl?: `0x${string}`;
  layerZeroEndpoint: `0x${string}`;
  platformRecipient: `0x${string}`;
  deployer: `0x${string}`;
  upgradeAuthority: `0x${string}`;
  indexFromBlock: number;
  blocks: CommercialActiveBlocks;
};

/** Base Sepolia — Nuclear #2 July 30, 2026 (SPEC I.9.1); FixedPrice `2.3.0-rc.1`. */
const BASE_SEPOLIA_84532 = {
  chainId: 84532,
  karPassport: "0xFC33887c97Ff4c65B47279b43c6Ca6817f5528aE",
  karProPass: "0xD9Ea579DD90b4c5386A55688036d73B9d6bA5d4f",
  karProStaking: "0xC90d6Ecd1BB814eD18E6704f433662541f94fcaD",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  timelock: "0x380021e9a560b8CF1482Cd501F4B2629739b2452",
  bridgeGateway: "0x77C881b9FB3cD425367c99378588b2790669F51F",
  fixedPriceConsignment: "0xE98EbDb9354ff9c91872390D7106D621794C9118",
  fixedPriceConsignmentImpl: "0x41a547BbC1aD78a1C817a6020219caeBA888f62A",
  ascendingConsignment: "0x568f44F238BD1104D8c51Ea93eC92dC91ef5a17D",
  ascendingConsignmentImpl: "0x4a21B27D3e11bEc3076eBe1Faa28970675d8Fb45",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0x380021e9a560b8CF1482Cd501F4B2629739b2452",
  indexFromBlock: 44_833_462,
  blocks: {
    timelock: 44_833_472,
    karProPass: 44_833_476,
    karProStaking: 44_833_484,
    karPassport: 44_833_491,
    fixedPriceConsignmentImpl: 44_833_499,
    fixedPriceConsignment: 44_833_507,
    ascendingConsignmentImpl: 44_833_537,
    ascendingConsignment: 44_833_544,
    bridgeGateway: 44_833_559,
  },
} as const satisfies CommercialActiveStack;

/** Ethereum Sepolia — Nuclear #2 July 30, 2026 (SPEC I.9.2); FixedPrice `2.3.0-rc.1`. */
const ETHEREUM_SEPOLIA_11155111 = {
  chainId: 11155111,
  karPassport: "0xC219bf834B8965339b95C0B6Afe3c4d0F1266Fb0",
  karProPass: "0xc31197fcBa5D4f373A556b36CD05916fd73a9376",
  karProStaking: "0x3F6594d97FbD9D332866BB7EFB3f1b89554e1249",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  nativeFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  timelock: "0x48B0a4205A3CD16BA97FE17222A717c63F6756D8",
  bridgeGateway: "0xd2c6EAdc9c03741D6A44dB5CF54f520Ee774b655",
  fixedPriceConsignment: "0xf9dF8c00B89D833A1C7E1210259F9c4F673258E9",
  fixedPriceConsignmentImpl: "0x33544ED26f94e029905bd4c2fEC7EdbAd806D79b",
  ascendingConsignment: "0xe8ECf3b42b489F6289434840661770b43B027F13",
  ascendingConsignmentImpl: "0x7342C9286ca8f7F8D0d780586762d686A0099F0D",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0x48B0a4205A3CD16BA97FE17222A717c63F6756D8",
  indexFromBlock: 11_384_136,
  blocks: {
    timelock: 11_384_146,
    karProPass: 11_384_147,
    karProStaking: 11_384_150,
    karPassport: 11_384_152,
    fixedPriceConsignmentImpl: 11_384_153,
    fixedPriceConsignment: 11_384_154,
    ascendingConsignmentImpl: 11_384_159,
    ascendingConsignment: 11_384_160,
    bridgeGateway: 11_384_165,
  },
} as const satisfies CommercialActiveStack;

/**
 * Active commercial protocol stacks. Add a new entry when bringing up another chain;
 * do not reuse addresses across chainIds (SPEC §I.12.12).
 */
export const COMMERCIAL_ACTIVE: Readonly<Record<number, CommercialActiveStack>> = {
  [BASE_SEPOLIA_84532.chainId]: BASE_SEPOLIA_84532,
  [ETHEREUM_SEPOLIA_11155111.chainId]: ETHEREUM_SEPOLIA_11155111,
};

export function commercialActive(chainId: number): CommercialActiveStack | undefined {
  return COMMERCIAL_ACTIVE[chainId];
}

/** True when `chainId` has a committed commercial stack (84532, 11155111, …). */
export function isCommercialChainId(chainId: number): boolean {
  return Object.prototype.hasOwnProperty.call(COMMERCIAL_ACTIVE, chainId);
}

export function requireCommercialActive(chainId: number): CommercialActiveStack {
  const stack = COMMERCIAL_ACTIVE[chainId];
  if (!stack) {
    throw new Error(
      `No COMMERCIAL_ACTIVE entry for chain ${chainId} — add the stack to lib/web3/commercial-active.ts after deploy`,
    );
  }
  return stack;
}
