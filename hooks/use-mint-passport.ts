/**
 * React port wiring for {@link planMintPassport} / {@link sendMintPassport}.
 * No VM fork — the lib owner decides. Confirm is `runTx` (product confirm).
 */

"use client";

import { useActiveAccount } from "@/hooks/use-active-account";
import {
  executeMintPassport,
  planMintPassport,
  sendMintPassport,
  type ExecuteMintPassportResult,
  type PlanMintPassportResult,
  type SendMintPassportResult,
} from "@/lib/passport/mint-passport";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";
import { createSvmSignAndSendPort } from "@/lib/web3/svm-sign-and-send-port";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";

function bindSvmPort(
  svmWallet: ReturnType<typeof useActiveAccount>["svmWallet"],
): SvmSignAndSendPort | undefined {
  if (svmWallet == null) return undefined;
  const bound = createSvmSignAndSendPort(svmWallet);
  return bound.ok ? bound.port : undefined;
}

export function useMintPassport(): {
  planMint: (args: {
    chainId: number;
    uri: string;
  }) => Promise<PlanMintPassportResult>;
  sendMint: (args: {
    chainId: number;
    plan: PlanMintPassportResult & { ok: true };
  }) => Promise<SendMintPassportResult>;
  /** Plan + send convenience (no confirm). */
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
    planMint: ({ chainId, uri }) =>
      planMintPassport({
        account,
        chainId,
        uri,
      }),
    sendMint: ({ chainId, plan }) =>
      sendMintPassport({
        plan,
        account,
        chainId,
        writeEvmContract: (call) => writeContractAsync(call),
        svmPort: bindSvmPort(svmWallet),
      }),
    mintPassport: ({ chainId, uri }) =>
      executeMintPassport({
        account,
        chainId,
        uri,
        writeEvmContract: (call) => writeContractAsync(call),
        svmPort: bindSvmPort(svmWallet),
      }),
    isPending,
    reset,
  };
}
