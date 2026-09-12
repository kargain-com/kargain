/**
 * React port wiring for {@link executeSetPassportUri}.
 * No VM fork — the lib owner decides. Exposes busy/reset from the EVM write
 * adapter for panel chrome that still uses an EVM session this unit.
 * Wallet Standard → sign-and-send port is bound here (not in the lib owner).
 */

"use client";

import { useActiveAccount } from "@/hooks/use-active-account";
import { executeSetPassportUri } from "@/lib/passport/set-passport-uri";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";
import { createSvmSignAndSendPort } from "@/lib/web3/svm-sign-and-send-port";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";

export function useSetPassportUri(): {
  setPassportUri: (args: {
    chainId: number;
    tokenId: string;
    uri: string;
  }) => Promise<string>;
  isPending: boolean;
  reset: () => void;
} {
  const { account, svmWallet } = useActiveAccount();
  const { writeContractAsync, isPending, reset } = useEvmWriteContract();

  return {
    setPassportUri: ({ chainId, tokenId, uri }) => {
      let svmPort: SvmSignAndSendPort | undefined;
      if (svmWallet != null) {
        const bound = createSvmSignAndSendPort(svmWallet);
        if (bound.ok) svmPort = bound.port;
      }
      return executeSetPassportUri({
        account,
        chainId,
        tokenId,
        uri,
        writeEvmContract: (call) => writeContractAsync(call),
        svmPort,
      });
    },
    isPending,
    reset,
  };
}
