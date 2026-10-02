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
const BASE_SEPOLIA_84532 = {
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
const ETHEREUM_SEPOLIA_11155111 = {
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
  [BASE_SEPOLIA_84532.chainId]: BASE_SEPOLIA_84532,
  [ETHEREUM_SEPOLIA_11155111.chainId]: ETHEREUM_SEPOLIA_11155111,
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
