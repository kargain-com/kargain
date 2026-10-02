/**
 * Sole dual-VM owner of “who holds this passport now on this namespace” (Unit O).
 *
 * Chain first (EVM `ownerOf` / SVM Core AssetV1 owner); named projection fallback
 * when the chain read is pending or refused. Never invents an owner.
 *
 * Listing-seller holder semantics stay in {@link isPassportHolder} — feed it the
 * holder’s known/projection owner; {@link isSessionHolder} is session↔holder only.
 */

import { decodeCoreAssetOwner } from "@/lib/svm/decode-core-asset";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";
import { commerceModeAddresses } from "@/lib/commerce/mode";
import {
  isOnChainNftOwner,
  isPassportHolder,
  isSameWallet,
} from "@/lib/passport/passport-owner";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import type { ActiveAccount } from "@/lib/web3/active-account";
import {
  commercialActive,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import type {
  KeyedContract,
  KeyedEntry,
} from "@/lib/web3/keyed-multicall";
import {
  mintProtocolOwner,
  protocolAddressesEqual,
  type ProtocolOwner,
} from "@/lib/web3/protocol-address";
import { getPublicClient } from "@/lib/web3/public-client";
import {
  fetchProductSvmAccountData,
  isSvmAccountData,
  type SvmAccountData,
} from "@/lib/web3/svm-rpc";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export const PASSPORT_HOLDER_EVM_KEY = "passportHolderOwnerOf" as const;
export const PASSPORT_HOLDER_SVM_KEY = "passportHolderCoreAsset" as const;

export type PassportHolderProjectionReason =
  | "chain_pending"
  | "chain_refused";

export type PassportHolderRefusedCause =
  | "unresolved_namespace"
  | "asset_pda_failed"
  | "core_decode_failed"
  | "owner_unmintable";

export type PassportHolder =
  | {
      status: "known";
      owner: ProtocolOwner;
      source: "chain";
    }
  | {
      status: "projection";
      owner: ProtocolOwner;
      reason: PassportHolderProjectionReason;
    }
  | { status: "pending" }
  | { status: "in_transit" }
  | { status: "absent" }
  | { status: "refused"; cause: PassportHolderRefusedCause; detail?: string };

export type PassportHolderChainRead =
  | { status: "pending" }
  | { status: "success"; owner: ProtocolOwner }
  | { status: "refused"; detail?: string };

/**
 * Pure resolve from an already-read chain fact + projection + transit.
 * Hook / RSC adapters produce {@link PassportHolderChainRead}; this never RPCs.
 */
export function resolvePassportHolder(input: {
  namespace: number;
  transitActive?: boolean;
  chain: PassportHolderChainRead | null;
  projectionOwner?: ProtocolOwner | string | null;
  /** When true and chain is null, treat as pending (hook still planning). */
  planning?: boolean;
}): PassportHolder {
  if (input.transitActive) {
    return { status: "in_transit" };
  }

  const projection = mintProjection(input.namespace, input.projectionOwner);

  if (input.planning || input.chain == null) {
    if (projection != null) {
      return {
        status: "projection",
        owner: projection,
        reason: "chain_pending",
      };
    }
    return { status: "pending" };
  }

  switch (input.chain.status) {
    case "success":
      return {
        status: "known",
        owner: input.chain.owner,
        source: "chain",
      };
    case "pending":
      if (projection != null) {
        return {
          status: "projection",
          owner: projection,
          reason: "chain_pending",
        };
      }
      return { status: "pending" };
    case "refused":
      if (projection != null) {
        return {
          status: "projection",
          owner: projection,
          reason: "chain_refused",
        };
      }
      return { status: "absent" };
    default: {
      const _exhaustive: never = input.chain;
      return _exhaustive;
    }
  }
}

function mintProjection(
  namespace: number,
  raw: ProtocolOwner | string | null | undefined,
): ProtocolOwner | null {
  if (raw == null || raw === "") return null;
  return mintProtocolOwner(namespace, raw);
}

/**
 * Map a keyed EVM `ownerOf` entry to a chain read.
 * Success payload is the address string from wagmi.
 */
export function passportHolderChainFromEvmOwnerOf(
  entry: KeyedEntry | undefined,
  namespace: number,
  opts?: { batchPending?: boolean },
): PassportHolderChainRead {
  if (opts?.batchPending || entry == null || entry.status === "pending") {
    return { status: "pending" };
  }
  if (entry.status === "refused") {
    return { status: "refused", detail: entry.cause };
  }
  const raw = entry.result;
  if (typeof raw !== "string" || raw.length === 0) {
    return { status: "refused", detail: "ownerOf_not_address" };
  }
  const owner = mintProtocolOwner(namespace, raw);
  if (owner == null) {
    return { status: "refused", detail: "owner_unmintable" };
  }
  return { status: "success", owner };
}

/**
 * Map a keyed SVM Core asset account entry to a chain read.
 */
export function passportHolderChainFromSvmAsset(
  entry: KeyedEntry | undefined,
  namespace: number,
  opts?: { batchPending?: boolean },
): PassportHolderChainRead {
  if (opts?.batchPending || entry == null || entry.status === "pending") {
    return { status: "pending" };
  }
  if (entry.status === "refused") {
    return { status: "refused", detail: entry.cause };
  }
  if (!isSvmAccountData(entry.result)) {
    return { status: "refused", detail: "malformed_account" };
  }
  return passportHolderChainFromSvmAccountData(entry.result, namespace);
}

export function passportHolderChainFromSvmAccountData(
  account: SvmAccountData,
  namespace: number,
): PassportHolderChainRead {
  const decoded = decodeCoreAssetOwner({
    data: account.data,
    accountOwner: account.owner,
    namespace,
  });
  if (!decoded.ok) {
    return {
      status: "refused",
      detail: `${decoded.cause}:${decoded.detail}`,
    };
  }
  return { status: "success", owner: decoded.owner };
}

/** Address string for chrome that still takes a bare owner (never invents). */
export function passportHolderOwnerAddress(
  holder: PassportHolder,
): string | undefined {
  switch (holder.status) {
    case "known":
    case "projection":
      return holder.owner;
    case "pending":
    case "in_transit":
    case "absent":
    case "refused":
      return undefined;
    default: {
      const _exhaustive: never = holder;
      return _exhaustive;
    }
  }
}

/**
 * Session address equals the holder’s known/projection owner.
 * Does **not** replace {@link isPassportHolder} listing-seller semantics.
 */
export function isSessionHolder(
  account: ActiveAccount,
  holder: PassportHolder,
  namespace: number,
): boolean {
  if (account.status !== "connected") return false;
  const owner = passportHolderOwnerAddress(holder);
  if (owner == null) return false;
  return protocolAddressesEqual(namespace, account.address, owner);
}

/**
 * Compose listing-aware holder check from the dual-VM holder fact.
 * When a live listing has a seller, seller wins (unchanged law).
 */
export function isPassportHolderFromFact(input: {
  account: ActiveAccount;
  holder: PassportHolder;
  namespace: number;
  listingActive?: boolean;
  listingSeller?: string | null;
}): boolean {
  if (input.account.status !== "connected") return false;
  return isPassportHolder({
    address: input.account.address,
    onChainOwner:
      input.holder.status === "known" ? input.holder.owner : undefined,
    ponderOwner:
      input.holder.status === "projection" ? input.holder.owner : undefined,
    listingActive: input.listingActive,
    listingSeller: input.listingSeller,
    namespace: input.namespace,
  });
}

/** Re-export equality helpers so chrome can drop resolveEffectiveOnChainOwner. */
export { isOnChainNftOwner, isSameWallet };

export function requireCommercialStack(
  namespace: number,
  registry?: CommercialRegistry,
):
  | { ok: true; stack: NonNullable<ReturnType<typeof commercialActive>> }
  | { ok: false; cause: "unresolved_namespace" } {
  const stack = commercialActive(namespace, registry);
  if (stack == null) {
    return { ok: false, cause: "unresolved_namespace" };
  }
  return { ok: true, stack };
}

export type PassportHolderReadPlan =
  | {
      ok: true;
      vm: "evm";
      namespace: number;
      contracts: readonly KeyedContract<typeof PASSPORT_HOLDER_EVM_KEY>[];
    }
  | {
      ok: true;
      vm: "svm";
      namespace: number;
      contracts: readonly KeyedContract<typeof PASSPORT_HOLDER_SVM_KEY>[];
      assetAddress: string;
    }
  | {
      ok: false;
      cause: PassportHolderRefusedCause;
      detail?: string;
    };

/**
 * Plan the keyed read for the passport holder on `namespace`.
 * EVM: KarPassport.ownerOf. SVM: Core asset PDA account.
 */
export async function planPassportHolderRead(args: {
  namespace: number;
  tokenId: string;
  registry?: CommercialRegistry;
}): Promise<PassportHolderReadPlan> {
  const stack = commercialActive(args.namespace, args.registry);
  if (stack == null) {
    return { ok: false, cause: "unresolved_namespace" };
  }

  if (stack.vm === "evm") {
    const passport = karPassportAddress(args.namespace);
    const wc = wagmiChainId(args.namespace);
    if (passport == null) {
      return {
        ok: false,
        cause: "unresolved_namespace",
        detail: "karPassportAddress missing",
      };
    }
    return {
      ok: true,
      vm: "evm",
      namespace: args.namespace,
      contracts: [
        {
          key: PASSPORT_HOLDER_EVM_KEY,
          address: passport,
          abi: KarPassportAbi,
          functionName: "ownerOf",
          args: [BigInt(args.tokenId)],
          chainId: wc,
        },
      ],
    };
  }

  let tokenBytes: Uint8Array;
  try {
    tokenBytes = tokenIdToBytes32(args.tokenId);
  } catch (err) {
    return {
      ok: false,
      cause: "asset_pda_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const assetPda = await deriveSvmPda({
    recipe: "kar-passport/asset",
    programId: stack.karPassport,
    seeds: { token_id: tokenBytes },
  });
  if (!assetPda.ok) {
    return {
      ok: false,
      cause: "asset_pda_failed",
      detail: `${assetPda.cause}:${assetPda.detail}`,
    };
  }

  return {
    ok: true,
    vm: "svm",
    namespace: args.namespace,
    assetAddress: assetPda.address,
    contracts: [
      {
        key: PASSPORT_HOLDER_SVM_KEY,
        vm: "svm",
        account: assetPda.address,
      },
    ],
  };
}

/**
 * Resolve holder from a planned keyed batch + projection + transit.
 */
export function resolvePassportHolderFromPlan(args: {
  namespace: number;
  plan: PassportHolderReadPlan | null;
  planning: boolean;
  entry: (key: string) => KeyedEntry | undefined;
  batchPending: boolean;
  projectionOwner?: ProtocolOwner | string | null;
  transitActive?: boolean;
}): PassportHolder {
  if (args.transitActive) {
    return { status: "in_transit" };
  }

  if (args.plan == null || args.planning) {
    return resolvePassportHolder({
      namespace: args.namespace,
      planning: true,
      chain: null,
      projectionOwner: args.projectionOwner,
    });
  }

  if (!args.plan.ok) {
    return {
      status: "refused",
      cause: args.plan.cause,
      detail: args.plan.detail,
    };
  }

  const chain =
    args.plan.vm === "evm"
      ? passportHolderChainFromEvmOwnerOf(
          args.entry(PASSPORT_HOLDER_EVM_KEY),
          args.plan.namespace,
          { batchPending: args.batchPending },
        )
      : passportHolderChainFromSvmAsset(
          args.entry(PASSPORT_HOLDER_SVM_KEY),
          args.plan.namespace,
          { batchPending: args.batchPending },
        );

  return resolvePassportHolder({
    namespace: args.plan.namespace,
    chain,
    projectionOwner: args.projectionOwner,
    transitActive: false,
  });
}

/**
 * Server / RSC door: plan + live RPC → holder chain fact (no projection).
 * EVM via public client `ownerOf`; SVM via product account fetch + Core decode.
 */
export async function readPassportHolderLive(args: {
  namespace: number;
  tokenId: string;
  registry?: CommercialRegistry;
  fetchAccountData?: typeof fetchProductSvmAccountData;
  readEvmOwnerOf?: (passport: `0x${string}`, tokenId: bigint) => Promise<string>;
}): Promise<PassportHolder> {
  const plan = await planPassportHolderRead({
    namespace: args.namespace,
    tokenId: args.tokenId,
    registry: args.registry,
  });
  if (!plan.ok) {
    return { status: "refused", cause: plan.cause, detail: plan.detail };
  }

  if (plan.vm === "evm") {
    const passport = karPassportAddress(args.namespace);
    if (passport == null) {
      return { status: "refused", cause: "unresolved_namespace", detail: "passport missing" };
    }
    try {
      const read =
        args.readEvmOwnerOf ??
        (async (addr, tid) => {
          const client = getPublicClient(args.namespace);
          return client.readContract({
            address: addr,
            abi: KarPassportAbi,
            functionName: "ownerOf",
            args: [tid],
          }) as Promise<string>;
        });
      const raw = await read(passport, BigInt(args.tokenId));
      const owner = mintProtocolOwner(args.namespace, raw);
      if (owner == null) {
        return { status: "refused", cause: "owner_unmintable" };
      }
      return { status: "known", owner, source: "chain" };
    } catch (err) {
      return {
        status: "refused",
        cause: "core_decode_failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const fetch = args.fetchAccountData ?? fetchProductSvmAccountData;
  const accountResult = await fetch(plan.assetAddress);
  if (!accountResult.ok) {
    return {
      status: "refused",
      cause: "core_decode_failed",
      detail: `${accountResult.cause}:${accountResult.detail}`,
    };
  }
  const chain = passportHolderChainFromSvmAccountData(
    accountResult.value,
    args.namespace,
  );
  return resolvePassportHolder({ chain, namespace: args.namespace, projectionOwner: null });
}

/**
 * Mode-custody compare for edit admission: EVM mode contract addresses, or
 * SVM `custody_authority` PDAs under each configured mode program.
 * Derivation failure is refused — never silent skip → not held.
 */
export type ModeCustodyHold =
  | { status: "held" }
  | { status: "not_held" }
  | { status: "refused"; cause: string; mode?: string };

export async function passportHeldByModeCustody(args: {
  namespace: number;
  holderOwner: string | undefined;
  registry?: CommercialRegistry;
  derivePda?: typeof deriveSvmPda;
}): Promise<ModeCustodyHold> {
  if (args.holderOwner == null) return { status: "not_held" };
  const modes = commerceModeAddresses(args.namespace, args.registry);
  const stack = commercialActive(args.namespace, args.registry);
  if (stack == null) return { status: "refused", cause: "unresolved_namespace" };

  if (stack.vm === "evm") {
    const custodians = Object.values(modes).map((a) => a.toLowerCase());
    return custodians.includes(args.holderOwner.toLowerCase())
      ? { status: "held" }
      : { status: "not_held" };
  }

  const derive = args.derivePda ?? deriveSvmPda;
  for (const [mode, modeAddress] of Object.entries(modes)) {
    const pda = await derive({
      recipe: "kargain-consignment-base/custody_authority",
      programId: modeAddress,
    });
    if (!pda.ok) {
      return {
        status: "refused",
        cause: `pda_failed:${pda.cause}`,
        mode,
      };
    }
    if (protocolAddressesEqual(args.namespace, args.holderOwner, pda.address)) {
      return { status: "held" };
    }
  }
  return { status: "not_held" };
}
