/**
 * React port wiring for {@link executeOpenFixedPriceConsignment}.
 * No VM fork — the lib owner decides. Wallet Standard → sign-and-send port
 * is bound here (not in the lib owner).
 */

"use client";

import { useActiveAccount } from "@/hooks/use-active-account";
import {
  executeOpenFixedPriceConsignment,
} from "@/lib/commerce/open-fixed-price-consignment";
import type { DenominationKind } from "@/lib/commerce/denomination";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";
import { createSvmSignAndSendPort } from "@/lib/web3/svm-sign-and-send-port";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";

export function useOpenFixedPriceConsignment(): {
  openFixedPriceConsignment: (args: {
    chainId: number;
    tokenId: string;
    denominationKind: DenominationKind;
    currencyCode: `0x${string}`;
    settlementAsset: `0x${string}`;
    price: bigint;
  }) => Promise<string>;
  isPending: boolean;
  reset: () => void;
} {
  const { account, svmWallet } = useActiveAccount();
  const { writeContractAsync, isPending, reset } = useEvmWriteContract();

  return {
    openFixedPriceConsignment: ({
      chainId,
      tokenId,
      denominationKind,
      currencyCode,
      settlementAsset,
      price,
    }) => {
      let svmPort: SvmSignAndSendPort | undefined;
      if (svmWallet != null) {
        const bound = createSvmSignAndSendPort(svmWallet);
        if (bound.ok) svmPort = bound.port;
      }
      return executeOpenFixedPriceConsignment({
        account,
        chainId,
        tokenId,
        denominationKind,
        currencyCode,
        settlementAsset,
        price,
        writeEvmContract: (call) => writeContractAsync(call),
        svmPort,
      });
    },
    isPending,
    reset,
  };
}
