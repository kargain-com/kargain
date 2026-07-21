/**
 * Per-chain Ponder JSON-RPC rate limits (maxRequestsPerSecond).
 * Defaults match typical public / free-tier capacity; override via PONDER_MAX_RPS_<chainId>.
 */

export const PONDER_MAX_RPS_DEFAULTS: Readonly<Record<number, number>> = {
  84532: 10,
  11155111: 5,
  31337: 20,
};

/** Parse a positive finite RPS; invalid or empty → undefined (caller uses default). */
export function parseMaxRequestsPerSecond(
  raw: string | undefined,
): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/**
 * Resolve maxRequestsPerSecond for a commercial / local chain.
 * Env key: `PONDER_MAX_RPS_${chainId}` (e.g. PONDER_MAX_RPS_11155111).
 */
export function resolveMaxRequestsPerSecond(
  chainId: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const fromEnv = parseMaxRequestsPerSecond(env[`PONDER_MAX_RPS_${chainId}`]);
  if (fromEnv !== undefined) return fromEnv;
  const fallback = PONDER_MAX_RPS_DEFAULTS[chainId];
  if (fallback !== undefined) return fallback;
  throw new Error(
    `No PONDER_MAX_RPS default for chain ${chainId} — set PONDER_MAX_RPS_${chainId}`,
  );
}
