import { encodeFunctionData, getAddress, parseEventLogs, type Hash, type PublicClient } from "viem";

export const ZERO = "0x0000000000000000000000000000000000000000" as const;
export const MIN_STAKE = 50_000_000_000_000_000n; // 0.05 ether

/** $2000 per 1 native token, Chainlink-style 8 decimals. */
export const NATIVE_USD_8D = 2000n * 10n ** 8n;

export const Category = {
  MECHANIC: 0,
  GARAGE: 1,
  INSPECTOR: 2,
  BROKER: 3,
  DEALER: 4,
  OTHER: 5,
} as const;

export type ViemSuite = {
  deployContract: (
    name: string,
    args?: readonly unknown[],
  ) => Promise<{
    address: `0x${string}`;
    abi: readonly unknown[];
    write: Record<string, (...args: unknown[]) => Promise<Hash>>;
    read: Record<string, (...args: unknown[]) => Promise<unknown>>;
  }>;
  getContractAt: (
    name: string,
    address: `0x${string}`,
  ) => Promise<{
    address: `0x${string}`;
    abi: readonly unknown[];
    write: Record<string, (...args: unknown[]) => Promise<Hash>>;
    read: Record<string, (...args: unknown[]) => Promise<unknown>>;
  }>;
  getWalletClients: () => Promise<
    Array<{
      account: { address: `0x${string}` };
    }>
  >;
  getPublicClient: () => Promise<PublicClient>;
};

export type WalletClient = Awaited<ReturnType<ViemSuite["getWalletClients"]>>[number];
export type DeployedContract = Awaited<ReturnType<ViemSuite["deployContract"]>>;

export type LocalStackAddresses = {
  chainId: number;
  karPassport: `0x${string}`;
  karProPass: `0x${string}`;
  karProStaking: `0x${string}`;
  marketplace: `0x${string}`;
  marketplaceImpl: `0x${string}`;
  usdc: `0x${string}`;
  nativeFeed: `0x${string}`;
  eurFeed: `0x${string}`;
  timelock: `0x${string}`;
  platformRecipient: `0x${string}`;
  deployedAt: string;
};

export async function deployTimelock(viem: ViemSuite, admin: `0x${string}`) {
  return viem.deployContract("TimelockController", [
    48n * 3600n,
    [admin],
    [admin],
    admin,
  ]);
}

export async function deployMarketplaceViaProxy(
  viem: ViemSuite,
  params: {
    karPassport: `0x${string}`;
    usdc: `0x${string}`;
    nativeFeed: `0x${string}`;
    eurFeed: `0x${string}`;
    karProStaking: `0x${string}`;
    platformRecipient: `0x${string}`;
    feeBps: bigint;
    proFeeBps: bigint;
    maxStale: bigint;
    timelock: `0x${string}`;
  },
) {
  const implementation = await viem.deployContract("MarketplaceEscrow", [
    params.karPassport,
    params.usdc,
    params.nativeFeed,
    params.eurFeed,
    params.karProStaking,
    params.platformRecipient,
    params.feeBps,
    params.proFeeBps,
    params.maxStale,
  ]);

  const initData = encodeFunctionData({
    abi: implementation.abi,
    functionName: "initialize",
    args: [params.timelock],
  });

  const proxy = await viem.deployContract("ERC1967Proxy", [implementation.address, initData]);
  const marketplace = await viem.getContractAt("MarketplaceEscrow", proxy.address);
  return { implementation, proxy, marketplace };
}

export async function deployVerifierStack(viem: ViemSuite) {
  const [admin, owner, verifier, stranger] = await viem.getWalletClients();
  const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
  const staking = await viem.deployContract("KarProStaking", [
    proPass.address,
    admin.account.address,
  ]);
  await proPass.write.setStaking([staking.address], { account: admin.account });
  return { admin, owner, verifier, stranger, proPass, staking };
}

export async function deployPassportStack(viem: ViemSuite) {
  const base = await deployVerifierStack(viem);
  const passport = await viem.deployContract("KarPassport", [base.staking.address]);
  return { ...base, passport };
}

export async function deployEscrowStack(viem: ViemSuite) {
  const base = await deployPassportStack(viem);
  const usdc = await viem.deployContract("MockUSDC", []);
  const nativeFeed = await viem.deployContract("MockV3Aggregator", [8, NATIVE_USD_8D]);
  const timelock = await deployTimelock(viem, base.admin.account.address);
  const feeBps = 250n;
  const proFeeBps = 100n;
  const maxStale = 3600n;
  const { marketplace, implementation, proxy } = await deployMarketplaceViaProxy(viem, {
    karPassport: base.passport.address,
    usdc: usdc.address,
    nativeFeed: nativeFeed.address,
    eurFeed: ZERO,
    karProStaking: base.staking.address,
    platformRecipient: base.admin.account.address,
    feeBps,
    proFeeBps,
    maxStale,
    timelock: timelock.address,
  });
  return {
    ...base,
    seller: base.owner,
    buyer: base.verifier,
    usdc,
    nativeFeed,
    marketplace,
    implementation,
    proxy,
    timelock,
    feeBps,
    proFeeBps,
  };
}

export async function joinVerifier(
  staking: DeployedContract,
  account: WalletClient,
  opts: {
    category?: number;
    name?: string;
    metadataURI?: string;
    value?: bigint;
  } = {},
) {
  const category = opts.category ?? Category.INSPECTOR;
  const name = opts.name ?? "Test Verifier";
  const metadataURI = opts.metadataURI ?? "ar://profile";
  const value = opts.value ?? MIN_STAKE;
  await staking.write.becomeVerifierNative([category, name, metadataURI], {
    account: account.account,
    value,
  });
}

export async function receiptLogs(
  publicClient: PublicClient,
  hash: Hash,
  abi: readonly unknown[],
) {
  const receipt = await publicClient.getTransactionReceipt({ hash });
  return parseEventLogs({ abi, logs: receipt.logs });
}

export function stackToDeploymentAddresses(
  stack: Awaited<ReturnType<typeof deployEscrowStack>>,
  chainId: number,
): LocalStackAddresses {
  return {
    chainId,
    karPassport: getAddress(stack.passport.address),
    karProPass: getAddress(stack.proPass.address),
    karProStaking: getAddress(stack.staking.address),
    marketplace: getAddress(stack.marketplace.address),
    marketplaceImpl: getAddress(stack.implementation.address),
    usdc: getAddress(stack.usdc.address),
    nativeFeed: getAddress(stack.nativeFeed.address),
    eurFeed: ZERO,
    timelock: getAddress(stack.timelock.address),
    platformRecipient: getAddress(stack.admin.account.address),
    deployedAt: new Date().toISOString(),
  };
}
