/**
 * Presentation surface for verification challenge bond disclosure (U6.7.1–U6.7.3).
 * Answers chrome properties — never an `"evm"` / `"svm"` identity for panels.
 *
 * Amount source is always readable when the stack is commercial:
 * - passport contract address (EVM `disputeDeposit` read)
 * - passport config PDA (SVM keyed-read + decodePassportConfig)
 *
 * Undeliverable-bond outcome (U6.7.2): EVM may credit Claims; SVM delivery is
 * direct only (D-01) — panels must not infer from empty claimRecipients.
 */

import { decodePassportConfig } from "@/lib/svm/decode-account-state";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import {
  commercialActive,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import type {
  KeyedContract,
  KeyedEntry,
} from "@/lib/web3/keyed-multicall";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export const CHALLENGE_BOND_EVM_CLAIM_SUCCESS =
  "Challenge withdrawn. Your deposit could not be delivered and is waiting under Claims.";

export const CHALLENGE_BOND_WITHDRAW_RELEASED =
  "Challenge withdrawn. Your deposit was released.";

export const CHALLENGE_BOND_AMOUNT_KEY = "challengeBondAmount" as const;

/**
 * Where chrome obtains the deposit figure. Property surface — not a VM label.
 * `passportAddress` → EVM contract read; `keyedConfig` → SVM config PDA decode.
 */
export type ChallengeBondAmountSource =
  | {
      status: "readable";
      passportAddress: `0x${string}`;
    }
  | {
      status: "readable";
      keyedConfig: true;
    };

/**
 * Whether an undeliverable native push for this bond may land under Claims.
 * Named property — not inferred from empty claimRecipients on Solana.
 */
export type ChallengeBondUndeliverableOutcome =
  | {
      claimPossible: true;
      claimSuccessCopy: typeof CHALLENGE_BOND_EVM_CLAIM_SUCCESS;
    }
  | { claimPossible: false };

export type ChallengeBondDisclosure =
  | { configured: false; chainId: number }
  | {
      configured: true;
      chainId: number;
      amountSource: ChallengeBondAmountSource;
      /**
       * When true, the write must not submit until the deposit amount is known
       * (EVM sends it as msg.value). When false, the program reads the amount
       * on-chain — chrome may show the figure when available but must not block.
       */
      requiresAmountKnownBeforeSubmit: boolean;
      /** Bond disposition copy for this commercial stack — not a VM label. */
      deliverySentence: string;
      /** Release vs Claims success copy after withdraw (open path ignores). */
      undeliverableBondOutcome: ChallengeBondUndeliverableOutcome;
      releasedSuccessCopy: typeof CHALLENGE_BOND_WITHDRAW_RELEASED;
    };

const EVM_DELIVERY =
  "Withdraw before the window ends returns it to you. Uphold returns it to the opener. Reject or expiry sends it to the platform. If a return cannot be delivered, it waits under Claims.";

/** User-language SVM bond fate — no Claims, no mechanism prose. */
const SVM_DELIVERY =
  "Withdraw before the window ends returns your bond to you. Uphold returns it to the opener. Reject or expiry sends it to the platform.";

/**
 * Resolve challenge-bond chrome for a commercial target namespace.
 * VM fork lives here (allowlisted), not in the panel.
 */
export function challengeBondDisclosure(
  chainId: number,
  registry?: CommercialRegistry,
): ChallengeBondDisclosure {
  const stack = commercialActive(chainId, registry);
  if (stack == null) return { configured: false, chainId };

  if (stack.vm === "evm") {
    const passportAddress = karPassportAddress(chainId);
    if (passportAddress == null) return { configured: false, chainId };
    return {
      configured: true,
      chainId,
      amountSource: { status: "readable", passportAddress },
      requiresAmountKnownBeforeSubmit: true,
      deliverySentence: EVM_DELIVERY,
      undeliverableBondOutcome: {
        claimPossible: true,
        claimSuccessCopy: CHALLENGE_BOND_EVM_CLAIM_SUCCESS,
      },
      releasedSuccessCopy: CHALLENGE_BOND_WITHDRAW_RELEASED,
    };
  }

  return {
    configured: true,
    chainId,
    amountSource: { status: "readable", keyedConfig: true },
    requiresAmountKnownBeforeSubmit: false,
    deliverySentence: SVM_DELIVERY,
    undeliverableBondOutcome: { claimPossible: false },
    releasedSuccessCopy: CHALLENGE_BOND_WITHDRAW_RELEASED,
  };
}

export type ChallengeBondAmountReadPlan =
  | {
      ok: true;
      contracts: readonly KeyedContract<typeof CHALLENGE_BOND_AMOUNT_KEY>[];
      arm: "passport_contract" | "passport_config";
    }
  | { ok: false; cause: "not_configured" | "pda_failed"; detail: string };

/**
 * Plan the keyed read for the deposit figure shown in open chrome.
 * Not a write owner — decode + display only.
 */
export async function planChallengeBondAmountRead(args: {
  chainId: number;
  registry?: CommercialRegistry;
}): Promise<ChallengeBondAmountReadPlan> {
  const stack = commercialActive(args.chainId, args.registry);
  if (stack == null) {
    return { ok: false, cause: "not_configured", detail: String(args.chainId) };
  }

  if (stack.vm === "evm") {
    const passport = karPassportAddress(args.chainId);
    if (passport == null) {
      return { ok: false, cause: "not_configured", detail: "no_passport" };
    }
    return {
      ok: true,
      arm: "passport_contract",
      contracts: [
        {
          key: CHALLENGE_BOND_AMOUNT_KEY,
          address: passport,
          abi: KarPassportAbi,
          functionName: "disputeDeposit",
          chainId: wagmiChainId(args.chainId),
        },
      ],
    };
  }

  const configPda = await deriveSvmPda({
    recipe: "kar-passport/config",
    programId: stack.karPassport,
  });
  if (!configPda.ok) {
    return {
      ok: false,
      cause: "pda_failed",
      detail: `${configPda.cause}:${configPda.detail}`,
    };
  }

  return {
    ok: true,
    arm: "passport_config",
    contracts: [
      {
        key: CHALLENGE_BOND_AMOUNT_KEY,
        vm: "svm",
        account: configPda.address,
      },
    ],
  };
}

/**
 * Resolve deposit lamports/wei from a keyed-read entry.
 * Absent / pending / undecodable → undefined (chrome optional; open not blocked on SVM).
 */
export function resolveChallengeBondAmount(args: {
  entry: KeyedEntry | undefined;
  arm: "passport_contract" | "passport_config" | null;
  planning?: boolean;
}): { amount: bigint | undefined; loading: boolean } {
  if (args.planning || args.arm == null) {
    return { amount: undefined, loading: true };
  }
  const entry = args.entry;
  if (entry == null) {
    return { amount: undefined, loading: true };
  }
  if (entry.status === "failure") {
    if (entry.error.message.includes("svm_keyed_read_pending")) {
      return { amount: undefined, loading: true };
    }
    return { amount: undefined, loading: false };
  }

  if (args.arm === "passport_contract") {
    if (entry.result == null) {
      return { amount: undefined, loading: false };
    }
    return { amount: BigInt(entry.result as bigint | number | string), loading: false };
  }

  if (!(entry.result instanceof Uint8Array)) {
    return { amount: undefined, loading: false };
  }
  const decoded = decodePassportConfig(entry.result);
  if (!decoded.ok) {
    return { amount: undefined, loading: false };
  }
  return { amount: decoded.value.disputeDeposit, loading: false };
}
