/**
 * Fail-closed gates for live `pnpm smoke:bridge`.
 * Pure — no I/O, no secrets. Home KarPassport has no user burn; ops must not
 * auto-mint commercial home NFTs (SPEC §7.6 Phase 2 / no silent smoke-mint).
 */

/** Planned mainnet chainIds from SPEC I.9 matrix. Live smoke forbidden here. */
export const SMOKE_BRIDGE_MAINNET_CHAIN_IDS: ReadonlySet<number> = new Set([
  1, 8453, 137,
]);

export class SmokeBridgePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmokeBridgePolicyError";
  }
}

export function isSmokeBridgeMainnetChainId(chainId: number): boolean {
  return SMOKE_BRIDGE_MAINNET_CHAIN_IDS.has(chainId);
}

/**
 * Live bridge smoke requires a pre-minted `--token-id` and must not run on mainnet.
 * Does not mint; callers validate on-chain ownership separately.
 */
export function assertSmokeBridgeAllowed(params: {
  hubChainId: number;
  tokenId: bigint | null;
}): asserts params is { hubChainId: number; tokenId: bigint } {
  const { hubChainId, tokenId } = params;
  if (isSmokeBridgeMainnetChainId(hubChainId)) {
    throw new SmokeBridgePolicyError(
      `Live smoke:bridge is forbidden on mainnet chainId ${hubChainId}. Use bridge:wire:read-only for infra proof; never ops-mint on commercial KarPassport.`,
    );
  }
  if (tokenId == null) {
    throw new SmokeBridgePolicyError(
      "Missing --token-id. Pre-mint a passport with valid metadata (UI or mintPassport), then: pnpm smoke:bridge --token-id <id>. Auto-mint is disabled.",
    );
  }
}
