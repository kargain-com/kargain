import type { QueryClient } from "@tanstack/react-query";
import type { Config } from "wagmi";
import { readContractQueryOptions } from "wagmi/query";

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export async function invalidatePassportChainReads(
  queryClient: QueryClient,
  config: Config,
  chainId: number,
  tokenId: string,
): Promise<void> {
  const address = karPassportAddress(chainId);
  if (!address) return;

  await queryClient.invalidateQueries(
    readContractQueryOptions(config, {
      address,
      abi: KarPassportAbi,
      functionName: "getPassportStatus",
      args: [BigInt(tokenId)],
      chainId: wagmiChainId(chainId),
    }),
  );
}
