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
  marketplaceImpl?: number;
  marketplace?: number;
  auctionEscrowImpl?: number;
  auctionEscrow?: number;
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
  marketplace: `0x${string}`;
  marketplaceImpl: `0x${string}`;
  usdc: `0x${string}`;
  nativeFeed: `0x${string}`;
  /** Optional display/FX helper; may be unset on USD-only stacks. */
  eurFeed?: `0x${string}`;
  timelock: `0x${string}`;
  /** KarPassportBridgeGateway. */
  bridgeGateway: `0x${string}`;
  auctionEscrow: `0x${string}`;
  auctionEscrowImpl?: `0x${string}`;
  /** Commerce modes — filled at Nuclear #2; absent until then. */
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

/** Base Sepolia — Nuclear July 21, 2026 (SPEC I.9.1). */
const BASE_SEPOLIA_84532 = {
  chainId: 84532,
  karPassport: "0x899FaE4Bd3612A6268E45E199B0CeFb5310f416a",
  karProPass: "0xD9B6C20ffE5A9bcEb3771d8a1E39fE35aEfc5b25",
  karProStaking: "0xdEe5eD7e4036C85EEa9d102449E60BBA98Fe257f",
  marketplace: "0x60336c550946AF79c8FCfaDfA65d76224B356323",
  marketplaceImpl: "0x0F98B21857386dF0c3B0323c94e63e140533495F",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  eurFeed: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1",
  timelock: "0x9730A0e7B97d15d9Fb1668690B3b46331e6E1760",
  bridgeGateway: "0x2a4339656393da943730b7Ac728480f40909f14C",
  auctionEscrow: "0x37Fa0460Cfc46EC17E1d11D86AA4F9C9e0D79a04",
  auctionEscrowImpl: "0x5aB1947806d9D28bb5CAB770A586a968EAeaDfF2",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0x9730A0e7B97d15d9Fb1668690B3b46331e6E1760",
  indexFromBlock: 44_434_865,
  blocks: {
    timelock: 44_434_875,
    karProPass: 44_434_878,
    karProStaking: 44_434_885,
    karPassport: 44_434_921,
    marketplaceImpl: 44_434_934,
    marketplace: 44_434_937,
    auctionEscrowImpl: 44_434_946,
    auctionEscrow: 44_434_977,
    bridgeGateway: 44_434_981,
  },
} as const satisfies CommercialActiveStack;

/** Ethereum Sepolia — Nuclear July 21, 2026 (SPEC I.9.2). */
const ETHEREUM_SEPOLIA_11155111 = {
  chainId: 11155111,
  karPassport: "0x6378469256907D7DC14BBfce0261ceDE22314507",
  karProPass: "0x8888594b12DF2e1EF406e91CFF72d52801BCaC24",
  karProStaking: "0xcD40C83CD57422C616e7e63F562B2e78C269Fb7F",
  marketplace: "0x4FC74e0B7eE0A741707A553D43Efff68126D198B",
  marketplaceImpl: "0x7d37e7cbcc42308264B608429a82D03B7C3112F4",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  nativeFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  timelock: "0xCfA1eAB89D6D1DE1244CF346D5a4F1E7343E9083",
  bridgeGateway: "0xEBcd44736C7F1E8Bf3E5f1c98D176732eB134eAB",
  auctionEscrow: "0x796Fb1476440C3D8A34a8EC2Fa56664864531499",
  auctionEscrowImpl: "0xCf78b714DB70960bf1BB418C3370e4502AcFFC64",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0xCfA1eAB89D6D1DE1244CF346D5a4F1E7343E9083",
  indexFromBlock: 11_319_840,
  blocks: {
    timelock: 11_319_850,
    karProPass: 11_319_851,
    karProStaking: 11_319_852,
    karPassport: 11_319_855,
    marketplaceImpl: 11_319_856,
    marketplace: 11_319_857,
    auctionEscrowImpl: 11_319_860,
    auctionEscrow: 11_319_861,
    bridgeGateway: 11_319_862,
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
