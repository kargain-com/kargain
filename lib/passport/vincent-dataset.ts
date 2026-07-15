/**
 * Pinned Vincent dataset for the Base Sepolia validation epoch.
 * Canonical table: vincent repo `docs/contracts/README.md`.
 * On mainnet genesis, replace this descriptor in one place.
 *
 * Switch procedure (F-4, flywheel §10 decision 3): the decoder always reads
 * this pin — there is no auto-switch. When a community epoch clears the
 * §4.4 acceptance bar (the KarPro Commons governance panel shows it as the
 * "Eligible root", computed by `lib/vincent-commons/acceptance.ts` against
 * `VINCENT_REGISTRY.acceptancePolicy`), a maintainer updates this one
 * descriptor to that epoch's root/publisher/tag as a recorded edit.
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
