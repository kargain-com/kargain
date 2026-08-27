/**
 * Local cross-VM stand constants — **not** COMMERCIAL_ACTIVE.
 * EVM side uses Hardhat dual-network EIDs from the gateway suite; SVM uses
 * the Solana Devnet EID expressed in the S2 snapshot (config-only locally).
 */

/** Hardhat EndpointV2Mock eid for the EVM stand side (matches gateway suite hub). */
export const STAND_EVM_EID = 1;

/** Local SVM mock Endpoint eid — config PDA, not a commercial registry row. */
export const STAND_SVM_EID = 40168;

/** EVM home namespace (Base Sepolia chain id used as high 128 bits). */
export const STAND_EVM_NAMESPACE = 84532n;

/** SVM home namespace (SPEC §I.13 Solana Devnet-shaped; config-only on the stand). */
export const STAND_SVM_NAMESPACE = 2_000_040_168n;

export const STAND_TYPICAL_URI = "ar://stand-typical-pointer";
