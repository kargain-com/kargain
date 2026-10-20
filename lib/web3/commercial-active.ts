/**
 * Committed commercial stacks keyed by namespace (SPEC §I.12.12 / §I.13.1).
 * Canonical human tables: docs/contracts/SPEC.md Part I.9.x
 *
 * Resolution for Ponder/tooling: optional PONDER_* env (84532 debug) →
 * local deployments/<chainId>.json → COMMERCIAL_ACTIVE[namespace].
 * Gitignored manifests stay deploy-machine artifacts only.
 *
 * Sole owner of the commercial-network set. Tooling (feeds, nuclear) imports
 * from here — do not redefine the allowlist.
 *
 * Registry key = namespace (SPEC §13.1). EVM rows use EIP-155 as namespace;
 * SVM rows use the reserved-band namespace — never invent a fake EIP-155.
 * Solana Devnet is a live commercial row (S9-B). Per-program start slots live
 * in `blocks` (EVM-parallel); ingest derives `min(slots)` and never reads
 * gitignored deploy evidence at runtime.
 *
 * Enumerators: `commercialEip155Ids` is EVM-only (`vm === "evm"`). Never treat
 * reserved-band namespace keys as EIP-155 (S9 research §1.1.23 class).
 * `isCommercialEip155Id` ≠ `isCommercialNamespace` — audit call sites by name.
 */

import {
  isReservedNonEvmNamespace,
  mintKargainNamespace,
  namespaceFromLayerZeroEid,
  NON_EVM_NAMESPACE_MIN,
  type KargainNamespace,
} from "@/lib/web3/kargain-namespace";
import {
  mintCommercialNativeUnit,
  type CommercialNativeUnit,
} from "@/lib/web3/commercial-native-unit";
import { mintExplorerOrigin, type ExplorerOrigin } from "@/lib/web3/explorer-origin";
import {
  mintWalletStandardChain,
  type WalletStandardChain,
} from "@/lib/web3/wallet-standard-chain";

export type { CommercialNativeUnit } from "@/lib/web3/commercial-native-unit";
export type { ExplorerOrigin } from "@/lib/web3/explorer-origin";
export type { WalletStandardChain } from "@/lib/web3/wallet-standard-chain";

export type CommercialActiveBlocks = {
  timelock?: number;
  karProPass?: number;
  karProStaking?: number;
  karPassport?: number;
  bridgeGateway?: number;
  /** Present when commerce modes are on the commercial stack (Nuclear #2+). */
  fixedPriceConsignment?: number;
  fixedPriceConsignmentImpl?: number;
  ascendingConsignment?: number;
  ascendingConsignmentImpl?: number;
};

/**
 * Sole runtime enumerator of commercial VM discriminants (S8-D cause-list precedent).
 * Coverage proofs iterate this list; do not invent a parallel spelling.
 */
export const COMMERCIAL_VMS = ["evm", "svm"] as const;
export type CommercialVm = (typeof COMMERCIAL_VMS)[number];

/**
 * EVM address slots — checksum hex. Shared only by `vm: "evm"` rows.
 * Do not widen these fields to accept base58; SVM uses {@link SvmCommercialActiveStack}.
 */
type EvmCommercialActiveStackShared = {
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
  /** Commerce modes — live on Nuclear #7 (S9-A). */
  fixedPriceConsignment?: `0x${string}`;
  fixedPriceConsignmentImpl?: `0x${string}`;
  ascendingConsignment?: `0x${string}`;
  ascendingConsignmentImpl?: `0x${string}`;
  /** LayerZero EndpointV2 — EVM hex form. */
  layerZeroEndpoint: `0x${string}`;
  /** Fee sink (platformRecipient). Distinct from forfeitRecipient (SPEC §8.6 / §19). */
  platformRecipient: `0x${string}`;
  /** Challenge forfeit sink — distinct key from fee sink (Nuclear #5+). */
  forfeitRecipient: `0x${string}`;
  deployer: `0x${string}`;
  upgradeAuthority: `0x${string}`;
  /**
   * Abandoned Kargain contracts on **this** network only (SPEC §I.12.12).
   * Never match chain-blind: the same hex can be a live contract elsewhere.
   */
  historicalDenylist: readonly `0x${string}`[];
  indexFromBlock: number;
  blocks: CommercialActiveBlocks;
  nativeUnit: CommercialNativeUnit;
  /** Block explorer origin — minted via {@link mintExplorerOrigin}. */
  explorerBaseUrl: ExplorerOrigin;
};

/**
 * EVM commercial stack. `chainId` is the EIP-155 id and equals `namespace`
 * for every current entry (SPEC §13.1 non-collision).
 */
export type EvmCommercialActiveStack = EvmCommercialActiveStackShared & {
  vm: "evm";
  namespace: KargainNamespace;
  /** EIP-155 chain id — equals Number(namespace) for EVM stacks. */
  chainId: number;
};

/**
 * Commercial Kargain program ids on an SVM stack (attribution set for Custom).
 * Compose {@link SvmCommercialActiveStack} from this sub-shape so a new program
 * field is a type change here — not a silent hand-list drift.
 */
