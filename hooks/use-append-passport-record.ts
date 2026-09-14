/**
 * React port wiring for {@link executeAppendPassportRecord}.
 * No VM fork — the lib owner decides.
 */

"use client";

import { useActiveAccount } from "@/hooks/use-active-account";
import { executeAppendPassportRecord } from "@/lib/passport/append-passport-record";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";
import { createSvmSignAndSendPort } from "@/lib/web3/svm-sign-and-send-port";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";

export function useAppendPassportRecord(): {
  appendPassportRecord: (args: {
    chainId: number;
    tokenId: string;
    recordType: string;
    description: string;
    evidenceCid: string;
  }) => Promise<string>;
  isPending: boolean;
  reset: () => void;
} {
  const { account, svmWallet } = useActiveAccount();
  const { writeContractAsync, isPending, reset } = useEvmWriteContract();

  return {
    appendPassportRecord: ({
      chainId,
      tokenId,
      recordType,
      description,
      evidenceCid,
    }) => {
      let svmPort: SvmSignAndSendPort | undefined;
      if (svmWallet != null) {
        const bound = createSvmSignAndSendPort(svmWallet);
        if (bound.ok) svmPort = bound.port;
      }
      return executeAppendPassportRecord({
        account,
        chainId,
        tokenId,
        recordType,
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
