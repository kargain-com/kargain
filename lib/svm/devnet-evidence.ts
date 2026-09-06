/**
 * Sole type owner: Solana Devnet deploy evidence wire shape (`deployments/svm-{eid}.json`).
 * Loaders live in scripts/lib/load-deployment.ts — lib must not import scripts.
 *
 * Progressive fill: passport + gateway are the baseline Devnet shape; staking / pass /
 * modes become present as S5 / S9-0 land. Commercial ingest completeness is
 * `assertSvmCommercialStack` on the registry row; evidence gaps remain for
 * deploy-machine tooling only — not the shared loader.
 */

export type SvmDevnetProgramEvidence = {
  programId: string;
  /** Slot at which this programId became followable — required by commercial census. */
  deploySlot?: number;
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
  rpcUrl?: string;
  /** Commercial / ingest namespace — confirmable by SVM_INGEST_NAMESPACE. */
  namespace?: number;
  layerZeroEndpoint?: string;
  deployerPubkey?: string;
  gatewayConfigAuthority?: string;
  forfeitRecipient?: string;
  upgradeAuthority?: string;
  /**
   * Optional annotation only — ingest ignores this.
   * Follow cursor = min(programs[k].deploySlot) over the six commercial keys.
   */
  indexFromSlot?: number;
  /**
   * Snapshot-only (when evidence was written). Never an ingest follow cursor.
   */
  slotAtEvidence?: number;
  programs: {
    kar_passport: SvmDevnetProgramEvidence;
    kar_gateway: SvmDevnetProgramEvidence;
    kar_pro_staking?: SvmDevnetProgramEvidence;
    kar_pro_pass?: SvmDevnetProgramEvidence;
    kar_fixed_price?: SvmDevnetProgramEvidence;
    kar_ascending?: SvmDevnetProgramEvidence;
    /** Stand-only mock — never a commercial ingest follow. */
    mock_staking?: SvmDevnetProgramEvidence;
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
