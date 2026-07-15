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
} as const;
