/**
 * Preparation before passport AppendRecord / clarification evidence upload (U6.3).
 * EVM + evidence file → ensureSiweSession (behaviour unchanged from the prior
 * panel helper). SVM → named nothing-required. Paste-only / no file → named
 * none_required (SIWE skipped, same as before).
 *
 * Panel never calls ensureSiweSession for these two actions; attestation and
 * discrepancy keep their own inline SIWE paths.
 */

import { ensureSiweSession as defaultEnsureSiweSession } from "@/lib/auth/ensure-siwe-session";
import {
  requireEvmSession,
  wrongVmActionCopy,
  type ActiveAccount,
  type WalletFamilyWanted,
} from "@/lib/web3/active-account";
import type { CommercialRegistry } from "@/lib/web3/commercial-active";
import {
  txWriteAvailability,
  type TxWriteUnavailable,
} from "@/lib/web3/tx-write-availability";

export type PassportRecordWritePrep =
  | { ok: true; prep: "evm_prepared" }
  | { ok: true; prep: "svm_none_required" }
  | { ok: true; prep: "none_required" }
  | {
      ok: false;
      cause: "disconnected" | "wrong_vm" | "unresolved_namespace";
      wanted?: WalletFamilyWanted;
    };

type EnsureSiwe = typeof defaultEnsureSiweSession;

/**
 * Await before evidence file upload / append write. Paste-only skips SIWE.
 */
export async function preparePassportRecordWrite(args: {
  account: ActiveAccount;
  targetChainId: number;
  evidenceFile: File | null;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
  ensureSiweSession?: EnsureSiwe;
  registry?: CommercialRegistry;
}): Promise<PassportRecordWritePrep> {
  const avail = txWriteAvailability(
    args.account,
    args.targetChainId,
    args.registry,
  );
  if (!avail.available) {
    return unavailableToPrep(avail);
  }

  if (avail.vm === "svm") {
    return { ok: true, prep: "svm_none_required" };
  }

  if (args.evidenceFile == null) {
    return { ok: true, prep: "none_required" };
  }

  const session = requireEvmSession(args.account);
  if (!session.ok) {
    return { ok: false, cause: session.cause };
  }

  const ensureSiwe = args.ensureSiweSession ?? defaultEnsureSiweSession;
  await ensureSiwe({
    address: session.address,
    chainId: args.targetChainId,
    signMessageAsync: args.signMessageAsync,
  });

  return { ok: true, prep: "evm_prepared" };
}

function unavailableToPrep(refusal: TxWriteUnavailable): PassportRecordWritePrep {
  if (refusal.cause === "wrong_vm") {
    return { ok: false, cause: "wrong_vm", wanted: refusal.wanted };
  }
  return { ok: false, cause: refusal.cause };
}

/** Stable English when prep refuses before evidence upload / append. */
export function passportRecordWritePrepRefusalMessage(
  prep: Extract<PassportRecordWritePrep, { ok: false }>,
): string {
  switch (prep.cause) {
    case "disconnected":
      return "Connect a wallet to continue.";
    case "wrong_vm":
      return wrongVmActionCopy(prep.wanted ?? "evm");
    case "unresolved_namespace":
      return "This network is not available for commercial writes.";
  }
}
