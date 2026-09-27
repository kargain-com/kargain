/**
 * SVM transaction confirmation owner.
 * Finality: commitment `confirmed` — not caller-supplied.
 *
 * Outcomes: landed_ok / landed_with_error (only at ≥ confirmed with slot),
 * expired (no status at all and confirmed height past submission lifetime),
 * status_unknown (transport ceiling). Never invents slot `0n`; never treats
 * `processed` as expired or landed.
 */

import type { SvmCommercialActiveStack } from "@/lib/web3/commercial-active";
import {
  failingProgramFromLogMessages,
  parseAttributedSvmLandedInstructionErrorOnStack,
  type SvmLandedInstructionError,
} from "@/lib/web3/svm-landed-error";
import type { SvmWriteSubmission } from "@/lib/web3/write-outcome";

export type SvmConfirmCommitment = "confirmed";

/** Owner-chosen finality for SVM writes — never a call-site parameter. */
export const SVM_TX_CONFIRM_COMMITMENT: SvmConfirmCommitment = "confirmed";

export type SvmConfirmOutcome =
  | { kind: "landed_ok"; signature: string; slot: bigint }
  | {
      kind: "landed_with_error";
      signature: string;
      slot: bigint;
      error: unknown;
      failingProgram: string | null;
      landed: SvmLandedInstructionError | null;
    }
  | {
      kind: "expired";
      signature: string;
      lastValidBlockHeight: bigint;
      observedBlockHeight: bigint;
    }
  | { kind: "status_unknown"; signature: string };

export type SvmTxConfirmPort = {
  confirmSubmission: (
    submission: SvmWriteSubmission,
  ) => Promise<SvmConfirmOutcome>;
};

/**
 * Typed carrier so lifecycle / runTx can surface a confirm Outcome without
 * destroying the TransactionError blob in `Error.message`.
 */
export class SvmConfirmRefusal extends Error {
  readonly outcome: Exclude<SvmConfirmOutcome, { kind: "landed_ok" }>;

  constructor(outcome: Exclude<SvmConfirmOutcome, { kind: "landed_ok" }>) {
    super(
      outcome.kind === "expired"
        ? "svm confirm: blockhash expired"
        : outcome.kind === "status_unknown"
          ? "svm confirm: status unknown"
          : "svm confirm: signature landed with error",
    );
    this.name = "SvmConfirmRefusal";
    this.outcome = outcome;
  }
}

export function isSvmConfirmRefusal(err: unknown): err is SvmConfirmRefusal {
  return err instanceof SvmConfirmRefusal;
}

export async function confirmSvmTransaction(
  port: SvmTxConfirmPort,
  submission: SvmWriteSubmission,
): Promise<SvmConfirmOutcome> {
  if (
    typeof submission.signature !== "string" ||
    submission.signature.length === 0
  ) {
    throw new Error("svm confirm: empty signature");
  }
  return port.confirmSubmission(submission);
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

function isConfirmedOrStronger(status: string | null | undefined): boolean {
  return status === SVM_TX_CONFIRM_COMMITMENT || status === "finalized";
}

export type SvmConfirmTransport = {
  getSignatureStatuses: (
    signatures: string[],
  ) => Promise<
    ReadonlyArray<{
      confirmationStatus?: string | null;
      err?: unknown;
      slot?: number | bigint | null;
    } | null>
  >;
  getBlockHeight: () => Promise<bigint>;
  getTransactionLogMessages: (
    signature: string,
  ) => Promise<readonly string[] | null>;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

/**
 * Polling confirm port. Transport stays outside.
 *
 * Per poll: read confirmed block height first, then signature status.
 * `expired` only when the node returns no status at all and that earlier
 * height is past the submission lifetime. `processed` keeps polling.
 */
export function createSvmTxConfirmPort(
  opts: SvmConfirmTransport & { stack: SvmCommercialActiveStack },
): SvmTxConfirmPort {
  const pollIntervalMs = opts.pollIntervalMs ?? 400;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return {
    async confirmSubmission(submission): Promise<SvmConfirmOutcome> {
      const { signature, lastValidBlockHeight } = submission;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const height = await opts.getBlockHeight();
        const [row] = await opts.getSignatureStatuses([signature]);
        const status = row?.confirmationStatus ?? null;

        if (isConfirmedOrStronger(status)) {
          const slot = observedSlot(row?.slot);
          if (slot == null) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            continue;
          }
          if (row?.err != null) {
            const logs = await opts.getTransactionLogMessages(signature);
            const failingProgram = failingProgramFromLogMessages(logs);
            const landed = parseAttributedSvmLandedInstructionErrorOnStack(
              row.err,
              failingProgram,
              opts.stack,
            );
            return {
              kind: "landed_with_error",
              signature,
              slot,
              error: row.err,
              failingProgram,
              landed,
            };
          }
          return { kind: "landed_ok", signature, slot };
        }

        // Any present sub-confirmed status (incl. processed) → keep polling.
        if (status != null) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          continue;
        }

        // No status at all — expire only when height (read first) is past lifetime.
        if (height > lastValidBlockHeight) {
          return {
            kind: "expired",
            signature,
            lastValidBlockHeight,
            observedBlockHeight: height,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      return { kind: "status_unknown", signature };
    },
  };
}
