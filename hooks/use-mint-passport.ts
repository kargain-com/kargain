/**
 * React port wiring for {@link executeMintPassport}.
 * No VM fork — the lib owner decides. Wallet Standard → sign-and-send port
 * and product signature-status fetch are bound here.
 */

"use client";

import { useActiveAccount } from "@/hooks/use-active-account";
import { executeMintPassport } from "@/lib/passport/mint-passport";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";
import { createSvmSignAndSendPort } from "@/lib/web3/svm-sign-and-send-port";
import { fetchProductSvmSignatureStatuses } from "@/lib/web3/svm-rpc";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";
import type { ExecuteMintPassportResult } from "@/lib/passport/mint-passport";

export function useMintPassport(): {
  mintPassport: (args: {
    chainId: number;
    uri: string;
  }) => Promise<ExecuteMintPassportResult>;
  isPending: boolean;
  reset: () => void;
} {
  const { account, svmWallet } = useActiveAccount();
  const { writeContractAsync, isPending, reset } = useEvmWriteContract();

  return {
    mintPassport: ({ chainId, uri }) => {
      let svmPort: SvmSignAndSendPort | undefined;
      if (svmWallet != null) {
        const bound = createSvmSignAndSendPort(svmWallet);
        if (bound.ok) svmPort = bound.port;
      }
      return executeMintPassport({
        account,
        chainId,
        uri,
        writeEvmContract: (call) => writeContractAsync(call),
        svmPort,
        getSignatureStatuses: fetchProductSvmSignatureStatuses,
      });
    },
    isPending,
    reset,
  };
}
