/**
 * Pinned Vincent dataset for the Base Sepolia validation epoch.
 * Canonical table: vincent repo `docs/contracts/README.md`.
 * On mainnet genesis, replace this descriptor in one place.
 */
export const VINCENT_DATASET = {
  merkleRoot:
    "sha256:bb435fb87cc6be1394113c5e8a1c640030c54719dd2a06785db81bae18285a90",
  publisher: "0xcf1eb0e7ed453ed266bf90e7c09e0e4769580b77",
  /** 1-based Arweave `Epoch` tag (not the on-chain epoch index). */
  arweaveEpochTag: "2",
  gatewayUrl: "https://testnet-gateway.irys.xyz",
  graphqlUrl: "https://uploader.irys.xyz/graphql",
} as const;
