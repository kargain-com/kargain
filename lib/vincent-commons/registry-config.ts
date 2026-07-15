/**
 * Pinned VincentAnchorRegistry descriptor for the Base Sepolia validation epoch.
 * CREATE2 deployment — same address on every EVM chain.
 * Canonical table: vincent repo `docs/contracts/README.md`.
 * On mainnet genesis, replace this descriptor in one place.
 */
export const VINCENT_REGISTRY = {
  registryAddress:
    "0x06667DB3795C70F34b7517D1Af1217D3167BE241" as `0x${string}`,
  chainId: 84532,
  /**
   * Client acceptance-bar policy (flywheel §4.4, §10.1 F-4 refinement).
   * The confirmation minimum is a pinned client parameter — data, not code:
   * 1 on Base Sepolia validation (N=2 active verifiers makes ≥2 independent
   * confirmations mathematically unreachable — publisher + one confirmer is
   * the maximum); ≥2 on mainnet. Canon selection is client policy by
   * protocol design (§9).
   */
  acceptancePolicy: {
    minIndependentConfirmations: 1,
  },
} as const;
