import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export function parseChainParam(
  raw: string | string[] | undefined | null,
  fallback: number = DEFAULT_CHAIN_ID,
): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
