/**
 * React port wiring for {@link executeWithdrawChallenge}.
 * No VM fork — the lib owner decides.
 */

"use client";

import { useActiveAccount } from "@/hooks/use-active-account";
import { executeWithdrawChallenge } from "@/lib/passport/withdraw-challenge";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";
import { createSvmSignAndSendPort } from "@/lib/web3/svm-sign-and-send-port";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";

export function useWithdrawChallenge(): {
  withdrawChallenge: (args: {
    chainId: number;
    tokenId: string;
  }) => Promise<string>;
  isPending: boolean;
  reset: () => void;
} {
  const { account, svmWallet } = useActiveAccount();
  const { writeContractAsync, isPending, reset } = useEvmWriteContract();

  return {
    withdrawChallenge: ({ chainId, tokenId }) => {
      let svmPort: SvmSignAndSendPort | undefined;
      if (svmWallet != null) {
        const bound = createSvmSignAndSendPort(svmWallet);
        if (bound.ok) svmPort = bound.port;
      }
      return executeWithdrawChallenge({
        account,
        chainId,
        tokenId,
        writeEvmContract: (call) => writeContractAsync(call),
        svmPort,
      });
    },
    isPending,
    reset,
  };
}