export type SvmKargainProgramIds = {
  karPassport: string;
  karProPass: string;
  karProStaking: string;
  bridgeGateway: string;
  fixedPriceConsignment?: string;
  ascendingConsignment?: string;
};

/**
 * SVM commercial stack shape (SPEC §13.1 reserved-band namespace).
 * Addresses are canonical base58 program / account ids (normalize via
 * `protocol-address`). No EIP-155 `chainId` — registry key is `namespace` alone.
 * Live commercial row carries program ids plus per-program start slots in `blocks`.
 */
export type SvmCommercialActiveStack = SvmKargainProgramIds & {
  vm: "svm";
  namespace: KargainNamespace;
  nativeUnit: CommercialNativeUnit;
  /** Block explorer origin — minted via {@link mintExplorerOrigin}. */
  explorerBaseUrl: ExplorerOrigin;
  /**
   * Wallet Standard `chain` for `solana:signAndSendTransaction`.
   * Minted via {@link mintWalletStandardChain}; read only through
   * {@link walletStandardChainOf} — never invent a cluster default.
   */
  walletStandardChain: WalletStandardChain;
  /**
   * Admitted SPL USDC mint (Circle Devnet: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`).
   * Not a native sentinel — R11.
   */
  usdc: string;
  /** Unused on SVM until a product FX path pins Pyth; empty string refuse at admit. */
  nativeFeed: string;
  eurFeed?: string;
  /** Squads / timelock-equivalent (testnet S4–S9 = deployer pubkey). */
  timelock: string;
  /** Challenge forfeit sink (base58). */
  forfeitRecipient: string;
  /** Proxy/impl slots — not instruction programs for Custom attribution. */
  fixedPriceConsignmentImpl?: string;
  ascendingConsignmentImpl?: string;
  /** LayerZero EndpointV2 program id (base58). */
  layerZeroEndpoint: string;
  platformRecipient?: string;
  deployer: string;
  upgradeAuthority: string;
  blocks: CommercialActiveBlocks;
};

/**
 * Exhaustive key table for {@link SvmKargainProgramIds}.
 * A new program field on the shape must appear here or typecheck fails.
 */
export const SVM_KARGAIN_PROGRAM_FIELDS = {
  karPassport: true,
  karProPass: true,
  karProStaking: true,
  bridgeGateway: true,
  fixedPriceConsignment: true,
  ascendingConsignment: true,
} as const satisfies Record<keyof SvmKargainProgramIds, true>;

/**
 * Exhaustive Kargain program ids on a commercial SVM stack (present optionals only).
 * Sole owner for Custom attribution membership.
 */
export function svmKargainProgramIds(
  stack: SvmKargainProgramIds,
): readonly string[] {
  const ids: string[] = [];
  for (const key of Object.keys(
    SVM_KARGAIN_PROGRAM_FIELDS,
  ) as (keyof typeof SVM_KARGAIN_PROGRAM_FIELDS)[]) {
    const value = stack[key];
    if (value != null) {
      ids.push(value);
    }
  }
  return ids;
}

/** Discriminated commercial stack — EVM and SVM rows share one registry. */
export type CommercialActiveStack = EvmCommercialActiveStack | SvmCommercialActiveStack;

/**
 * Registry shape — namespace → stack. Enumerators accept this so tests can inject
 * a mixed fixture through the product filter (not a reimplemented predicate).
 */
export type CommercialRegistry = Readonly<
  Record<number, CommercialActiveStack>
>;

const ETH_NATIVE_UNIT = mintCommercialNativeUnit("ETH", 18);
const SOL_NATIVE_UNIT = mintCommercialNativeUnit("SOL", 9);
const SOLANA_DEVNET_NAMESPACE = namespaceFromLayerZeroEid(40168);

