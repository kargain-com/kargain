/**
 * Local cross-VM stand constants — **not** COMMERCIAL_ACTIVE.
 * EVM side uses Hardhat dual-network EIDs from the gateway suite; SVM uses
 * the Solana Devnet EID expressed in the S2 snapshot (config-only locally).
 */

import { DECLARED_PASSPORT_URI_CEILING_BYTES } from "../../lib/web3/declared-uri-ceiling";

/** Hardhat EndpointV2Mock eid for the EVM stand side (matches gateway suite hub). */
export const STAND_EVM_EID = 1;

/** Local SVM mock Endpoint eid — config PDA, not a commercial registry row. */
export const STAND_SVM_EID = 40168;

/** EVM home namespace (Base Sepolia chain id used as high 128 bits). */
export const STAND_EVM_NAMESPACE = 84532n;

/** SVM home namespace (SPEC §I.13 Solana Devnet-shaped; config-only on the stand). */
export const STAND_SVM_NAMESPACE = 2_000_040_168n;

export const STAND_TYPICAL_URI = "ar://stand-typical-pointer";

/** URI of exactly {@link DECLARED_PASSPORT_URI_CEILING_BYTES} UTF-8 bytes (`ar://` + pad). */
export const STAND_URI_AT_CEILING = `ar://${"x".repeat(
  DECLARED_PASSPORT_URI_CEILING_BYTES - "ar://".length,
)}`;

/**
 * Historical S4a measure URI (731 B) — lab/RESULTS only; not the product ceiling.
 * @deprecated Prefer {@link STAND_URI_AT_CEILING}.
 */
export const STAND_URI_HISTORICAL_731 = `ar://${"x".repeat(726)}`;

/**
 * Live stand URI — declared ceiling (N6-4 product path).
 * Set `KARGAIN_SVM_STAND_URI_TYPICAL=1` to use the short typical pointer instead.
 */
export function standLiveUri(): string {
  if (process.env.KARGAIN_SVM_STAND_URI_TYPICAL === "1") {
    return STAND_TYPICAL_URI;
  }
  if (STAND_URI_AT_CEILING.length !== DECLARED_PASSPORT_URI_CEILING_BYTES) {
    throw new Error(
      `STAND_URI_AT_CEILING length ${STAND_URI_AT_CEILING.length} ≠ ${DECLARED_PASSPORT_URI_CEILING_BYTES}`,
    );
  }
  return STAND_URI_AT_CEILING;
}
