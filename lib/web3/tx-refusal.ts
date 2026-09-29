import type { Hex } from "viem";

import type { SvmLandedInstructionError } from "@/lib/web3/svm-landed-error";
import { isSvmWriteOwnerRefusal } from "@/lib/web3/svm-write-owner-refusal";
import {
  isTxWriteGuardRefusal,
  type TxWriteGuardPayload,
} from "@/lib/web3/tx-write-availability";
import { isWalletRejection } from "@/lib/web3/wallet-rejection";
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

/**
 * Map a writeFn throw (after confirm refusals) to {@link TxRefusal}.
 * Sole owner of SvmWriteOwnerRefusal → wallet_rejected / write_refused.
 */
export function txRefusalFromWriteFnError(err: unknown): TxRefusal {
  if (isTxWriteGuardRefusal(err)) {
    return { kind: "guard_refused", refusal: err.refusal };
  }
  if (isSvmWriteOwnerRefusal(err) && err.cause === "wallet_rejected") {
    return { kind: "wallet_rejected" };
  }
  if (isWalletRejection(err)) {
    return { kind: "wallet_rejected" };
  }
  return { kind: "write_refused", error: err };
}
