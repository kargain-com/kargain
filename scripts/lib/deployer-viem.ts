/**
 * Shared deployer viem clients for bridge ops scripts.
 *
 * WalletClient is always bound to a local EIP-155 Account so writes use
 * eth_sendRawTransaction. Never pass a bare Address as `account` to
 * writeContract — that routes to wallet_sendTransaction (unsupported on
 * public HTTP RPCs such as sepolia.base.org).
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";

export function hubRpcUrl(): string {
  return (
    process.env.BASE_SEPOLIA_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_RPC_84532?.trim() ||
    "https://sepolia.base.org"
  );
}

export function spokeRpcUrl(): string {
  return (
    process.env.ETH_SEPOLIA_RPC_URL?.trim() ||
    "https://ethereum-sepolia-rpc.publicnode.com"
  );
}

export function requireDeployerAccount(): Account {
  const pk = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!pk) {
    throw new Error("DEPLOYER_PRIVATE_KEY not set (.env.local)");
  }
  const hex = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
  return privateKeyToAccount(hex);
}

export type DeployerClients = {
  public: PublicClient;
  wallet: WalletClient;
  account: Account;
};

export function createPublicClientForChain(chain: Chain, rpcUrl: string): PublicClient {
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export function createDeployerClients(chain: Chain, rpcUrl: string): DeployerClients {
  const account = requireDeployerAccount();
  return {
    public: createPublicClientForChain(chain, rpcUrl),
    wallet: createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    }),
    account,
  };
}

export function createHubDeployerClients(): DeployerClients {
  return createDeployerClients(baseSepolia, hubRpcUrl());
}

export function createSpokeDeployerClients(): DeployerClients {
  return createDeployerClients(sepolia, spokeRpcUrl());
}

export async function writeContractLocal(
  clients: DeployerClients,
  params: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  },
): Promise<{ hash: Hex; receipt: TransactionReceipt }> {
  const hash = await clients.wallet.writeContract({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args as never,
    value: params.value,
    chain: clients.wallet.chain,
    account: clients.account,
  });
  const receipt = await clients.public.waitForTransactionReceipt({
    hash,
    timeout: 180_000,
  });
  return { hash, receipt };
}