/** Base Sepolia — Nuclear #7 August 29, 2026 (SPEC I.9.1); S9-A cutover. */
export const BASE_SEPOLIA_STACK = {
  vm: "evm",
  namespace: mintKargainNamespace(84532),
  chainId: 84532,
  nativeUnit: ETH_NATIVE_UNIT,
  explorerBaseUrl: mintExplorerOrigin("https://sepolia.basescan.org"),
  karPassport: "0x3A7742eac882769351dF11112bf2f8bf2D11a7A5",
  karProPass: "0x003f379c8592Aab993b43770414C9033fCD7004C",
  karProStaking: "0x86a3911bd2e06990D2fedE37C9C552f5fFfC4e99",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  timelock: "0xfDe4c336b23e3a21A3460bA005B4710584E43f27",
  bridgeGateway: "0x7324046854342587999984683c4833852FA81827",
  fixedPriceConsignment: "0xEc97fC815055CBD51746F7D6966340a1318Ac6F8",
  fixedPriceConsignmentImpl: "0x17062580197DC21044A666179373117d5ff8bFe9",
  ascendingConsignment: "0x496351CD0788c7312DEeA4b15dA71B521d534dc5",
  ascendingConsignmentImpl: "0xB12941894055f8cEE16b16Ee1d5b7c68Fdb6B6C8",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0x484f2e7bB362bCcE38d41DB7BCE2EAD955890B24",
  forfeitRecipient: "0x8d97a127A3Cf9a94c460BcaA06a429FFE75eF1A1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0xfDe4c336b23e3a21A3460bA005B4710584E43f27",
  // Nuclear #4 cutover August 2, 2026: Nuclear #3 hub + prior stacks retired.
  // Nuclear #7 / S9-A cutover September 2026: Nuclear #4 hub retired; N5+N6 hub
  // stacks denylisted (deployed, never served the app). Cross-chain CREATE
  // collisions: some N7 Eth live hexes appear on this list as historical —
  // they stay scoped to this network (SPEC §I.12.12).
  historicalDenylist: [
    "0x6378469256907D7DC14BBfce0261ceDE22314507",
    "0x4FC74e0B7eE0A741707A553D43Efff68126D198B",
    "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31",
    "0x59779D666747AEeDB0d9cc843cB8a68B8ab2470c",
    // Pre-Nuclear hub (June–July 2026 RC stack)
    "0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594",
    "0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19",
    "0xB13D264368C8cbcc8EC973D1E5DDBa435eA458Ce",
    "0xC219bf834B8965339b95C0B6Afe3c4d0F1266Fb0",
    "0xb5d79551BB11F726D2A1A110BAc645C4345dA568",
    "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
    // Thin spoke ONFT (retired)
    "0x5b7fD0ffF9B82255AD4d043a491e81948b76e703",
    // Commerce cutover Phase 1 — retired Nuclear legacy escrows (84532)
    "0x60336c550946AF79c8FCfaDfA65d76224B356323",
    "0x0F98B21857386dF0c3B0323c94e63e140533495F",
    "0x37Fa0460Cfc46EC17E1d11D86AA4F9C9e0D79a04",
    "0x5aB1947806d9D28bb5CAB770A586a968EAeaDfF2",
    // July 21 Nuclear hub (superseded by Nuclear #2 July 30)
    "0x899FaE4Bd3612A6268E45E199B0CeFb5310f416a",
    "0xD9B6C20ffE5A9bcEb3771d8a1E39fE35aEfc5b25",
    "0xdEe5eD7e4036C85EEa9d102449E60BBA98Fe257f",
    "0x2a4339656393da943730b7Ac728480f40909f14C",
    // Nuclear #2 hub (superseded by Nuclear #3 August 1, 2026)
    "0x380021e9a560b8CF1482Cd501F4B2629739b2452",
    "0xD9Ea579DD90b4c5386A55688036d73B9d6bA5d4f",
    "0xC90d6Ecd1BB814eD18E6704f433662541f94fcaD",
    "0xFC33887c97Ff4c65B47279b43c6Ca6817f5528aE",
    "0x77C881b9FB3cD425367c99378588b2790669F51F",
    "0xE98EbDb9354ff9c91872390D7106D621794C9118",
    "0x568f44F238BD1104D8c51Ea93eC92dC91ef5a17D",
    // Nuclear #3 hub (superseded by Nuclear #4 August 2, 2026)
    "0x886328c407998EA493b757bE9d49034624F8f4BE",
    "0xF4bCec8dC6f699c311d75c7aaEb7790c76f0FF43",
    "0xB7563aa97537a804Eb9f9E64f2b92DD7B1c60FD5",
    "0xEf7403424Ce96f0e1845AB70800022c78D97a52C",
    "0xd4728af32553005A2BEae8f29eb73DB425980daa",
    "0x233B0e6780d52275caE1f1d08035F6a3C932B99E",
    "0xf1d84e984CE294C35A654C9d3B7F580104Fa8773",
    "0xC0ADc29De760195d5BBB5d3c11f040B388872039",
    "0x254340154a0C5B1d8679f49400AF292e33E1e855",
    // Nuclear #4 hub (superseded by Nuclear #7 / S9-A)
    "0x274515B5b2Ba32bDce7E97122C69cfDa343E85Fb",
    "0x046DB61Ac23520bd6f9466a7f8B033325795B32c",
    "0xCBfCDfebbb6fDF4C3bbD30F363558FE618C986aE",
    "0x8354697d0DdCe6a3AA9aD33DDc1585e4b60CbC76",
    "0x73F41293bb207443990006b951CE9BC38Ef2eB3b",
    "0xa4A2FE8Bd5A7Ee99ED375BA179861D1DA7F2e8F4",
    "0xABd47E54595b814625B1B911BC3A078397Abb973",
    "0xcdfEe11B2F2eA6501E06576e1a50baa7B8Bd8750",
    "0xb1aEEA9466b8C67Ba9D8931987E26A2Bef59B7Dc",
    // Nuclear #5 hub (deployed, never app-served — ops/deploys/nuclear-5.md)
    "0x4e75F7d0D5847e6730da328F92890f1FcE3628F4",
    "0x3C2E19AdE259453D43a20E94D4Bf979250BC32c3",
    "0x408c0DB8cDf1bC31aa69aD73bf260e70803a2379",
    "0x8542Dd53345d851a320C7d1B2e78E1786743a70e",
    "0x74a659E081317bB63Bb552ab1C3d886e4728CceE",
    "0x88821bfb1A2C9dAB404C4a86a88685469b74101a",
    "0x66aF522A26C7650f63Bc82f611a623F3E863888b",
    // Nuclear #6 hub (explorers red; never app-served — archive/nuclear-6-84532.manifest.json)
    "0xb2762a11C14991E5EdD5270c44ab10f5956E3aAA",
    "0x8E6D4e07f45913fcf94a92261AE51522141AAF9f",
    "0xB081b8e3c6a5f72e07D5628F60A77Fb018BF0029",
    "0x8fc3325c2d018812Fcf782e3DE0f0F954B3f1915",
    "0x6aD4409089FcF8f2513b7E90CB7818d04D80Dedb",
    "0x6f309EdABCfcd3243E63eAc6EC2c476a9Ef3526e",
    "0xFA4FcEf7a1bF882438f70BaC63401410d4f6DB29",
  ],
  indexFromBlock: 46_119_704,
  blocks: {
    timelock: 46_119_714,
    karProPass: 46_119_719,
    karProStaking: 46_119_723,
    karPassport: 46_119_729,
    fixedPriceConsignmentImpl: 46_119_733,
    fixedPriceConsignment: 46_119_736,
    ascendingConsignmentImpl: 46_119_748,
    ascendingConsignment: 46_119_751,
    bridgeGateway: 46_119_765,
  },
} as const satisfies EvmCommercialActiveStack;

