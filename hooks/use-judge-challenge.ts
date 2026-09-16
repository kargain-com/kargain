/**
 * React port wiring for {@link executeJudgeChallenge}.
 * No VM fork — the lib owner decides.
 */

"use client";

import { useActiveAccount } from "@/hooks/use-active-account";
import {
  executeJudgeChallenge,
  type JudgeChallengeOutcome,
} from "@/lib/passport/judge-challenge";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";
import { createSvmSignAndSendPort } from "@/lib/web3/svm-sign-and-send-port";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";

export function useJudgeChallenge(): {
  judgeChallenge: (args: {
    chainId: number;
    tokenId: string;
    outcome: JudgeChallengeOutcome;
  }) => Promise<string>;
  isPending: boolean;
  reset: () => void;
} {
  const { account, svmWallet } = useActiveAccount();
  const { writeContractAsync, isPending, reset } = useEvmWriteContract();

  return {
    judgeChallenge: ({ chainId, tokenId, outcome }) => {
      let svmPort: SvmSignAndSendPort | undefined;
      if (svmWallet != null) {
        const bound = createSvmSignAndSendPort(svmWallet);
        if (bound.ok) svmPort = bound.port;
      }
      return executeJudgeChallenge({
        account,
        chainId,
        tokenId,
        outcome,
        writeEvmContract: (call) => writeContractAsync(call),
        svmPort,
      });
    },
    isPending,
    reset,
  };
}
