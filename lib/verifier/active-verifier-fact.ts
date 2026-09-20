/**
 * Sole dual-VM owner of the active-verifier admission fact (U6.5).
 *
 * This is a deliberate narrow exception to the "no decode for chrome" law:
 * an admission gate cannot rest on a fact that is structurally unknowable on
 * one commercial network. Display values (e.g. current verification fee) stay
 * named-unread on SVM.
 *
 * Tri-state — never a plain boolean that hides unresolved:
 *   active | inactive | unresolved
 *
 * Consumers that already take `boolean | undefined` (action-surface,
 * obligation derive) map through {@link activeVerifierToBooleanOrUndefined}.
 */

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { decodeStakeAccount } from "@/lib/svm/decode-account-state";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import {
  type ActiveAccount,
} from "@/lib/web3/active-account";
import {
  commercialActive,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import type {
  KeyedContract,
  KeyedEntry,
} from "@/lib/web3/keyed-multicall";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export const ACTIVE_VERIFIER_FACT_KEY = "isActiveVerifier" as const;

export type ActiveVerifierFact =
  | { kind: "active" }
  | { kind: "inactive" }
  | { kind: "unresolved" };

/**
 * Map the owner fact onto the legacy `boolean | undefined` contract.
 * `undefined` = unresolved — obligation derive and action-surface depend on it.
 */
export function activeVerifierToBooleanOrUndefined(
  fact: ActiveVerifierFact,
): boolean | undefined {
  if (fact.kind === "active") return true;
  if (fact.kind === "inactive") return false;
  return undefined;
}

export type ActiveVerifierReadPlan =
  | {
      ok: true;
      /** Issued a keyed read for a session-bound address on the target stack. */
      sessionBound: true;
      contracts: readonly KeyedContract<typeof ACTIVE_VERIFIER_FACT_KEY>[];
      vm: "evm" | "svm";
    }
  | {
      ok: true;
      /** No session address on the target stack — fact is inactive (not unread). */
      sessionBound: false;
      contracts: readonly [];
      vm: "evm" | "svm" | null;
    }
  | {
      ok: false;
      cause: "pda_failed";
      detail: string;
    };

/**
 * Build the keyed-read contracts for the admission fact.
 * EVM: staking.isActiveVerifier(sessionAddress).
 * SVM: keyed-read of the stake PDA (address derived; data decoded in resolve).
 */
export async function planActiveVerifierRead(args: {
  account: ActiveAccount;
  chainId: number;
  registry?: CommercialRegistry;
}): Promise<ActiveVerifierReadPlan> {
  const stack = commercialActive(args.chainId, args.registry);
  if (stack == null) {
    return { ok: true, sessionBound: false, contracts: [], vm: null };
  }

  if (stack.vm === "evm") {
    const staking = karProStakingAddress(args.chainId);
    const sessionAddress =
      args.account.status === "connected" && args.account.vm === "evm"
        ? args.account.address
        : undefined;
    if (staking == null || sessionAddress == null) {
      return { ok: true, sessionBound: false, contracts: [], vm: "evm" };
    }
    return {
      ok: true,
      sessionBound: true,
      vm: "evm",
      contracts: [
        {
          key: ACTIVE_VERIFIER_FACT_KEY,
          address: staking,
          abi: KarProStakingAbi,
          functionName: "isActiveVerifier",
          args: [sessionAddress],
          chainId: wagmiChainId(args.chainId),
        },
      ],
    };
  }

  // SVM
  const sessionAddress =
    args.account.status === "connected" && args.account.vm === "svm"
      ? args.account.address
      : undefined;
  if (sessionAddress == null) {
    return { ok: true, sessionBound: false, contracts: [], vm: "svm" };
  }

  const stakePda = await deriveSvmPda({
    recipe: "kar-pro-staking/stake",
    programId: stack.karProStaking,
    seeds: { verifier: sessionAddress },
  });
  if (!stakePda.ok) {
    return {
      ok: false,
      cause: "pda_failed",
      detail: `${stakePda.cause}:${stakePda.detail}`,
    };
  }

  return {
    ok: true,
    sessionBound: true,
    vm: "svm",
    contracts: [
      {
        key: ACTIVE_VERIFIER_FACT_KEY,
        vm: "svm",
        account: stakePda.address,
      },
    ],
  };
}

/**
 * Resolve the tri-state fact from a keyed-read entry.
 *
 * EVM parity with the prior panel collapse:
 *   success + true → active; success otherwise → inactive;
 *   sessionBound + pending → unresolved; !sessionBound → inactive.
 *
 * SVM: decode StakeAccount.active; account_not_found / undecodable → inactive;
 * pending / unresolved_namespace / rpc_unavailable → unresolved.
 */
export function resolveActiveVerifierFact(args: {
  entry: KeyedEntry | undefined;
  sessionBound: boolean;
  /** True while the async plan has not yet produced contracts. */
  planning?: boolean;
  vm: "evm" | "svm" | null;
}): ActiveVerifierFact {
  if (args.planning) {
    return { kind: "unresolved" };
  }
  if (!args.sessionBound) {
    return { kind: "inactive" };
  }

  const entry = args.entry;
  if (entry == null) {
    return { kind: "unresolved" };
  }

  switch (entry.status) {
    case "pending":
      return { kind: "unresolved" };
    case "refused":
      if (entry.cause === "account_not_found") {
        return { kind: "inactive" };
      }
      // unresolved_namespace / rpc_unavailable / malformed / evm_call_failed —
      // do not invent inactive.
      return { kind: "unresolved" };
    case "success":
      break;
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }

  if (args.vm === "evm") {
    return entry.result === true
      ? { kind: "active" }
      : { kind: "inactive" };
  }

  if (args.vm === "svm") {
    if (!(entry.result instanceof Uint8Array)) {
      return { kind: "inactive" };
    }
    const decoded = decodeStakeAccount(entry.result);
    if (!decoded.ok) {
      return { kind: "inactive" };
    }
    return decoded.value.active
      ? { kind: "active" }
      : { kind: "inactive" };
  }

  return { kind: "unresolved" };
}
