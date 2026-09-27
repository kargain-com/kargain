/**
 * SVM transaction confirmation owner (S8-3).
 * Finality is decided here: commitment level `confirmed` — not caller-supplied.
 *
 * Returns a closed {@link SvmConfirmOutcome}: landed ok with an *observed* slot,
 * landed with the structured TransactionError blob, or timeout.
 * Never stringifies the error object; never invents slot `0n`.
 */

export type SvmConfirmCommitment = "confirmed";

/** Owner-chosen finality for SVM writes — never a call-site parameter. */
export const SVM_TX_CONFIRM_COMMITMENT: SvmConfirmCommitment = "confirmed";

export type SvmConfirmOutcome =
  | { kind: "landed_ok"; signature: string; slot: bigint }
  | { kind: "landed_with_error"; signature: string; error: unknown }
  | { kind: "confirm_timeout"; signature: string; timeoutMs: number };

/** @deprecated Use {@link SvmConfirmOutcome} `landed_ok` — kept as alias for slot shape. */
export type SvmTxConfirmStatus = {
  signature: string;
  slot: bigint;
};

export type SvmTxConfirmPort = {
  /**
   * Wait until `signature` reaches {@link SVM_TX_CONFIRM_COMMITMENT} (or
   * lands with an error / times out).
   */
  confirmSignature: (signature: string) => Promise<SvmConfirmOutcome>;
};

/**
 * Typed carrier so lifecycle / runTx can surface a confirm Outcome without
 * destroying the TransactionError blob in `Error.message`.
 */
export class SvmConfirmRefusal extends Error {
  readonly outcome: Exclude<SvmConfirmOutcome, { kind: "landed_ok" }>;

  constructor(outcome: Exclude<SvmConfirmOutcome, { kind: "landed_ok" }>) {
    super(
      outcome.kind === "confirm_timeout"
        ? `svm confirm: timed out after ${outcome.timeoutMs}ms`
        : "svm confirm: signature landed with error",
    );
    this.name = "SvmConfirmRefusal";
    this.outcome = outcome;
  }
}

export function isSvmConfirmRefusal(err: unknown): err is SvmConfirmRefusal {
  return err instanceof SvmConfirmRefusal;
}

/**
 * Confirm an SVM signature at the owner commitment.
 * Product code must only reach this via use-tx-sync / SVM lifecycle.
 */
export async function confirmSvmTransaction(
  port: SvmTxConfirmPort,
  signature: string,
): Promise<SvmConfirmOutcome> {
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("svm confirm: empty signature");
  }
  return port.confirmSignature(signature);
}

function observedSlot(
  slotRaw: number | bigint | null | undefined,
): bigint | null {
  if (typeof slotRaw === "bigint") return slotRaw;
  if (typeof slotRaw === "number" && Number.isFinite(slotRaw)) {
    return BigInt(slotRaw);
  }
  return null;
}

/**
 * Polling confirm port: waits for `confirmed` (or stronger `finalized`) with
 * an observed slot, or returns landed error / timeout. Transport stays outside.
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
    async confirmSignature(signature: string): Promise<SvmConfirmOutcome> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const [row] = await opts.getSignatureStatuses([signature]);
        if (row?.err != null) {
          return {
            kind: "landed_with_error",
            signature,
            error: row.err,
          };
        }
        const status = row?.confirmationStatus;
        if (status === SVM_TX_CONFIRM_COMMITMENT || status === "finalized") {
          const slot = observedSlot(row?.slot);
          if (slot == null) {
            // Confirmed without an observed slot is not landed_ok — keep polling.
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            continue;
          }
          return { kind: "landed_ok", signature, slot };
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      return { kind: "confirm_timeout", signature, timeoutMs };
    },
  };
}
