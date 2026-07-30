import { encodeFunctionData, getAddress, parseEventLogs, type Hash, type PublicClient } from "viem";

export const ZERO = "0x0000000000000000000000000000000000000000" as const;
export const MIN_STAKE = 50_000_000_000_000_000n; // 0.05 ether
export const DISPUTE_DEPOSIT = 10_000_000_000_000_000n; // 0.01 ether
/** AscendingConsignment minimum auction duration (matches contract minDuration floor). */
export const THREE_DAYS = 3n * 24n * 60n * 60n;

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
  usdc: `0x${string}`;
  nativeFeed: `0x${string}`;
  timelock: `0x${string}`;
  platformRecipient: `0x${string}`;
  /** Commerce modes (local E2E / Nuclear #2 prep). */
  fixedPriceConsignment?: `0x${string}`;
  fixedPriceConsignmentImpl?: `0x${string}`;
  ascendingConsignment?: `0x${string}`;
  ascendingConsignmentImpl?: `0x${string}`;
  /**
   * RevertingRecipient used as FixedPrice/Ascending platformRecipient and
   * Ascending forfeitRecipient — toggle acceptEth in E2E to force ClaimRecorded.
   */
  commercePayoutSink?: `0x${string}`;
  deployedAt: string;
};

export async function deployTimelock(viem: ViemSuite, admin: `0x${string}`) {
  return viem.deployContract("Timelock48h", [[admin], [admin], admin]);
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

/**
 * Base commerce building blocks (passport, USDC, native feed, timelock) — the live
 * local stack and FixedPrice/Ascending consignment modes compose on top of this.
 */
export async function deployCommerceBaseStack(viem: ViemSuite) {
  const base = await deployPassportStack(viem);
  const usdc = await viem.deployContract("MockUSDC", []);
  const nativeFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
  const timelock = await deployTimelock(viem, base.admin.account.address);
  return {
    ...base,
    seller: base.owner,
    buyer: base.verifier,
    usdc,
    nativeFeed,
    timelock,
  };
}

/** FixedPriceConsignment UUPS: empty impl ctor → initialize via ERC1967Proxy. */
export async function deployFixedPriceConsignment(
  viem: ViemSuite,
  params: {
    passport: `0x${string}`;
    platformRecipient: `0x${string}`;
    feeBps: bigint;
    nativeUsdFeed: `0x${string}`;
    maxFeedStaleness: bigint;
    owner: `0x${string}`;
    guardian: `0x${string}`;
    /** Deploy harness artifact instead of production (floor poison tests). */
    harness?: boolean;
  },
) {
  const name = params.harness ? "FixedPriceConsignmentHarness" : "FixedPriceConsignment";
  const impl = await viem.deployContract(name, []);
  const initData = encodeFunctionData({
    abi: impl.abi,
    functionName: "initialize",
    args: [
      params.passport,
      params.platformRecipient,
      params.feeBps,
      params.nativeUsdFeed,
      params.maxFeedStaleness,
      params.owner,
      params.guardian,
    ],
  });
  const proxy = await viem.deployContract("ERC1967Proxy", [impl.address, initData]);
  const mode = await viem.getContractAt(name, proxy.address);
  return { impl, proxy, mode };
}

/** AscendingConsignment UUPS: empty impl ctor → initialize configures BondedChallenge via ERC1967Proxy. */
export async function deployAscendingConsignment(
  viem: ViemSuite,
  params: {
    passport: `0x${string}`;
    karProStaking: `0x${string}`;
    platformRecipient: `0x${string}`;
    feeBps: bigint;
    forfeitRecipient: `0x${string}`;
    challengeBond: bigint;
    challengeWindow: bigint;
    minDuration: bigint;
    maxDuration: bigint;
    extensionWindow: bigint;
    minIncrementBps: bigint;
    protectionWindow: bigint;
    abandonmentWindow: bigint;
    owner: `0x${string}`;
    guardian: `0x${string}`;
    /** Deploy harness artifact instead of production (fee snapshot tests). */
    harness?: boolean;
  },
) {
  const name = params.harness ? "AscendingConsignmentHarness" : "AscendingConsignment";
  const impl = await viem.deployContract(name, []);
  const initData = encodeFunctionData({
    abi: impl.abi,
    functionName: "initialize",
    args: [
      params.passport,
      params.karProStaking,
      params.platformRecipient,
      params.feeBps,
      params.forfeitRecipient,
      params.challengeBond,
      params.challengeWindow,
      params.minDuration,
      params.maxDuration,
      params.extensionWindow,
      params.minIncrementBps,
      params.protectionWindow,
      params.abandonmentWindow,
      params.owner,
      params.guardian,
    ],
  });
  const proxy = await viem.deployContract("ERC1967Proxy", [impl.address, initData]);
  const mode = await viem.getContractAt(name, proxy.address);
  return { impl, proxy, mode };
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
  stack: Awaited<ReturnType<typeof deployCommerceBaseStack>> & {
    fixedPriceConsignment?: `0x${string}`;
    fixedPriceConsignmentImpl?: `0x${string}`;
    ascendingConsignment?: `0x${string}`;
    ascendingConsignmentImpl?: `0x${string}`;
    commercePayoutSink?: `0x${string}`;
  },
  chainId: number,
): LocalStackAddresses {
  return {
    chainId,
    karPassport: getAddress(stack.passport.address),
    karProPass: getAddress(stack.proPass.address),
    karProStaking: getAddress(stack.staking.address),
    usdc: getAddress(stack.usdc.address),
    nativeFeed: getAddress(stack.nativeFeed.address),
    timelock: getAddress(stack.timelock.address),
    platformRecipient: getAddress(stack.admin.account.address),
    ...(stack.fixedPriceConsignment
      ? { fixedPriceConsignment: getAddress(stack.fixedPriceConsignment) }
      : {}),
    ...(stack.fixedPriceConsignmentImpl
      ? { fixedPriceConsignmentImpl: getAddress(stack.fixedPriceConsignmentImpl) }
      : {}),
    ...(stack.ascendingConsignment
      ? { ascendingConsignment: getAddress(stack.ascendingConsignment) }
      : {}),
    ...(stack.ascendingConsignmentImpl
      ? { ascendingConsignmentImpl: getAddress(stack.ascendingConsignmentImpl) }
      : {}),
    ...(stack.commercePayoutSink
      ? { commercePayoutSink: getAddress(stack.commercePayoutSink) }
      : {}),
    deployedAt: new Date().toISOString(),
  };
}
