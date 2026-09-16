/**
 * Presentation surface for verification challenge bond disclosure (U6.7.1–U6.7.2).
 * Answers chrome properties — never an `"evm"` / `"svm"` identity for panels.
 *
 * SVM deposit amount is a named unread until U6.7.3 lands PassportConfig decode.
 * EVM amount is readable from the passport contract address.
 *
 * Undeliverable-bond outcome (U6.7.2): EVM may credit Claims; SVM delivery is
 * direct only (D-01) — panels must not infer from empty claimRecipients.
 */

import {
  commercialActive,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";

/** Named unread — never invent zero / rent / CU as the deposit. */
export const CHALLENGE_BOND_SVM_DEPOSIT_UNREAD =
  "Deposit amount unread on Solana until PassportConfig reads are available.";

export const CHALLENGE_BOND_EVM_CLAIM_SUCCESS =
  "Challenge withdrawn. Your deposit could not be delivered and is waiting under Claims.";

export const CHALLENGE_BOND_WITHDRAW_RELEASED =
  "Challenge withdrawn. Your deposit was released.";

export type ChallengeBondAmountSource =
  | {
      status: "readable";
      passportAddress: `0x${string}`;
    }
  | {
      status: "unread";
      message: typeof CHALLENGE_BOND_SVM_DEPOSIT_UNREAD;
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
       * on-chain — chrome must not block on an unread figure.
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

const SVM_DELIVERY =
  "Withdraw before the window ends returns the bond directly to you. Uphold returns it directly to the opener. Reject or expiry sends it directly to the platform. Undeliverable native push is not a product surface on Solana — the bond moves on-chain only.";

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
    amountSource: {
      status: "unread",
      message: CHALLENGE_BOND_SVM_DEPOSIT_UNREAD,
    },
    requiresAmountKnownBeforeSubmit: false,
    deliverySentence: SVM_DELIVERY,
    undeliverableBondOutcome: { claimPossible: false },
    releasedSuccessCopy: CHALLENGE_BOND_WITHDRAW_RELEASED,
  };
}
