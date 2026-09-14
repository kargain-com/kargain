/**
 * Presentation surface for KarPro verification fee (U6.2-fix).
 * Answers chrome properties — never an `"evm"` / `"svm"` identity for panels.
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
  | { configured: false; chainId: number }
  | {
      configured: true;
      chainId: number;
      /**
       * When true, published fee folds an execution-cost estimate (rates + gas
       * chrome; pass gasWei on write). When false, service margin only.
       */
      includesExecutionCost: boolean;
      currentFee:
        | {
            status: "readable";
            stakingAddress: `0x${string}`;
          }
        | {
            status: "unread";
            message: typeof VERIFICATION_FEE_SVM_CURRENT_UNREAD;
          };
      marginEntry:
        | { input: "display_fx" }
        | { input: "native"; unit: CommercialNativeUnit };
      intro: string;
      totalLabel: string;
    };

/**
 * Resolve fee chrome for a commercial target namespace.
 * VM fork lives here (allowlisted), not in the panel.
 */
export function verificationFeeSurface(
  chainId: number,
  registry?: CommercialRegistry,
): VerificationFeeSurface {
  const stack = commercialActive(chainId, registry);
  if (stack == null) return { configured: false, chainId };

  if (stack.vm === "evm") {
    const stakingAddress = karProStakingAddress(chainId);
    if (stakingAddress == null) return { configured: false, chainId };
    return {
      configured: true,
      chainId,
      includesExecutionCost: true,
      currentFee: { status: "readable", stakingAddress },
      marginEntry: { input: "display_fx" },
      intro:
        "Your service fee is stored on-chain in ETH. Gas for verifyPassport is included in the total when you save. Passport owners pay the published fee — not live gas at payment time.",
      totalLabel: "Total on-chain fee",
    };
  }

  return {
    configured: true,
    chainId,
    includesExecutionCost: false,
    currentFee: {
      status: "unread",
      message: VERIFICATION_FEE_SVM_CURRENT_UNREAD,
    },
    marginEntry: { input: "native", unit: nativeUnitOf(stack) },
    intro:
      "Your service fee is stored on-chain in SOL (service margin only). Execution cost on Solana is not folded into this signal.",
    totalLabel: "On-chain fee (service margin)",
  };
}
