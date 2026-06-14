import type { Chain } from "viem/chains";
import { baseSepolia, hardhat } from "viem/chains";

const enableLocalChain = process.env.NEXT_PUBLIC_ENABLE_LOCAL_CHAIN === "1";

/** Default chain when unspecified. */
export const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "84532");

export const kargainChains: readonly [Chain, ...Chain[]] = enableLocalChain
  ? [hardhat, baseSepolia]
  : [baseSepolia];

export type KargainChainId = (typeof kargainChains)[number]["id"];

/** Use where `chainId` is parsed from URL/query but wagmi expects the configured chain union. */
export function wagmiChainId(chainId: number): KargainChainId {
  return chainId as KargainChainId;
}

const byId = new Map<number, Chain>();
for (const c of kargainChains) byId.set(c.id, c);

export function getViemChain(chainId: number): Chain | undefined {
  return byId.get(chainId);
}

/** Public RPC fallbacks — override with NEXT_PUBLIC_RPC_<chainId> or NEXT_PUBLIC_RPC_BY_CHAIN JSON. */
const FALLBACK_RPC: Record<number, string> = {
  31337: "http://127.0.0.1:8545",
  84532: "https://sepolia.base.org",
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
