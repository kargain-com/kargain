import type { PassportStatus } from "@/lib/types/ponder";

export type DisputedPassportRow = {
  tokenId: string;
  status: PassportStatus;
  make: string;
  model: string;
  year: number;
  disputeReason: string;
  disputeOpenedAt: number;
  lastDisputer: string;
};

export type KarProVerifierProfile = {
  address: string;
  category: number;
  name: string;
  slug: string;
  metadataURI: string;
  active: boolean;
  joinedAt: number;
  verificationCount: number;
  verificationFee: bigint;
  disputedPassports: DisputedPassportRow[];
};