/** Ethereum Sepolia — Nuclear #7 August 29, 2026 (SPEC I.9.2); S9-A cutover. */
export const ETHEREUM_SEPOLIA_STACK = {
  vm: "evm",
  namespace: mintKargainNamespace(11155111),
  chainId: 11155111,
  nativeUnit: ETH_NATIVE_UNIT,
  explorerBaseUrl: mintExplorerOrigin("https://sepolia.etherscan.io"),
  karPassport: "0x1FFdEC27d14567B34548BA63269c0745227f1949",
  karProPass: "0x886328c407998EA493b757bE9d49034624F8f4BE",
  karProStaking: "0xF4bCec8dC6f699c311d75c7aaEb7790c76f0FF43",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  nativeFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  timelock: "0xbD13C4B92d7Ec454401AE242A0aa8E841EEba977",
  bridgeGateway: "0x910631Df5aA4d47Ce20a6D485cd9DdC2E68D8eBc",
  fixedPriceConsignment: "0xDf8412E8d61675523AB0843d0A24Fd6E22dD10Ab",
  fixedPriceConsignmentImpl: "0xEf7403424Ce96f0e1845AB70800022c78D97a52C",
  ascendingConsignment: "0x233B0e6780d52275caE1f1d08035F6a3C932B99E",
  ascendingConsignmentImpl: "0xf1d84e984CE294C35A654C9d3B7F580104Fa8773",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0x484f2e7bB362bCcE38d41DB7BCE2EAD955890B24",
  forfeitRecipient: "0x8d97a127A3Cf9a94c460BcaA06a429FFE75eF1A1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0xbD13C4B92d7Ec454401AE242A0aa8E841EEba977",
  // Nuclear #4 cutover August 2, 2026: Nuclear #3 Eth stack + prior Nuclear/legacy retired.
  // Nuclear #7 / S9-A cutover September 2026: Nuclear #4 Eth retired; N5+N6 Eth
  // stacks denylisted (deployed, never served the app). Live N7 Eth addresses must
  // not appear on this list (own-network ban); other-network collisions stay scoped.
  historicalDenylist: [
    "0x4FC74e0B7eE0A741707A553D43Efff68126D198B",
    "0x7d37e7cbcc42308264B608429a82D03B7C3112F4",
    "0x796Fb1476440C3D8A34a8EC2Fa56664864531499",
    "0xCf78b714DB70960bf1BB418C3370e4502AcFFC64",
    // July 21 Nuclear Eth (superseded by Nuclear #2 July 30)
    "0x6378469256907D7DC14BBfce0261ceDE22314507",
    "0x8888594b12DF2e1EF406e91CFF72d52801BCaC24",
    "0xcD40C83CD57422C616e7e63F562B2e78C269Fb7F",
    "0xEBcd44736C7F1E8Bf3E5f1c98D176732eB134eAB",
    // Nuclear #2 Eth (superseded by Nuclear #3 August 1, 2026)
    "0x48B0a4205A3CD16BA97FE17222A717c63F6756D8",
    "0xc31197fcBa5D4f373A556b36CD05916fd73a9376",
    "0x3F6594d97FbD9D332866BB7EFB3f1b89554e1249",
    "0xC219bf834B8965339b95C0B6Afe3c4d0F1266Fb0",
    "0xd2c6EAdc9c03741D6A44dB5CF54f520Ee774b655",
    "0xf9dF8c00B89D833A1C7E1210259F9c4F673258E9",
    "0xe8ECf3b42b489F6289434840661770b43B027F13",
    // Nuclear #3 Eth (superseded by Nuclear #4 August 2, 2026)
    "0x20683ca58425DA09B148242432318EeFbfbfFAb1",
    "0xFc12ea568DD7aa636C64f4f778b965D2434D0054",
    "0xea8Ee6b1E9f1a6D6F1229EC498f1A93Fcddd02CB",
    "0xc903feE4395dd5Db35d9BcB558917f3Af8d71869",
    "0x3aC463aE600BB80Fe1b0Da20f2996Fd3F6e02E41",
    "0xe9c06240059800228aB5f8c39f1a323dAFBA84a1",
    "0x1424084C800b4712D835d244904915D1e62B2f21",
    "0x07f9c182F176C2C4A82Fcb80c4f942864420542D",
    "0x3ef0bD0e9446D5C3B7A10A1e0563b1d5a96afc4E",
    // Nuclear #4 Eth (superseded by Nuclear #7 / S9-A)
    "0x95D9A432B53ceB42a0681b1900f52e7Fe2247586",
    "0xb83b89f4a7303f005dA8c0787e904104a1030128",
    "0x5dF3f185D9fAb40D1BEBC74b63268F8528a02906",
    "0x1016BCA92B98Ea2C648074cAAf04C5d0B3Baf8eC",
    "0xc416f642a85E3E104A42c2B067bB31485947891d",
    "0x49e8ce3e99Fa7413133b04f4085E55BF332BFC60",
    "0xbFdA994743feF37b268aA70ffF8a91eF3d10936E",
    "0x689D4A780a0d65A3f6dd02BD1013b1d3a5f60660",
    "0xec44167ab1e2619C9aCaA87F5B06DcAFe1BF7269",
    // Nuclear #5 Eth (deployed, never app-served — ops/deploys/nuclear-5.md)
    "0x8A3529d2B4CC482476Bd40f81a1E2F9E335867F7",
    "0xcAa270392eEa2AD4471C12267Ed9Bf7567ECa498",
    "0xfe9b6477C32dB849E7C5520BF1e055b2e5ABA6C9",
    "0x2961A0fDa331E1ecaF4e9F8A3515fe4346f60b2d",
    "0x6d1169F4b639Ee27442786b160FB3F06fDe6c28E",
    "0xD9Ea579DD90b4c5386A55688036d73B9d6bA5d4f",
    "0x2f74620F74A9addb441225356Abe79b2691F39B9",
    // Nuclear #6 Eth (explorers red; never app-served — archive/nuclear-6-11155111.manifest.json)
    "0xbAf046a0433644C5f8Eb16ceC1E42F4EF67A6802",
    "0x379BA6b8368Fc5C457fFaa4d7b5816a335754b3E",
    "0x2F1036251227EdaFaC51934AB5157854d2632Dc4",
    "0xFCC3FB7e926483778898f8Dd38bDb1Db51412a41",
    "0xf06BD41AA01BC31Dcb9e9B4eAA739E170A29147b",
    "0x77C881b9FB3cD425367c99378588b2790669F51F",
    "0xb9B649e13cA11a87c8842dD593E2008FBd130ECb",
  ],
  indexFromBlock: 11_591_966,
  blocks: {
    timelock: 11_591_976,
    karProPass: 11_591_977,
    karProStaking: 11_591_978,
    karPassport: 11_591_980,
    fixedPriceConsignmentImpl: 11_591_981,
    fixedPriceConsignment: 11_591_982,
    ascendingConsignmentImpl: 11_591_985,
    ascendingConsignment: 11_591_986,
    bridgeGateway: 11_591_991,
  },
} as const satisfies EvmCommercialActiveStack;

