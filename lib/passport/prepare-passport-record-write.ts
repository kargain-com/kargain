/**
 * Preparation before passport AppendRecord / clarification / ReportDiscrepancy /
 * AppendAttestation evidence upload (U6.3 / U6.4 / U6.5). EVM + evidence file →
 * ensureSiweSession (behaviour unchanged from the prior panel helper). SVM →
 * named nothing-required. Paste-only / no file → named none_required (SIWE
 * skipped, same as before).
 *
 * Panel never calls ensureSiweSession for append, clarification, discrepancy,
 * or attestation — this prep owns the SIWE gate for those actions.
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
  txWriteAvailabilityForCapability,
  type TxWriteUnavailable,
} from "@/lib/web3/tx-write-availability";

/** Capabilities that may run through record-write prep (caller supplies). */
export type PassportRecordWriteCapability =
  | "append_passport_record"
  | "report_passport_discrepancy"
  | "append_passport_attestation";

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
  /** Action being prepared — prep does not choose a capability. */
  capability: PassportRecordWriteCapability;
  evidenceFile: File | null;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
  ensureSiweSession?: EnsureSiwe;
  registry?: CommercialRegistry;
}): Promise<PassportRecordWritePrep> {
  const avail = txWriteAvailabilityForCapability(
    args.account,
    args.capability,
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
  if (
    refusal.cause === "disconnected" ||
    refusal.cause === "unresolved_namespace"
  ) {
    return { ok: false, cause: refusal.cause };
  }
  // Dual-VM record capabilities are supported on both VMs — support causes are
  // unreachable here; fail closed without inventing a session family.
  return { ok: false, cause: "unresolved_namespace" };
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
