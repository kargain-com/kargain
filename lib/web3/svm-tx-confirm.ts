/**
 * SVM transaction confirmation owner (S8-3).
 * Finality is decided here: commitment level `confirmed` — not caller-supplied.
 * Commercial SVM sends are refused until a COMMERCIAL_ACTIVE row exists (S9);
 * tests prove the confirm path against an injected signature status.
 */

export type SvmConfirmCommitment = "confirmed";

/** Owner-chosen finality for SVM writes — never a call-site parameter. */
export const SVM_TX_CONFIRM_COMMITMENT: SvmConfirmCommitment = "confirmed";

export type SvmTxConfirmStatus = {
  /** Base58 signature. */
  signature: string;
  /** Slot at which the signature reached the owner commitment. */
  slot: bigint;
};

export type SvmTxConfirmPort = {
  /**
   * Wait until `signature` reaches {@link SVM_TX_CONFIRM_COMMITMENT}.
   * Implementations must not accept a weaker commitment from the caller.
   */
  confirmSignature: (signature: string) => Promise<SvmTxConfirmStatus>;
};

/**
 * Confirm an SVM signature at the owner commitment.
 * Product code must only reach this via use-tx-sync.
 */
export async function confirmSvmTransaction(
  port: SvmTxConfirmPort,
  signature: string,
): Promise<SvmTxConfirmStatus> {
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("svm confirm: empty signature");
  }
  return port.confirmSignature(signature);
}

/**
 * Polling confirm port: waits for `confirmed` (or stronger `finalized`) and
 * returns the reached slot. Transport details stay outside this owner.
 */
export function createSvmTxConfirmPort(opts: {
  getSignatureStatuses: (
    signatures: string[],
  ) => Promise<
    ReadonlyArray<{
      confirmationStatus?: string | null;
      err?: unknown;
      slot?: number | bigint | null;
    } | null>
  >;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): SvmTxConfirmPort {
  const pollIntervalMs = opts.pollIntervalMs ?? 400;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return {
    async confirmSignature(signature: string): Promise<SvmTxConfirmStatus> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const [row] = await opts.getSignatureStatuses([signature]);
        if (row?.err) {
          throw new Error(`svm confirm: signature failed (${String(row.err)})`);
        }
        const status = row?.confirmationStatus;
        if (status === SVM_TX_CONFIRM_COMMITMENT || status === "finalized") {
          const slotRaw = row?.slot;
          const slot =
            typeof slotRaw === "bigint"
              ? slotRaw
              : typeof slotRaw === "number"
                ? BigInt(slotRaw)
                : 0n;
          return { signature, slot };
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      throw new Error("svm confirm: timed out waiting for confirmed");
    },
  };
}