/** Solana Devnet — S9-B live commercial row, derived from deployments/svm-40168.json. */
const SOLANA_DEVNET_40168 = {
  vm: "svm",
  namespace: mintKargainNamespace(SOLANA_DEVNET_NAMESPACE),
  nativeUnit: SOL_NATIVE_UNIT,
  explorerBaseUrl: mintExplorerOrigin("https://explorer.solana.com"),
  walletStandardChain: mintWalletStandardChain("solana:devnet"),
  karPassport: "ArvcryxBL1mP44Vo4MoK1FE3YCnNG8JdVa3iTKxgWnTQ",
  karProPass: "4TE2kf7N4F43ab1436KA71ZwKKokdGt7ANRDbreWbnHr",
  karProStaking: "8tts6h74Uos5FuUJMEQ8uQd5oPXfKZ41Xfid9D6iZvXY",
  usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  nativeFeed: "",
  timelock: "65Qmw9zhpkjxJApmFngx3dxmGo2KiZ4kyJycLsWh4gU9",
  forfeitRecipient: "HPP7frMzYC87FsznTF48969TRsnzDMAe9RUuvzgSGprE",
  bridgeGateway: "9ugwozoJteH4D5XQmwvprevsZ6uWLoHEcWZWeVbDn693",
  fixedPriceConsignment: "HmKV5QEVQLdpCiyQAvP4dpqPDBUedi35RSCcWL5XTxyu",
  ascendingConsignment: "HMGnyNMFNi9Rjakrch3iAfmoNWRFK7DEBzsEyLiQNt74",
  layerZeroEndpoint: "76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6",
  deployer: "65Qmw9zhpkjxJApmFngx3dxmGo2KiZ4kyJycLsWh4gU9",
  upgradeAuthority: "65Qmw9zhpkjxJApmFngx3dxmGo2KiZ4kyJycLsWh4gU9",
  blocks: {
    karProStaking: 490_463_509,
    karProPass: 490_463_617,
    karPassport: 490_505_668,
    bridgeGateway: 490_505_773,
    fixedPriceConsignment: 493_100_976,
    ascendingConsignment: 493_101_099,
  },
} as const satisfies SvmCommercialActiveStack;

