import type { Chain } from "viem/chains";
import { baseSepolia, hardhat, sepolia } from "viem/chains";

import {
  evmChainOf,
  resolveEvmChain,
  type CommercialRegistry,
  type Eip155ChainId,
  type EvmCommercialActiveStack,
  type ResolveEvmChainCause,
} from "@/lib/web3/commercial-active";

const enableLocalChain = process.env.NEXT_PUBLIC_ENABLE_LOCAL_CHAIN === "1";

export const kargainChains: readonly [Chain, ...Chain[]] = enableLocalChain
  ? [hardhat, baseSepolia, sepolia]
  : [baseSepolia, sepolia];

const byId = new Map<number, Chain>();
for (const c of kargainChains) byId.set(c.id, c);

/** Wagmi write-union id — members of {@link kargainChains} only. */
export type KargainWriteUnionChainId = (typeof kargainChains)[number]["id"];

/**
 * Narrow a commercial {@link Eip155ChainId} to the wagmi write-union.
 * Module-private — callers use {@link evmWagmiChain} / {@link wagmiChainOfStack}.
 */
function writeUnionChainId(chainId: Eip155ChainId): KargainWriteUnionChainId {
  if (!byId.has(chainId)) {
    throw new Error(`writeUnionChainId: ${chainId} is not in the Kargain write-union`);
  }
  return chainId as KargainWriteUnionChainId;
}

export type EvmWagmiChainResult =
  | { ok: true; chainId: KargainWriteUnionChainId; eip155: Eip155ChainId }
  | { ok: false; cause: ResolveEvmChainCause };

/**
 * Sole namespace → wagmi write-union door. Soft Result — never throw for SVM /
 * unresolved. Compose {@link resolveEvmChain} + write-union narrow.
 * `eip155` is the branded identity for ActiveAccount.switchChain (WriteUnion
 * collapses to `number` under viem and cannot invent-ban alone).
 */
export function evmWagmiChain(
  namespace: number | null | undefined,
  registry?: CommercialRegistry,
): EvmWagmiChainResult {
  if (namespace == null || !Number.isFinite(namespace)) {
    return { ok: false, cause: "unresolved_namespace" };
  }
  const resolved = resolveEvmChain(namespace, registry);
  if (!resolved.ok) {
    return resolved;
  }
  return {
    ok: true,
    chainId: writeUnionChainId(resolved.chainId),
    eip155: resolved.chainId,
  };
}

/**
 * Wagmi write-union id from an EVM stack already in hand.
 * Throws only when the commercial EVM id is absent from {@link kargainChains}
 * (registry ↔ write-union invariant — plant covers that).
 */
export function wagmiChainOfStack(
  stack: EvmCommercialActiveStack,
): KargainWriteUnionChainId {
  return writeUnionChainId(evmChainOf(stack));
}

/**
 * Write-union RPC / transport for a {@link Chain} already taken from
 * {@link kargainChains} (includes Hardhat 31337 when local is enabled).
 * Not a namespace door — never called with a raw commercial namespace.
 */
export function rpcUrlForWriteUnionChain(chain: Chain): string {
  return rpcUrlForNumericId(chain.id);
}

/**
 * Viem {@link Chain} for a branded commercial EIP-155 id.
 * Commercial EVM ids are members of {@link kargainChains} — never `undefined`.
 */
export function getViemChain(chainId: Eip155ChainId): Chain {
  const chain = byId.get(chainId);
  if (chain == null) {
    throw new Error(`getViemChain: ${chainId} is not in the Kargain write-union`);
  }
  return chain;
}

/** Public RPC fallbacks — override with NEXT_PUBLIC_RPC_<chainId> or NEXT_PUBLIC_RPC_BY_CHAIN JSON. */
const FALLBACK_RPC: Record<number, string> = {
  31337: "http://127.0.0.1:8545",
  84532: "https://sepolia.base.org",
  /** Ethereum Sepolia — in `kargainChains` / wagmi write union (C4.1). */
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
};

function parseRpcMap(): Record<string, string> {
  const raw = process.env.NEXT_PUBLIC_RPC_BY_CHAIN?.trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function rpcUrlForNumericId(chainId: number): string {
  const fromMap = parseRpcMap()[String(chainId)];
  if (fromMap) return fromMap;
  const single = process.env[`NEXT_PUBLIC_RPC_${chainId}` as keyof NodeJS.ProcessEnv] as
    | string
    | undefined;
  if (single) return single;
  const fb = FALLBACK_RPC[chainId];
  if (fb) return fb;
  throw new Error(`No RPC configured for chain ${chainId}`);
}

/** Call-time env — both BY_CHAIN map and per-chain single override. */
export function rpcUrlForChain(chainId: Eip155ChainId): string {
  return rpcUrlForNumericId(chainId);
}

/** True when `chainId` is in the wagmi write-union table (incl. local Hardhat). */
export function isWriteUnionChainId(chainId: number): boolean {
  return byId.has(chainId);
}
