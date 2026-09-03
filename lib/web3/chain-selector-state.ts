import { getViemChain, kargainChains } from "@/lib/web3/supported-chains";
import type { ActiveAccount } from "@/lib/web3/active-account";

/** True when `chainId` is in the wagmi write-union (`kargainChains`). */
export function isKargainWriteChain(chainId: number): boolean {
  return getViemChain(chainId) != null;
}

export type ChainSelectorState = "ok" | "wrong_network" | "wrong_vm";

/**
 * Three-state chain selector derive (design-spec §4.7).
 * - `wrong_vm` — connected wallet family cannot act on the expected network
 * - `wrong_network` — same VM, wrong chain / unsupported EVM chain
 * - `ok` — disconnected, or EVM session matches expectation
 *
 * Screen chrome for `wrong_vm` is the screens slice — this slice only owns state.
 */
export function deriveChainSelectorState(input: {
  account: ActiveAccount;
  /** Present only when URL/page explicitly requires a chain — never DEFAULT fallback. */
  expectedChainId?: number | null;
}): ChainSelectorState {
  if (input.account.status !== "connected") return "ok";

  if (input.account.vm === "svm") {
    // Connected Solana cannot switch into an EVM commercial network.
    return "wrong_vm";
  }

  const walletChainId = input.account.chainId;
  if (!isKargainWriteChain(walletChainId)) return "wrong_network";
  if (input.expectedChainId == null) return "ok";
  return walletChainId === input.expectedChainId ? "ok" : "wrong_network";
}

/**
 * Wrong-network for the nav chain selector (EVM boolean legacy).
 * Does not surface `wrong_vm` — use {@link deriveChainSelectorState} for the third state.
 * - Unsupported wallet → wrong
 * - When `expectedChainId` is set (URL `?chain=`), wallet must match
 * - No expected → any write-union chain is OK (do not force hub default)
 */
export function deriveChainSelectorWrong(input: {
  isConnected: boolean;
  walletChainId: number;
  /** Present only when URL/page explicitly requires a chain — never DEFAULT fallback. */
  expectedChainId?: number | null;
}): boolean {
  if (!input.isConnected) return false;
  if (!isKargainWriteChain(input.walletChainId)) return true;
  if (input.expectedChainId == null) return false;
  return input.walletChainId !== input.expectedChainId;
}

/**
 * Chains offered in the wrong-state switch menu (write-union order).
 * Empty when the selector state is `wrong_vm` — switching cannot change VM.
 */
export function chainSelectorSwitchTargets(
  expectedChainId?: number | null,
  state?: ChainSelectorState,
): readonly number[] {
  if (state === "wrong_vm") return [];
  if (expectedChainId != null && isKargainWriteChain(expectedChainId)) {
    return [expectedChainId];
  }
  return kargainChains.map((c) => c.id);
}
