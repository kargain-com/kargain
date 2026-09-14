/**
 * React port wiring for {@link executeSetVerificationFee}.
 * No VM fork — the lib owner decides.
 */

"use client";

import { useActiveAccount } from "@/hooks/use-active-account";
import { executeSetVerificationFee } from "@/lib/verifier/set-verification-fee";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";
import { createSvmSignAndSendPort } from "@/lib/web3/svm-sign-and-send-port";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";

export function useSetVerificationFee(): {
  setVerificationFee: (args: {
    chainId: number;
    marginNative: bigint;
    gasWei?: bigint | null;
  }) => Promise<string>;
  isPending: boolean;
  reset: () => void;
} {
  const { account, svmWallet } = useActiveAccount();
  const { writeContractAsync, isPending, reset } = useEvmWriteContract();

  return {
    setVerificationFee: ({ chainId, marginNative, gasWei }) => {
      let svmPort: SvmSignAndSendPort | undefined;
      if (svmWallet != null) {
        const bound = createSvmSignAndSendPort(svmWallet);
        if (bound.ok) svmPort = bound.port;
      }
      return executeSetVerificationFee({
        account,
        chainId,
        marginNative,
        gasWei,
        writeEvmContract: (call) => writeContractAsync(call),
        svmPort,
      });
    },
    isPending,
    reset,
  };
}
