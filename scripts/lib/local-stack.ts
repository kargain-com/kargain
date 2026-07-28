import { encodeFunctionData, getAddress, parseEventLogs, type Hash, type PublicClient } from "viem";

export const ZERO = "0x0000000000000000000000000000000000000000" as const;
export const MIN_STAKE = 50_000_000_000_000_000n; // 0.05 ether
export const DISPUTE_DEPOSIT = 10_000_000_000_000_000n; // 0.01 ether
/** AuctionEscrow minimum duration (matches contract minDuration). */
export const THREE_DAYS = 3n * 24n * 60n * 60n;
/** Local auction platform fee (Sepolia AUCTION_PLATFORM_FEE_BPS). Hardhat suite overrides to 250. */
export const AUCTION_LOCAL_FEE_BPS = 10n;

/** ISO 4217 USD as bytes32 (right-padded ASCII). */
export const CURRENCY_USD = "0x5553440000000000000000000000000000000000000000000000000000000000" as const;

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
  timelock: `0x${string}`;
  genesisAuthority: `0x${string}`;
  platformRecipient: `0x${string}`;
  /** Present after `pnpm deploy:local` with auction deploy (iteration в). */
  auctionEscrow?: `0x${string}`;
  auctionEscrowImpl?: `0x${string}`;
  deployedAt: string;
};

/** Base contracts required to deploy AuctionEscrow on an existing local stack. */
export type AuctionEscrowBase = {
  passport: DeployedContract;
  staking: DeployedContract;
  usdc: DeployedContract;
  timelock: DeployedContract;
  admin: WalletClient;
};

export async function deployTimelock(viem: ViemSuite, admin: `0x${string}`) {
  return viem.deployContract("Timelock48h", [[admin], [admin], admin]);
}

export async function deployMarketplaceViaProxy(
  viem: ViemSuite,
  params: {
    karPassport: `0x${string}`;
    usdc: `0x${string}`;
    nativeFeed: `0x${string}`;
    karProStaking: `0x${string}`;
    platformRecipient: `0x${string}`;
    feeBps: bigint;
    proFeeBps: bigint;
    maxStale: bigint;
    timelock: `0x${string}`;
    genesisAuthority: `0x${string}`;
  },
) {
  const implementation = await viem.deployContract("MarketplaceEscrow", [
    params.karPassport,
    params.nativeFeed,
    params.karProStaking,
    params.platformRecipient,
    params.feeBps,
    params.proFeeBps,
    params.maxStale,
  ]);

  const initData = encodeFunctionData({
    abi: implementation.abi,
    functionName: "initialize",
    args: [params.genesisAuthority],
  });

  const proxy = await viem.deployContract("ERC1967Proxy", [implementation.address, initData]);
  const marketplace = await viem.getContractAt("MarketplaceEscrow", proxy.address);

  await marketplace.write.approvePaymentToken([params.usdc, ZERO], {
    account: (await viem.getWalletClients()).find(
      (w) => getAddress(w.account.address) === getAddress(params.genesisAuthority),
    )!.account,
  });

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
  const passport = await viem.deployContract("KarPassport", [
    base.staking.address,
    base.admin.account.address,
    DISPUTE_DEPOSIT,
    base.admin.account.address,
  ]);
  return { ...base, passport };
}

export async function deployEscrowStack(viem: ViemSuite) {
  const base = await deployPassportStack(viem);
  const usdc = await viem.deployContract("MockUSDC", []);
  const nativeFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
  const timelock = await deployTimelock(viem, base.admin.account.address);
  const feeBps = 250n;
  const proFeeBps = 100n;
  const maxStale = 3600n;
  const { marketplace, implementation, proxy } = await deployMarketplaceViaProxy(viem, {
    karPassport: base.passport.address,
    usdc: usdc.address,
    nativeFeed: nativeFeed.address,
    karProStaking: base.staking.address,
    platformRecipient: base.admin.account.address,
    feeBps,
    proFeeBps,
    maxStale,
    timelock: timelock.address,
    genesisAuthority: base.admin.account.address,
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

/**
 * Additive AuctionEscrow deploy on an existing passport/usdc/staking/timelock stack.
 * Defaults match Sepolia (`feeBps=10`, `initialize(timelock)`). Hardhat unit tests pass
 * `{ feeBps: 250n, upgradeAuthority: admin }` to preserve suite semantics.
 */
export async function deployAuctionEscrow(
  viem: ViemSuite,
  base: AuctionEscrowBase,
  opts: {
    feeBps?: bigint;
    upgradeAuthority?: `0x${string}`;
  } = {},
) {
  const feeBps = opts.feeBps ?? AUCTION_LOCAL_FEE_BPS;
  const upgradeAuthority = opts.upgradeAuthority ?? getAddress(base.timelock.address);
  const impl = await viem.deployContract("AuctionEscrow", [
    base.passport.address,
    base.usdc.address,
    base.staking.address,
    base.admin.account.address,
    feeBps,
  ]);
  const initData = encodeFunctionData({
    abi: impl.abi,
    functionName: "initialize",
    args: [upgradeAuthority],
  });
  const proxy = await viem.deployContract("ERC1967Proxy", [impl.address, initData]);
  const auction = await viem.getContractAt("AuctionEscrow", proxy.address);
  return { impl, proxy, auction, feeBps };
}

/** Hardhat-only time travel (`evm_increaseTime` + `evm_mine`). */
export async function increaseTime(publicClient: PublicClient, seconds: bigint) {
  await publicClient.request({
    method: "evm_increaseTime",
    params: [Number(seconds)],
  });
  await publicClient.request({
    method: "evm_mine",
    params: [],
  });
}

export async function mintPassport(
  passport: DeployedContract,
  account: WalletClient,
  to: `0x${string}`,
  uri: string,
) {
  const tokenId = (await passport.read.nextTokenId()) as bigint;
  await passport.write.mintPassport([to, uri], { account: account.account });
  return tokenId;
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
  stack: Awaited<ReturnType<typeof deployEscrowStack>> & {
    auctionEscrow?: `0x${string}`;
    auctionEscrowImpl?: `0x${string}`;
  },
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
    timelock: getAddress(stack.timelock.address),
    genesisAuthority: getAddress(stack.admin.account.address),
    platformRecipient: getAddress(stack.admin.account.address),
    ...(stack.auctionEscrow ? { auctionEscrow: getAddress(stack.auctionEscrow) } : {}),
    ...(stack.auctionEscrowImpl
      ? { auctionEscrowImpl: getAddress(stack.auctionEscrowImpl) }
      : {}),
    deployedAt: new Date().toISOString(),
  };
}
