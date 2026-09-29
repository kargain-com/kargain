import type { Hex } from "viem";

import type { SvmLandedInstructionError } from "@/lib/web3/svm-landed-error";
import type { TxWriteGuardPayload } from "@/lib/web3/tx-write-availability";
import type { WriteOutcome } from "@/lib/web3/write-outcome";

/**
 * Typed write refusal across every `runTx`.
 * No arm carries a display `message` — owners classify thrown values;
 * chrome sentences come from owner copy functions only.
 */
export type TxRefusal =
  | { kind: "wallet_rejected" }
  | { kind: "guard_refused"; refusal: TxWriteGuardPayload }
  | { kind: "write_refused"; error: unknown }
  | {
      kind: "expired";
      signature: string;
      lastValidBlockHeight: bigint;
      observedBlockHeight: bigint;
    }
  | { kind: "status_unknown"; writeReference: string }
  | {
      kind: "landed_with_error";
      signature: string;
      slot: bigint;
      error: unknown;
      failingProgram: string | null;
      landed: SvmLandedInstructionError | null;
    }
  | {
      kind: "reverted";
      writeReference: string;
      blockNumber: bigint;
      /** Raw returndata from eth_call replay — null when unavailable. */
      revertData: Hex | null;
    }
  | {
      kind: "superseded";
      writeReference: string;
      replacementHash: `0x${string}`;
      reason: "cancelled" | "replaced";
    };

export type RunTxResult =
  | { ok: true; outcome: WriteOutcome }
  | { ok: false; refusal: TxRefusal };
