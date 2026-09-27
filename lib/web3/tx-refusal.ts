import type { SvmLandedInstructionError } from "@/lib/web3/svm-landed-error";
import type { WriteOutcome } from "@/lib/web3/write-outcome";

export type TxRefusal =
  | { kind: "wallet_rejected" }
  | { kind: "pre_send"; message: string }
  | { kind: "write_failed"; message: string }
  | {
      kind: "expired";
      signature: string;
      lastValidBlockHeight: bigint;
      observedBlockHeight: bigint;
    }
  | { kind: "status_unknown"; signature: string }
  | {
      kind: "landed_with_error";
      signature: string;
      slot: bigint;
      error: unknown;
      failingProgram: string | null;
      landed: SvmLandedInstructionError | null;
    };

export type RunTxResult =
  | { ok: true; outcome: WriteOutcome }
  | { ok: false; refusal: TxRefusal };
