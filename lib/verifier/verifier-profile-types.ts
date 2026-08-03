export type KarProVerifierProfile = {
  /** Commercial chain of this membership (SPEC §I.12.12). */
  chainId: number;
  address: string;
  category: number;
  name: string;
  slug: string;
  metadataURI: string;
  active: boolean;
  joinedAt: number;
  verificationCount: number;
  verificationFee: bigint;
};