/**
 * Branded EIP-155 chain id for commercial EVM doors.
 * Sole constructors: {@link evmChainOf}, {@link resolveEvmChain}.
 * Do not cast outside this module. `KargainNamespace` stays a number in
 * general public signatures (S1).
 */
declare const eip155ChainIdBrand: unique symbol;

export type Eip155ChainId = number & {
  readonly [eip155ChainIdBrand]: void;
};

function mintEip155ChainId(value: number): Eip155ChainId {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid Eip155ChainId: ${value}`);
  }
  return value as Eip155ChainId;
}

/**
 * Brand the EIP-155 id of a known EVM commercial stack.
 * Stack field stays `number` so registry literals are not a third constructor.
 */
export function evmChainOf(stack: EvmCommercialActiveStack): Eip155ChainId {
  return mintEip155ChainId(stack.chainId);
}

export type ResolveEvmChainCause = "unresolved_namespace" | "not_evm";

export type ResolveEvmChainResult =
  | { ok: true; chainId: Eip155ChainId }
  | { ok: false; cause: ResolveEvmChainCause };

/**
 * Sole resolver from a commercial namespace (or unknown number) to a branded
 * EIP-155 id. SVM namespaces → `not_evm`; unknown → `unresolved_namespace`.
 * Absorbs former `eip155Of` (throw) and the dual wagmi doors (undefined/throw).
 */
export function resolveEvmChain(
  namespace: number,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): ResolveEvmChainResult {
  const stack = commercialActive(namespace, registry);
  if (stack == null) {
    return { ok: false, cause: "unresolved_namespace" };
  }
  if (stack.vm !== "evm") {
    return { ok: false, cause: "not_evm" };
  }
  return { ok: true, chainId: evmChainOf(stack) };
}

/**
 * Active commercial protocol stacks. Key = namespace (EIP-155 for EVM rows).
 * Live map includes the committed EVM stacks plus the Solana Devnet commercial row.
 * Do not reuse addresses across namespaces (SPEC §I.12.12).
 */
export const COMMERCIAL_ACTIVE: CommercialRegistry = {
  [BASE_SEPOLIA_STACK.chainId]: BASE_SEPOLIA_STACK,
  [ETHEREUM_SEPOLIA_STACK.chainId]: ETHEREUM_SEPOLIA_STACK,
  [SOLANA_DEVNET_NAMESPACE]: SOLANA_DEVNET_40168,
};

/**
 * Sorted commercial EIP-155 ids (nuclear / feeds / UI OR-loops).
 * Filters `vm === "evm"` — reserved-band SVM namespace keys must never appear here.
 * Brands via {@link evmChainOf} for every registry (live or injected).
 */
export function commercialEip155Ids(
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): readonly Eip155ChainId[] {
  return Object.values(registry)
    .filter((s): s is EvmCommercialActiveStack => s.vm === "evm")
    .map((s) => evmChainOf(s))
    .sort((a, b) => a - b);
}

export type RegistryDisjointnessViolation =
  | { kind: "evm_in_reserved_band"; namespace: number }
  | { kind: "non_evm_outside_reserved_band"; namespace: number }
  | { kind: "duplicate_eip155"; chainId: number; namespaces: number[] }
  | {
      kind: "duplicate_wallet_standard_chain";
      chain: string;
      namespaces: number[];
    }
  | { kind: "duplicate_layerzero_eid"; eid: number; namespaces: number[] };

/**
 * Registry band / identity disjointness (SPEC §13.1).
 * Live {@link COMMERCIAL_ACTIVE} has none. Plants inject a registry.
 *
 * `eidByEvmChain` is required — maps EVM EIP-155 → LayerZero EID
 * (product: bridge-config `EID_BY_CHAIN`). SVM EID is derived as
 * `namespace - NON_EVM_NAMESPACE_MIN`.
 */
export function registryDisjointnessViolations(
  registry: CommercialRegistry,
  eidByEvmChain: Readonly<Record<number, number>>,
): RegistryDisjointnessViolation[] {
  const violations: RegistryDisjointnessViolation[] = [];
  const eip155Owners = new Map<number, number[]>();
  const walletOwners = new Map<string, number[]>();
  const eidOwners = new Map<number, number[]>();

  for (const [key, stack] of Object.entries(registry)) {
    const namespace = Number(key);
    if (stack.vm === "evm") {
      if (isReservedNonEvmNamespace(Number(stack.namespace))) {
        violations.push({
          kind: "evm_in_reserved_band",
          namespace: Number(stack.namespace),
        });
      }
      const cid = stack.chainId;
      const owners = eip155Owners.get(cid) ?? [];
      owners.push(namespace);
      eip155Owners.set(cid, owners);
      const eid = eidByEvmChain[cid];
      if (eid != null) {
        const eidList = eidOwners.get(eid) ?? [];
        eidList.push(namespace);
        eidOwners.set(eid, eidList);
      }
    } else {
      if (!isReservedNonEvmNamespace(Number(stack.namespace))) {
        violations.push({
          kind: "non_evm_outside_reserved_band",
          namespace: Number(stack.namespace),
        });
      }
      const ws = stack.walletStandardChain;
      if (ws != null && typeof ws === "string") {
        const owners = walletOwners.get(ws) ?? [];
        owners.push(namespace);
        walletOwners.set(ws, owners);
      }
      const eid = Number(stack.namespace) - NON_EVM_NAMESPACE_MIN;
      if (Number.isInteger(eid) && eid > 0) {
        const eidList = eidOwners.get(eid) ?? [];
        eidList.push(namespace);
        eidOwners.set(eid, eidList);
      }
    }
  }

  for (const [chainId, namespaces] of eip155Owners) {
    if (namespaces.length > 1) {
      violations.push({ kind: "duplicate_eip155", chainId, namespaces });
    }
  }
  for (const [chain, namespaces] of walletOwners) {
    if (namespaces.length > 1) {
      violations.push({
        kind: "duplicate_wallet_standard_chain",
        chain,
        namespaces,
      });
    }
  }
  for (const [eid, namespaces] of eidOwners) {
    if (namespaces.length > 1) {
      violations.push({ kind: "duplicate_layerzero_eid", eid, namespaces });
    }
  }
  return violations;
}

/**
 * Sorted reserved-band namespace ids for registered SVM commercial stacks.
 */
export function commercialSvmNamespaceIds(
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): readonly number[] {
  return Object.values(registry)
    .filter((s): s is SvmCommercialActiveStack => s.vm === "svm")
    .map((s) => Number(s.namespace))
    .sort((a, b) => a - b);
}

/**
 * Namespace ids allowed to surface on provenance/entity UNION reads.
 * EVM rows use EIP-155; SVM rows use reserved-band namespace when registered.
 */
export function registeredCommercialNamespaceIds(
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): readonly number[] {
  return Object.values(registry)
    .map((s) => Number(s.namespace))
    .sort((a, b) => a - b);
}

export function commercialActive(
  namespace: number,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): CommercialActiveStack | undefined {
  return Object.prototype.hasOwnProperty.call(registry, namespace)
    ? registry[namespace]
    : undefined;
}

/**
 * Sole chrome sentence when a namespace is not a commercial registry key.
 * Commerce-fact and commerce-mode copy switches delegate here — never re-inline.
 */
export function unresolvedNamespaceCopy(): string {
  return "This network is not configured in the app.";
}

/**
 * True when `id` is a committed **EVM** commercial EIP-155 chain id.
 * Never true for reserved-band SVM namespaces — use {@link isCommercialNamespace}.
 * Boolean only — not a type predicate to {@link Eip155ChainId} (that would be a
 * third constructor). Brand via {@link resolveEvmChain} / {@link evmChainOf}.
 */
export function isCommercialEip155Id(
  id: number,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): boolean {
  const stack = commercialActive(id, registry);
  return stack != null && stack.vm === "evm";
}

/**
 * True when `namespace` has any committed commercial stack (EVM or SVM).
 * Custody / origin / UNION keys — not wagmi / nuclear EIP-155 gates.
 */
export function isCommercialNamespace(
  namespace: number,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): boolean {
  return commercialActive(namespace, registry) != null;
}

function commercialActiveMissingMessage(chainId: number): string {
  if (isReservedNonEvmNamespace(chainId)) {
    return (
      `COMMERCIAL_ACTIVE has no SVM row for reserved namespace ${chainId} — ` +
      `programs not deployed / not cut over (fail closed; do not offer as a network)`
    );
  }
  return (
    `No COMMERCIAL_ACTIVE entry for chain ${chainId} — add the stack to ` +
    `lib/web3/commercial-active.ts after deploy`
  );
}

export function requireCommercialActive(namespace: number): CommercialActiveStack {
  const stack = commercialActive(namespace);
  if (!stack) {
    throw new Error(commercialActiveMissingMessage(namespace));
  }
  return stack;
}

/**
 * Committed EVM commercial stack for a known EIP-155 id.
 * Fails by name when the registry row is missing or not EVM (SVM rows use namespace keys).
 */
export function requireEvmCommercialActive(
  chainId: number,
): EvmCommercialActiveStack {
  const stack = commercialActive(chainId);
  if (!stack || stack.vm !== "evm") {
    throw new Error(
      stack == null
        ? commercialActiveMissingMessage(chainId)
        : `requireEvmCommercialActive: chain ${chainId} is not an EVM commercial stack (vm=${stack.vm})`,
    );
  }
  return stack;
}

/**
 * Sole enumerator of Kargain-owned protocol addresses on an EVM commercial
 * stack (profile / messaging denylist): programs, token, feeds, gateway,
 * timelock, commerce modes, LayerZero endpoint, and the network's historical
 * list. Deployer, upgrade authority and fee / forfeit sinks are people or
 * governance wallets and stay excluded (SPEC II.4.1). Deduplicated by
 * lowercase hex; order is stable.
 */
export function evmProtocolAddresses(
  stack: EvmCommercialActiveStack,
): readonly `0x${string}`[] {
  const out: `0x${string}`[] = [];
  const seen = new Set<string>();
  const add = (value: `0x${string}` | undefined) => {
    if (value == null || value.length === 0) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };
  add(stack.karPassport);
  add(stack.karProPass);
  add(stack.karProStaking);
  add(stack.usdc);
  add(stack.nativeFeed);
  add(stack.eurFeed);
  add(stack.bridgeGateway);
  add(stack.timelock);
  add(stack.fixedPriceConsignment);
  add(stack.ascendingConsignment);
  add(stack.layerZeroEndpoint);
  for (const historical of stack.historicalDenylist) add(historical);
  return out;
}

/**
 * SVM counterpart of {@link evmProtocolAddresses}: programs, mint, feeds,
 * gateway, modes and endpoint. The timelock-equivalent is the deployer pubkey
 * on testnet and stays a profile subject (SPEC II.4.1).
 */
export function svmProtocolAddresses(
  stack: SvmCommercialActiveStack,
): readonly string[] {
  const out: string[] = [];
  const add = (value: string | undefined) => {
    if (value != null && value.length > 0) out.push(value);
  };
  add(stack.karPassport);
  add(stack.karProPass);
  add(stack.karProStaking);
  add(stack.usdc);
  add(stack.nativeFeed);
  add(stack.eurFeed);
  add(stack.bridgeGateway);
  add(stack.fixedPriceConsignment);
  add(stack.ascendingConsignment);
  add(stack.layerZeroEndpoint);
  return out;
}

/** Protocol addresses of any commercial stack — the one door per-VM owners hide behind. */
export function commercialProtocolAddresses(
  stack: CommercialActiveStack,
): readonly string[] {
  return stack.vm === "evm" ? evmProtocolAddresses(stack) : svmProtocolAddresses(stack);
}

/**
 * Committed SVM commercial stack for a namespace key.
 * Fails by name when the registry row is missing or not SVM.
 */
export function requireSvmCommercialActive(
  namespace: number,
): SvmCommercialActiveStack {
  const stack = commercialActive(namespace);
  if (!stack || stack.vm !== "svm") {
    throw new Error(
      stack == null
        ? commercialActiveMissingMessage(namespace)
        : `requireSvmCommercialActive: namespace ${namespace} is not an SVM commercial stack (vm=${stack.vm})`,
    );
  }
  return stack;
}

/** Namespace brand for a known commercial EIP-155 / registry key. */
export function namespaceOfCommercial(chainId: Eip155ChainId): KargainNamespace {
  return requireCommercialActive(chainId).namespace;
}

/** Native unit from the network class (sole reader). */
export function nativeUnitOf(stack: CommercialActiveStack): CommercialNativeUnit {
  return stack.nativeUnit;
}

export type WalletStandardChainOfCause = "missing_wallet_standard_chain";

export type WalletStandardChainOfResult =
  | { ok: true; chain: WalletStandardChain }
  | {
      ok: false;
      cause: WalletStandardChainOfCause;
      detail: string;
    };

/**
 * Sole reader of Wallet Standard `chain` for an SVM commercial stack.
 * Total over the registry contract: refuses by name when the field is absent
 * or not a minted cluster — never defaults to `solana:devnet`.
 */
export function walletStandardChainOf(
  stack: SvmCommercialActiveStack,
): WalletStandardChainOfResult {
  const raw = (stack as { walletStandardChain?: unknown }).walletStandardChain;
  if (raw == null || typeof raw !== "string" || raw.trim().length === 0) {
    return {
      ok: false,
      cause: "missing_wallet_standard_chain",
      detail: `SVM namespace ${Number(stack.namespace)} has no walletStandardChain`,
    };
  }
  try {
    return { ok: true, chain: mintWalletStandardChain(raw) };
  } catch {
    return {
      ok: false,
      cause: "missing_wallet_standard_chain",
      detail: String(raw),
    };
  }
}
