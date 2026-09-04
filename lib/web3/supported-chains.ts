import type { Chain } from "viem/chains";
import { baseSepolia, hardhat, sepolia } from "viem/chains";

import { eip155Of, isCommercialEip155Id, isCommercialNamespace } from "@/lib/web3/commercial-active";

const enableLocalChain = process.env.NEXT_PUBLIC_ENABLE_LOCAL_CHAIN === "1";

export const kargainChains: readonly [Chain, ...Chain[]] = enableLocalChain
  ? [hardhat, baseSepolia, sepolia]
  : [baseSepolia, sepolia];

export type KargainChainId = (typeof kargainChains)[number]["id"];

const byId = new Map<number, Chain>();
for (const c of kargainChains) byId.set(c.id, c);

/**
 * Use where `chainId` is parsed from URL/query but wagmi expects the configured chain union.
 * Commercial namespaces resolve EIP-155 via `eip155Of` (never a blind cast).
 */
export function wagmiChainId(chainId: number): KargainChainId {
  // Commercial but not EVM EIP-155 ⇒ reserved-band / SVM namespace — never a wagmi chain.
  if (isCommercialNamespace(chainId) && !isCommercialEip155Id(chainId)) {
    throw new Error(
      `wagmiChainId: namespace ${chainId} is SVM — not an EIP-155 wagmi chain`,
    );
  }
  const eip155 = isCommercialEip155Id(chainId) ? eip155Of(chainId) : chainId;
  if (!byId.has(eip155)) {
    throw new Error(`wagmiChainId: ${chainId} is not in the Kargain write-union`);
  }
  return eip155 as KargainChainId;
}

export function getViemChain(chainId: number): Chain | undefined {
  return byId.get(chainId);
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

const rpcMap = parseRpcMap();

export function rpcUrlForChain(chainId: number): string {
  const fromMap = rpcMap[String(chainId)];
  if (fromMap) return fromMap;
  const single = process.env[`NEXT_PUBLIC_RPC_${chainId}` as keyof NodeJS.ProcessEnv] as string | undefined;
  if (single) return single;
  const fb = FALLBACK_RPC[chainId];
  if (fb) return fb;
  throw new Error(`No RPC configured for chain ${chainId}`);
}

export function shortChainName(chainId: number): string {
  const c = byId.get(chainId);
  if (!c) return "Unknown network";
  return c.name;
}
