/**
 * Sole System-program Transfer instruction data encoder for product SVM native sends.
 * Layout: u32 le index=2 (Transfer) + u64 le lamports.
 * Goldens vs `@solana/web3.js` SystemProgram.transfer live in the policy suite.
 */

export type EncodeSystemTransferCause =
  | "lamports_not_u64"
  | "lamports_zero";

export type EncodeSystemTransferResult =
  | { ok: true; data: Uint8Array }
  | { ok: false; cause: EncodeSystemTransferCause };

/** SystemProgram Transfer instruction index (solana_program::system_instruction). */
export const SYSTEM_TRANSFER_IX_INDEX = 2;

/**
 * Encode System Transfer instruction data for the given lamport amount.
 * Does not assemble accounts — the write adapter attaches from/to metas.
 */
export function encodeSystemTransfer(
  lamports: bigint,
): EncodeSystemTransferResult {
  if (lamports <= 0n) {
    return { ok: false, cause: "lamports_zero" };
  }
  if (lamports > 0xffff_ffff_ffff_ffffn) {
    return { ok: false, cause: "lamports_not_u64" };
  }
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setUint32(0, SYSTEM_TRANSFER_IX_INDEX, true);
  view.setBigUint64(4, lamports, true);
  return { ok: true, data };
}
