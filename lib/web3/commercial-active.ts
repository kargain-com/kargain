/**
 * Committed commercial stacks keyed by namespace (SPEC §I.12.12 / §I.13.1).
 * Canonical human tables: docs/contracts/SPEC.md Part I.9.x
 *
 * Resolution for Ponder/tooling: optional PONDER_* env (84532 debug) →
 * local deployments/<chainId>.json → COMMERCIAL_ACTIVE[namespace].
 * Gitignored manifests stay deploy-machine artifacts only.
 *
 * Sole owner of the commercial-network set / `isCommercialChainId` predicate.
 * Tooling (feeds, nuclear) imports from here — do not redefine the allowlist.
 *
 * Registry key = namespace (SPEC §13.1). EVM rows use EIP-155 as namespace;
 * SVM rows (when live) use the reserved-band namespace — never invent a fake EIP-155.
 * No Solana row until programs are deployed and cut over (S4b / S9).
 */

import {
  asKargainNamespace,
  isReservedNonEvmNamespace,
  mintKargainNamespace,
  type KargainNamespace,
} from "@/lib/web3/kargain-namespace";

export type CommercialActiveBlocks = {
  timelock?: number;
  karProPass?: number;
  karProStaking?: number;
  karPassport?: number;
  bridgeGateway?: number;
  /** Present when commerce modes are on the commercial stack (Nuclear #2+; live Nuclear #4). */
  fixedPriceConsignment?: number;
  fixedPriceConsignmentImpl?: number;
  ascendingConsignment?: number;
  ascendingConsignmentImpl?: number;
};

