import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { COMMERCIAL_ACTIVE } from "@/lib/web3/commercial-active";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { getPublicClient } from "@/lib/web3/public-client";

export type ReadIsActiveVerifier = (
  chainId: number,
  wallet: `0x${string}`,
) => Promise<boolean>;

/**
 * Per-chain batch of `isActiveVerifier`. Return `null` when the chain read
 * failed entirely (RPC / multicall throw). A resolved array is usable even if
 * every entry is false.
 */
export type ReadChainVerifierActive = (
  chainId: number,
  addresses: readonly `0x${string}`[],
) => Promise<boolean[] | null>;

export type ActiveVerifiersBatchResult =
  | { status: "success"; activeByAddress: Map<string, boolean> }
  | { status: "failure" };

function commercialChainIds(): number[] {
  return Object.keys(COMMERCIAL_ACTIVE).map(Number);
}

async function readChainActiveMulticall(
  chainId: number,
  addresses: readonly `0x${string}`[],
): Promise<boolean[] | null> {
  const staking = karProStakingAddress(chainId);
  if (!staking) {
    return addresses.map(() => false);
  }
  try {
    const client = getPublicClient(chainId);
    const results = await client.multicall({
      allowFailure: true,
      contracts: addresses.map((wallet) => ({
        address: staking,
        abi: KarProStakingAbi,
        functionName: "isActiveVerifier" as const,
        args: [wallet] as const,
      })),
    });
    return results.map((r) => r.status === "success" && r.result === true);
  } catch {
    return null;
  }
}

/**
 * Commercial-union active map for many wallets (OR across COMMERCIAL_ACTIVE).
 * Empty input → success with empty map (no RPC).
 * `status: "failure"` only when every commercial chain read fails entirely.
 */
export async function readActiveVerifiersOnCommercialChains(
  addresses: readonly `0x${string}`[],
  deps?: { readChainActive?: ReadChainVerifierActive },
): Promise<ActiveVerifiersBatchResult> {
  if (addresses.length === 0) {
    return { status: "success", activeByAddress: new Map() };
  }

  const read = deps?.readChainActive ?? readChainActiveMulticall;
  const chainIds = commercialChainIds();
  const perChain = await Promise.all(
    chainIds.map(async (chainId) => {
      try {
        return await read(chainId, addresses);
      } catch {
        return null;
      }
    }),
  );

  const usable = perChain.filter((row): row is boolean[] => row != null);
  if (usable.length === 0) {
    return { status: "failure" };
  }

  const activeByAddress = new Map<string, boolean>();
  for (let i = 0; i < addresses.length; i++) {
    const key = addresses[i]!.toLowerCase();
    let active = false;
    for (const row of usable) {
      if (row[i] === true) {
        active = true;
        break;
      }
    }
    activeByAddress.set(key, active);
  }
  return { status: "success", activeByAddress };
}

/**
 * True if the wallet is an active KarPro verifier on any commercial chain
 * (84532 OR 11155111). Fail-closed per chain (missing staking / RPC throw → false).
 */
export async function isActiveVerifierOnCommercialChains(
  wallet: `0x${string}`,
  deps?: { readIsActiveVerifier?: ReadIsActiveVerifier },
): Promise<boolean> {
  const batch = await readActiveVerifiersOnCommercialChains([wallet], {
    readChainActive: deps?.readIsActiveVerifier
      ? async (chainId, addresses) => {
          const out: boolean[] = [];
          for (const address of addresses) {
            try {
              out.push(await deps.readIsActiveVerifier!(chainId, address));
            } catch {
              out.push(false);
            }
          }
          return out;
        }
      : undefined,
  });
  if (batch.status === "failure") return false;
  return batch.activeByAddress.get(wallet.toLowerCase()) === true;
}
