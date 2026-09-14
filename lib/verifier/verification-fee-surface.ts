/**
 * Presentation surface for KarPro verification fee (U6.2).
 * Panel switches on `kind` — never on `account.vm` / `stack.vm`.
 */

import {
  commercialActive,
  nativeUnitOf,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import type { CommercialNativeUnit } from "@/lib/web3/commercial-native-unit";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { VERIFICATION_FEE_SVM_CURRENT_UNREAD } from "@/lib/verifier/set-verification-fee";

export type VerificationFeeSurface =
  | {
      kind: "evm";
      chainId: number;
      stakingAddress: `0x${string}`;
      intro:
        "Your service fee is stored on-chain in ETH. Gas for verifyPassport is included in the total when you save. Passport owners pay the published fee — not live gas at payment time.";
      totalLabel: "Total on-chain fee";
    }
  | {
      kind: "svm";
      chainId: number;
      unit: CommercialNativeUnit;
      currentFeeAbsence: typeof VERIFICATION_FEE_SVM_CURRENT_UNREAD;
      intro: "Your service fee is stored on-chain in SOL (service margin only). Execution cost on Solana is not folded into this signal.";
      totalLabel: "On-chain fee (service margin)";
    }
  | { kind: "unconfigured"; chainId: number };

/**
 * Resolve fee chrome for a commercial target namespace.
 * VM fork lives here (allowlisted), not in the panel.
 */
export function verificationFeeSurface(
  chainId: number,
  registry?: CommercialRegistry,
): VerificationFeeSurface {
  const stack = commercialActive(chainId, registry);
  if (stack == null) return { kind: "unconfigured", chainId };

  if (stack.vm === "evm") {
    const stakingAddress = karProStakingAddress(chainId);
    if (stakingAddress == null) return { kind: "unconfigured", chainId };
    return {
      kind: "evm",
      chainId,
      stakingAddress,
      intro:
        "Your service fee is stored on-chain in ETH. Gas for verifyPassport is included in the total when you save. Passport owners pay the published fee — not live gas at payment time.",
      totalLabel: "Total on-chain fee",
    };
  }

  return {
    kind: "svm",
    chainId,
    unit: nativeUnitOf(stack),
    currentFeeAbsence: VERIFICATION_FEE_SVM_CURRENT_UNREAD,
    intro:
      "Your service fee is stored on-chain in SOL (service margin only). Execution cost on Solana is not folded into this signal.",
    totalLabel: "On-chain fee (service margin)",
  };
}
