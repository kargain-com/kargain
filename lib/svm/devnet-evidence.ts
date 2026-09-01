/**
 * Sole type owner: Solana Devnet deploy evidence wire shape (`deployments/svm-{eid}.json`).
 * Loaders live in scripts/lib/load-deployment.ts — lib must not import scripts.
 */

export type SvmDevnetProgramEvidence = {
  programId: string;
  soSha256?: string;
  soBytes?: number;
  upgradeAuthority?: string;
};

export type SvmDevnetPathwayPeers = {
  hubEid: 40245;
  spokeEid: 40168;
  hubOApp: `0x${string}`;
  spokeOApp: string;
};

export type SvmDevnetEvidence = {
  cluster: string;
  eid: number;
  namespace: number;
  /** First slot svm-ingest follows (deploy boundary — no historical backfill). */
  indexFromSlot?: number;
  /** Legacy deploy evidence field — prefer indexFromSlot. */
  slotAtEvidence?: number;
  programs: {
    kar_passport: SvmDevnetProgramEvidence;
    kar_gateway: SvmDevnetProgramEvidence;
    mock_staking?: SvmDevnetProgramEvidence;
    kar_pro_staking?: SvmDevnetProgramEvidence;
    kar_pro_pass?: SvmDevnetProgramEvidence;
    kar_fixed_price?: SvmDevnetProgramEvidence;
    kar_ascending?: SvmDevnetProgramEvidence;
  };
  /** S5 — stated testnet constant or mainnet observed-rate pin (join never quotes FX). */
  minStakePin?: {
    kind: "stated_testnet_constant" | "observed_mainnet_rate";
    declaredEthWeightWei: string;
    declaredEthFloorWei: string;
    solLamports: string;
    floorLamports: string;
    source: string;
    declaredAt: string;
  } | null;
  peers?: SvmDevnetPathwayPeers | null;
  pathwayConfigHash?: `0x${string}` | null;
  [key: string]: unknown;
};
