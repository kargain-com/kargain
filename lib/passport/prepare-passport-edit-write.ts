/**
 * EVM-only preparation before a passport edit write (U6.1).
 * Panel always awaits this before Irys / setPassportUri — SVM returns a named
 * "nothing required" result, never a silent skip.
 */

import { ensureSiweSession as defaultEnsureSiweSession } from "@/lib/auth/ensure-siwe-session";
import {
  evmSwitchChainAvailability,
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
import { wagmiChainId } from "@/lib/web3/supported-chains";

export type PassportEditWritePrep =
  | { ok: true; prep: "evm_prepared" }
  | { ok: true; prep: "svm_none_required" }
  | {
      ok: false;
      cause: "disconnected" | "wrong_vm" | "unresolved_namespace" | "switch_unavailable";
      wanted?: WalletFamilyWanted;
      switchCause?: "disconnected" | "wrong_vm";
    };

export type PassportEditSwitchPrompt =
  | { show: true; switchAvail: ReturnType<typeof evmSwitchChainAvailability> }
  | { show: false };

/**
 * Wrong-network banner for the edit wizard — show only when an EVM session is
 * on a different wallet chain than the passport target. SVM / disconnected →
 * `{ show: false }` (no invent).
 */
export function passportEditSwitchPrompt(
  account: ActiveAccount,
  targetChainId: number,
): PassportEditSwitchPrompt {
  const session = requireEvmSession(account);
  if (!session.ok) return { show: false };
  if (session.chainId === targetChainId) return { show: false };
  return {
    show: true,
    switchAvail: evmSwitchChainAvailability(account),
  };
}

type EnsureSiwe = typeof defaultEnsureSiweSession;

/**
 * Run EVM chain-switch + SIWE when the target stack wants EVM; name that SVM
 * needs no equivalent prep. Call sites must await this before the write.
 */
export async function preparePassportEditWrite(args: {
  account: ActiveAccount;
  targetChainId: number;
  switchChain: (chainId: number) => Promise<void>;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
  ensureSiweSession?: EnsureSiwe;
  registry?: CommercialRegistry;
}): Promise<PassportEditWritePrep> {
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

  const session = requireEvmSession(args.account);
  if (!session.ok) {
    return { ok: false, cause: session.cause };
  }

  if (avail.walletChainId !== args.targetChainId) {
    const switchAvail = evmSwitchChainAvailability(args.account);
    if (!switchAvail.available) {
      return {
        ok: false,
        cause: "switch_unavailable",
        switchCause: switchAvail.cause,
      };
    }
    await args.switchChain(wagmiChainId(args.targetChainId));
  }

  const ensureSiwe = args.ensureSiweSession ?? defaultEnsureSiweSession;
  await ensureSiwe({
    address: session.address,
    chainId: args.targetChainId,
    signMessageAsync: args.signMessageAsync,
  });

  return { ok: true, prep: "evm_prepared" };
}

function unavailableToPrep(refusal: TxWriteUnavailable): PassportEditWritePrep {
  if (refusal.cause === "wrong_vm") {
    return { ok: false, cause: "wrong_vm", wanted: refusal.wanted };
  }
  return { ok: false, cause: refusal.cause };
}

/** Stable English when prep refuses before Irys / set-URI. */
export function passportEditWritePrepRefusalMessage(
  prep: Extract<PassportEditWritePrep, { ok: false }>,
): string {
  switch (prep.cause) {
    case "disconnected":
      return "Connect a wallet to continue.";
    case "wrong_vm":
      return wrongVmActionCopy(prep.wanted ?? "evm");
    case "unresolved_namespace":
      return "This network is not available for commercial writes.";
    case "switch_unavailable":
      return `switchChain unavailable: ${prep.switchCause ?? "unknown"}`;
  }
}
