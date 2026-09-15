/**
 * React port wiring for {@link executeReportPassportDiscrepancy}.
 * No VM fork — the lib owner decides.
 */

"use client";

import { useActiveAccount } from "@/hooks/use-active-account";
import { executeReportPassportDiscrepancy } from "@/lib/passport/report-passport-discrepancy";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";
import { createSvmSignAndSendPort } from "@/lib/web3/svm-sign-and-send-port";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";

export function useReportPassportDiscrepancy(): {
  reportPassportDiscrepancy: (args: {
    chainId: number;
    tokenId: string;
    description: string;
    evidenceCid: string;
  }) => Promise<string>;
  isPending: boolean;
  reset: () => void;
} {
  const { account, svmWallet } = useActiveAccount();
  const { writeContractAsync, isPending, reset } = useEvmWriteContract();

  return {
    reportPassportDiscrepancy: ({
      chainId,
      tokenId,
      description,
      evidenceCid,
    }) => {
      let svmPort: SvmSignAndSendPort | undefined;
      if (svmWallet != null) {
        const bound = createSvmSignAndSendPort(svmWallet);
        if (bound.ok) svmPort = bound.port;
      }
      return executeReportPassportDiscrepancy({
        account,
        chainId,
        tokenId,
        description,
        evidenceCid,
        writeEvmContract: (call) => writeContractAsync(call),
        svmPort,
      });
    },
    isPending,
    reset,
  };
}