/** Native gas-token unit metadata — declare only; formatters rewired in S8. */
export type CommercialNativeUnit = {
  symbol: string;
  decimals: number;
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
  /** Commerce modes — live on Nuclear #4 (August 2, 2026). */
  fixedPriceConsignment?: `0x${string}`;
  fixedPriceConsignmentImpl?: `0x${string}`;
  ascendingConsignment?: `0x${string}`;
  ascendingConsignmentImpl?: `0x${string}`;
  /** LayerZero EndpointV2 — EVM hex form. */
  layerZeroEndpoint: `0x${string}`;
  platformRecipient: `0x${string}`;
  deployer: `0x${string}`;
  upgradeAuthority: `0x${string}`;
  indexFromBlock: number;
  blocks: CommercialActiveBlocks;
  nativeUnit: CommercialNativeUnit;
  /** Block explorer origin (no trailing slash) — network-class data, not viem. */
  explorerBaseUrl: string;
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
 * SVM commercial stack shape (SPEC §13.1 reserved-band namespace).
 * Addresses are canonical base58 program / account ids (normalize via
 * `protocol-address`). No EIP-155 `chainId` — registry key is `namespace` alone.
 * Not present in {@link COMMERCIAL_ACTIVE} until programs are live (S4b+) and cut over (S9).
 */
export type SvmCommercialActiveStack = {
  vm: "svm";
  namespace: KargainNamespace;
  nativeUnit: CommercialNativeUnit;
  /** Block explorer origin (no trailing slash). */
  explorerBaseUrl: string;
  karPassport: string;
  karProPass: string;
  karProStaking: string;
  /** SPL mint or native sentinel — product path decides in S8. */
  usdc: string;
  /** Unused on SVM until an oracle path exists; empty string refuse at admit. */
  nativeFeed: string;
  eurFeed?: string;
  /** Squads / timelock-equivalent upgrade authority (base58). */
  timelock: string;
  bridgeGateway: string;
  fixedPriceConsignment?: string;
  fixedPriceConsignmentImpl?: string;
  ascendingConsignment?: string;
  ascendingConsignmentImpl?: string;
  /** LayerZero EndpointV2 program id (base58). */
  layerZeroEndpoint: string;
  platformRecipient: string;
  deployer: string;
  upgradeAuthority: string;
  indexFromBlock: number;
  blocks: CommercialActiveBlocks;
};

/** Discriminated commercial stack — live registry is EVM-only; SVM shape is typed for S4b+. */
export type CommercialActiveStack = EvmCommercialActiveStack | SvmCommercialActiveStack;

const ETH_NATIVE_UNIT = { symbol: "ETH", decimals: 18 } as const satisfies CommercialNativeUnit;

/** Base Sepolia — Nuclear #4 August 2, 2026 (SPEC I.9.1); KarPassport `1.10.0-rc.1` · Ascending `2.4.0-rc.1`. */
const BASE_SEPOLIA_84532 = {
  vm: "evm",
  namespace: mintKargainNamespace(84532),
  chainId: 84532,
  nativeUnit: ETH_NATIVE_UNIT,
  explorerBaseUrl: "https://sepolia.basescan.org",
  karPassport: "0x8354697d0DdCe6a3AA9aD33DDc1585e4b60CbC76",
  karProPass: "0x046DB61Ac23520bd6f9466a7f8B033325795B32c",
  karProStaking: "0xCBfCDfebbb6fDF4C3bbD30F363558FE618C986aE",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  timelock: "0x274515B5b2Ba32bDce7E97122C69cfDa343E85Fb",
  bridgeGateway: "0xb1aEEA9466b8C67Ba9D8931987E26A2Bef59B7Dc",
  fixedPriceConsignment: "0x73F41293bb207443990006b951CE9BC38Ef2eB3b",
  fixedPriceConsignmentImpl: "0xa4A2FE8Bd5A7Ee99ED375BA179861D1DA7F2e8F4",
  ascendingConsignment: "0xABd47E54595b814625B1B911BC3A078397Abb973",
  ascendingConsignmentImpl: "0xcdfEe11B2F2eA6501E06576e1a50baa7B8Bd8750",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0x274515B5b2Ba32bDce7E97122C69cfDa343E85Fb",
  indexFromBlock: 44_957_457,
  blocks: {
    timelock: 44_957_467,
    karProPass: 44_957_471,
    karProStaking: 44_957_475,
    karPassport: 44_957_484,
    fixedPriceConsignmentImpl: 44_957_489,
    fixedPriceConsignment: 44_957_497,
    ascendingConsignmentImpl: 44_957_513,
    ascendingConsignment: 44_957_521,
    bridgeGateway: 44_957_539,
  },
} as const satisfies EvmCommercialActiveStack;

/** Ethereum Sepolia — Nuclear #4 August 2, 2026 (SPEC I.9.2); KarPassport `1.10.0-rc.1` · Ascending `2.4.0-rc.1`. */
const ETHEREUM_SEPOLIA_11155111 = {
  vm: "evm",
  namespace: mintKargainNamespace(11155111),
  chainId: 11155111,
  nativeUnit: ETH_NATIVE_UNIT,
  explorerBaseUrl: "https://sepolia.etherscan.io",
  karPassport: "0x1016BCA92B98Ea2C648074cAAf04C5d0B3Baf8eC",
  karProPass: "0xb83b89f4a7303f005dA8c0787e904104a1030128",
  karProStaking: "0x5dF3f185D9fAb40D1BEBC74b63268F8528a02906",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  nativeFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  timelock: "0x95D9A432B53ceB42a0681b1900f52e7Fe2247586",
  bridgeGateway: "0xec44167ab1e2619C9aCaA87F5B06DcAFe1BF7269",
  fixedPriceConsignment: "0xc416f642a85E3E104A42c2B067bB31485947891d",
  fixedPriceConsignmentImpl: "0x49e8ce3e99Fa7413133b04f4085E55BF332BFC60",
  ascendingConsignment: "0xbFdA994743feF37b268aA70ffF8a91eF3d10936E",
  ascendingConsignmentImpl: "0x689D4A780a0d65A3f6dd02BD1013b1d3a5f60660",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0x95D9A432B53ceB42a0681b1900f52e7Fe2247586",
  indexFromBlock: 11_404_204,
  blocks: {
    timelock: 11_404_214,
    karProPass: 11_404_216,
    karProStaking: 11_404_217,
    karPassport: 11_404_220,
    fixedPriceConsignmentImpl: 11_404_221,
    fixedPriceConsignment: 11_404_222,
    ascendingConsignmentImpl: 11_404_228,
    ascendingConsignment: 11_404_229,
    bridgeGateway: 11_404_235,
  },
} as const satisfies EvmCommercialActiveStack;

/** EIP-155 ids of committed commercial EVM stacks — sole allowlist for tooling. */
export type CommercialChainId =
  | typeof BASE_SEPOLIA_84532.chainId
  | typeof ETHEREUM_SEPOLIA_11155111.chainId;

/**
 * Active commercial protocol stacks. Add a new entry when bringing up another chain;
 * do not reuse addresses across namespaces (SPEC §I.12.12).
 * Registry key = namespace (equals EIP-155 for current EVM rows).
 * Live registry is EVM-only — no Solana row until S4b deploy + S9 cutover.
 */
export const COMMERCIAL_ACTIVE: Readonly<
  Record<CommercialChainId, EvmCommercialActiveStack>
> = {
  [BASE_SEPOLIA_84532.chainId]: BASE_SEPOLIA_84532,
  [ETHEREUM_SEPOLIA_11155111.chainId]: ETHEREUM_SEPOLIA_11155111,
};

/** Sorted commercial EIP-155 ids (nuclear / feeds / UI lists). */
export function commercialEip155Ids(): readonly CommercialChainId[] {
  return (Object.keys(COMMERCIAL_ACTIVE) as unknown as CommercialChainId[])
    .map(Number)
    .sort((a, b) => a - b) as CommercialChainId[];
}

/**
 * Namespace ids allowed to surface on provenance UNION reads (S7c-2).
 * EVM rows use EIP-155; SVM rows use reserved-band namespace when registered.
 */
export function registeredCommercialNamespaceIds(): readonly number[] {
  return commercialEip155Ids().map((id) => Number(COMMERCIAL_ACTIVE[id].namespace));
}

export function commercialActive(
  chainId: number,
): CommercialActiveStack | undefined {
  return Object.prototype.hasOwnProperty.call(COMMERCIAL_ACTIVE, chainId)
    ? COMMERCIAL_ACTIVE[chainId as CommercialChainId]
    : undefined;
}

/** True when `chainId` has a committed commercial stack (84532, 11155111, …). */
export function isCommercialChainId(
  chainId: number,
): chainId is CommercialChainId {
  return Object.prototype.hasOwnProperty.call(COMMERCIAL_ACTIVE, chainId);
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

export function requireCommercialActive(chainId: number): CommercialActiveStack {
  const stack = commercialActive(chainId);
  if (!stack) {
    throw new Error(commercialActiveMissingMessage(chainId));
  }
  return stack;
}

/**
 * Committed EVM commercial stack for a known EIP-155 id.
 * Fails by name when the registry row is missing or not EVM (SVM rows use namespace keys).
 */
export function requireEvmCommercialActive(chainId: CommercialChainId): EvmCommercialActiveStack {
  const stack = COMMERCIAL_ACTIVE[chainId];
  if (stack.vm !== "evm") {
    throw new Error(
      `requireEvmCommercialActive: chain ${chainId} is not an EVM commercial stack (vm=${stack.vm})`,
    );
  }
  return stack;
}

/**
 * EIP-155 id for a commercial namespace. Fails by name when the stack is not EVM.
 * For current stacks, namespace number equals EIP-155.
 */
export function eip155Of(namespace: KargainNamespace | number): number {
  const stack = commercialActive(Number(namespace));
  if (!stack) {
    throw new Error(commercialActiveMissingMessage(Number(namespace)));
  }
  if (stack.vm !== "evm") {
    throw new Error(
      `eip155Of: namespace ${namespace} is not an EVM commercial stack (vm=${stack.vm})`,
    );
  }
  return stack.chainId;
}

/** Namespace brand for a known commercial EIP-155 / registry key. */
export function namespaceOfCommercial(chainId: CommercialChainId): KargainNamespace {
  return asKargainNamespace(requireCommercialActive(chainId).namespace);
}

/**
 * Native unit from the network class (sole reader).
 * Presence and shape are type/registry invariants — no runtime re-check.
 */
export function nativeUnitOf(stack: CommercialActiveStack): CommercialNativeUnit {
  return stack.nativeUnit;
}
