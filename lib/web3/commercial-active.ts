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
  /** Present when commerce modes are on the commercial stack (Nuclear #2+; live Nuclear #3). */
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
  /** Commerce modes — live on Nuclear #3 (August 1, 2026). */
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

/** Base Sepolia — Nuclear #3 August 1, 2026 (SPEC I.9.1); FixedPrice `2.4.0-rc.1`. */
const BASE_SEPOLIA_84532 = {
  chainId: 84532,
  karPassport: "0xEf7403424Ce96f0e1845AB70800022c78D97a52C",
  karProPass: "0xF4bCec8dC6f699c311d75c7aaEb7790c76f0FF43",
  karProStaking: "0xB7563aa97537a804Eb9f9E64f2b92DD7B1c60FD5",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  timelock: "0x886328c407998EA493b757bE9d49034624F8f4BE",
  bridgeGateway: "0xd4728af32553005A2BEae8f29eb73DB425980daa",
  fixedPriceConsignment: "0x233B0e6780d52275caE1f1d08035F6a3C932B99E",
  fixedPriceConsignmentImpl: "0xf1d84e984CE294C35A654C9d3B7F580104Fa8773",
  ascendingConsignment: "0xC0ADc29De760195d5BBB5d3c11f040B388872039",
  ascendingConsignmentImpl: "0x254340154a0C5B1d8679f49400AF292e33E1e855",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0x886328c407998EA493b757bE9d49034624F8f4BE",
  indexFromBlock: 44_919_727,
  blocks: {
    timelock: 44_919_737,
    karProPass: 44_919_741,
    karProStaking: 44_919_745,
    karPassport: 44_919_752,
    fixedPriceConsignmentImpl: 44_919_774,
    fixedPriceConsignment: 44_919_778,
    ascendingConsignmentImpl: 44_919_801,
    ascendingConsignment: 44_919_805,
    bridgeGateway: 44_919_820,
  },
} as const satisfies CommercialActiveStack;

/** Ethereum Sepolia — Nuclear #3 August 1, 2026 (SPEC I.9.2); FixedPrice `2.4.0-rc.1`. */
const ETHEREUM_SEPOLIA_11155111 = {
  chainId: 11155111,
  karPassport: "0xc903feE4395dd5Db35d9BcB558917f3Af8d71869",
  karProPass: "0xFc12ea568DD7aa636C64f4f778b965D2434D0054",
  karProStaking: "0xea8Ee6b1E9f1a6D6F1229EC498f1A93Fcddd02CB",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  nativeFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  timelock: "0x20683ca58425DA09B148242432318EeFbfbfFAb1",
  bridgeGateway: "0x3aC463aE600BB80Fe1b0Da20f2996Fd3F6e02E41",
  fixedPriceConsignment: "0xe9c06240059800228aB5f8c39f1a323dAFBA84a1",
  fixedPriceConsignmentImpl: "0x1424084C800b4712D835d244904915D1e62B2f21",
  ascendingConsignment: "0x07f9c182F176C2C4A82Fcb80c4f942864420542D",
  ascendingConsignmentImpl: "0x3ef0bD0e9446D5C3B7A10A1e0563b1d5a96afc4E",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0x20683ca58425DA09B148242432318EeFbfbfFAb1",
  indexFromBlock: 11_398_068,
  blocks: {
    timelock: 11_398_078,
    karProPass: 11_398_080,
    karProStaking: 11_398_082,
    karPassport: 11_398_085,
    fixedPriceConsignmentImpl: 11_398_088,
    fixedPriceConsignment: 11_398_089,
    ascendingConsignmentImpl: 11_398_093,
    ascendingConsignment: 11_398_094,
    bridgeGateway: 11_398_099,
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
