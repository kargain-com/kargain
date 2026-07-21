import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { COMMERCIAL_ACTIVE } from "@/lib/web3/commercial-active";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { getPublicClient } from "@/lib/web3/public-client";

export type ReadIsActiveVerifier = (
  chainId: number,
  wallet: `0x${string}`,
) => Promise<boolean>;

/**
 * True if the wallet is an active KarPro verifier on any commercial chain
 * (84532 OR 11155111). Fail-closed per chain (missing staking / RPC throw → false).
 */
export async function isActiveVerifierOnCommercialChains(
  wallet: `0x${string}`,
  deps?: { readIsActiveVerifier?: ReadIsActiveVerifier },
): Promise<boolean> {
  const read = deps?.readIsActiveVerifier ?? readIsActiveVerifierOnChain;
  const chainIds = Object.keys(COMMERCIAL_ACTIVE).map(Number);
  const hits = await Promise.all(
    chainIds.map(async (chainId) => {
      try {
        return await read(chainId, wallet);
      } catch {
        return false;
      }
    }),
  );
  return hits.some(Boolean);
}

async function readIsActiveVerifierOnChain(
  chainId: number,
  wallet: `0x${string}`,
): Promise<boolean> {
  const staking = karProStakingAddress(chainId);
  if (!staking) return false;
  try {
    return await getPublicClient(chainId).readContract({
      address: staking,
      abi: KarProStakingAbi,
      functionName: "isActiveVerifier",
      args: [wallet],
    });
  } catch {
    return false;
  }
}
