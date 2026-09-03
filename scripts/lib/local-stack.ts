import {
  encodeFunctionData,
  getAddress,
  parseEventLogs,
  type Abi,
  type Account,
  type Hash,
  type PublicClient,
  type WalletClient as ViemWalletClient,
  testActions,
} from "viem";

import {
  DECLARED_DISPUTE_DEPOSIT_WEI,
  DECLARED_MIN_STAKE_NATIVE_WEI,
} from "../../lib/web3/declared-weights.js";

export const ZERO = "0x0000000000000000000000000000000000000000" as const;
export const MIN_STAKE = DECLARED_MIN_STAKE_NATIVE_WEI;
export const DISPUTE_DEPOSIT = DECLARED_DISPUTE_DEPOSIT_WEI;
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

export type AscendingLibraries = {
  AscendingHoldLib: `0x${string}`;
  AscendingOpenLib: `0x${string}`;
};

/**
 * Method-position bivariance so Hardhat's typed write/read overloads remain
 * assignable to this structural minimum under `strictFunctionTypes`.
 */
type BivariantFn<R> = { bivarianceHack(...args: unknown[]): R }["bivarianceHack"];

/**
 * Declared shape of contract `.read` results after {@link asReadTuple} /
 * {@link asReadObject}. Hardhat's generic contract index returns `unknown`, so
 * `DeployedContract.read` is typed `Promise<unknown>` for assignability; helpers
 * narrow at the call site.
 */
export type ContractReadResult = readonly unknown[] | Record<string, unknown>;

/**
 * Hardhat wallet clients always carry an account; this intersection matches that
 * runtime and avoids optional-account noise at test call sites.
 */
export type WalletClient = ViemWalletClient & { account: Account };

export type DeployedContract = {
  address: `0x${string}`;
  abi: Abi;
  write: { readonly [method: string]: BivariantFn<Promise<Hash>> };
  /** `unknown` — Hardhat's ABI-generic read index is `Promise<unknown>`. */
  read: { readonly [method: string]: BivariantFn<Promise<unknown>> };
};

/**
 * Structural minimum that Hardhat toolbox-viem `connection.viem` satisfies.
 * `deployContract` args are mutable `unknown[]` (Hardhat constructorArgs) — not
 * `readonly` — so Hardhat remains assignable under parameter contravariance.
 */
export type ViemSuite = {
  deployContract: (
    name: string,
    args?: unknown[],
    config?: { libraries?: Record<string, `0x${string}`> },
  ) => Promise<DeployedContract>;
  getContractAt: (name: string, address: `0x${string}`) => Promise<DeployedContract>;
  getWalletClients: () => Promise<ViemWalletClient[]>;
  getPublicClient: () => Promise<PublicClient>;
  /** Present on Hardhat viem; optional so structural assignability stays open. */
  getWalletClient?: (address: `0x${string}`) => Promise<ViemWalletClient>;
};

/** Fail-closed: Hardhat local wallets must expose an account. */
export function asWallet(client: ViemWalletClient): WalletClient {
  if (!client.account) {
    throw new Error("wallet client missing account");
  }
  return client as WalletClient;
}

/** Fail-closed: read result must be a tuple/array before destructuring. */
export function asReadTuple(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("contract read: expected tuple/array result");
  }
  return value;
}

/** Fail-closed: read result must be a non-array object (named Solidity struct). */
export function asReadObject(value: unknown): Record<string, unknown> {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    throw new Error("contract read: expected object/struct result");
  }
  return value as Record<string, unknown>;
}

/** Read a payment-token config field whether viem returned a struct or tuple. */
export function paymentTokenField(
  cfg: unknown,
  field: "feed" | "decimals" | "enabled" | "stalenessTolerance",
): unknown {
  const idx = { feed: 0, decimals: 1, enabled: 2, stalenessTolerance: 3 }[field];
  if (Array.isArray(cfg)) return cfg[idx];
  if (cfg && typeof cfg === "object") return (cfg as Record<string, unknown>)[field];
  throw new Error(`contract read: expected payment token config for ${field}`);
}

/** Fail-closed: scalar address/bytes32/string read. */
export function asReadHex(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error("contract read: expected hex string");
  }
  return value as `0x${string}`;
}

/** Fail-closed: scalar string read (URIs, names). */
export function asReadString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("contract read: expected string");
  }
  return value;
}
export async function readPassportStatus(
  passport: DeployedContract,
  tokenId: bigint,
): Promise<readonly [number, `0x${string}`, bigint]> {
  const row = asReadTuple(await passport.read.getPassportStatus([tokenId]));
  const status = row[0];
  const recordedVerifier = row[1];
  const verifiedAt = row[2];
  if (
    typeof status !== "number" ||
    typeof recordedVerifier !== "string" ||
    typeof verifiedAt !== "bigint"
  ) {
    throw new Error("contract read: malformed getPassportStatus tuple");
  }
  return [status, recordedVerifier as `0x${string}`, verifiedAt];
}

/** KarProPass data tuple (tokenId → fields). */
export async function readProPassData(
  proPass: DeployedContract,
  tokenId: bigint,
): Promise<readonly unknown[]> {
  return asReadTuple(await proPass.read.getProPassData([tokenId]));
}

/** Deploy Ascending linked libraries (no ctor deps). Order: Hold → Open. */
export async function deployAscendingLibraries(viem: ViemSuite): Promise<AscendingLibraries> {
  const holdLib = await viem.deployContract("AscendingHoldLib", []);
  const openLib = await viem.deployContract("AscendingOpenLib", []);
  return {
    AscendingHoldLib: holdLib.address,
    AscendingOpenLib: openLib.address,
  };
}

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
  ascendingHoldLib?: `0x${string}`;
  ascendingOpenLib?: `0x${string}`;
  ascendingConsignment?: `0x${string}`;
  ascendingConsignmentImpl?: `0x${string}`;
  /** KarPassportBridgeGateway (local / ponder dual-chain). */
  bridgeGateway?: `0x${string}`;
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
  const wallets = await viem.getWalletClients();
  const [adminRaw, ownerRaw, verifierRaw, strangerRaw] = wallets;
  if (!adminRaw || !ownerRaw || !verifierRaw || !strangerRaw) {
    throw new Error("deployVerifierStack needs ≥4 Hardhat wallet clients");
  }
  const admin = asWallet(adminRaw);
  const owner = asWallet(ownerRaw);
  const verifier = asWallet(verifierRaw);
  const stranger = asWallet(strangerRaw);
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
    /** Per-feed freshness for native USD only (not a global default). */
    nativeUsdStalenessTolerance: number | bigint;
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
      Number(params.nativeUsdStalenessTolerance),
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
    owner: `0x${string}`;
    guardian: `0x${string}`;
    /** Deploy harness artifact instead of production (fee snapshot tests). */
    harness?: boolean;
  },
) {
  const name = params.harness ? "AscendingConsignmentHarness" : "AscendingConsignment";
  const libraries = await deployAscendingLibraries(viem);
  const impl = await viem.deployContract(name, [], { libraries });
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
      params.owner,
      params.guardian,
    ],
  });
  const proxy = await viem.deployContract("ERC1967Proxy", [impl.address, initData]);
  const mode = await viem.getContractAt(name, proxy.address);
  return { impl, proxy, mode, libraries };
}

/** Hardhat-only JSON-RPC (impersonation / setBalance) on a viem public client. */
export async function hardhatRequest(
  client: PublicClient,
  method: string,
  params?: readonly unknown[],
): Promise<unknown> {
  type HardhatRpc = {
    request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  };
  return (client as HardhatRpc).request({ method, params });
}

/** Hardhat-only time travel (`evm_increaseTime` + `evm_mine`). */
export async function increaseTime(publicClient: PublicClient, seconds: bigint) {
  const testClient = publicClient.extend(testActions({ mode: "hardhat" }));
  await testClient.increaseTime({ seconds: Number(seconds) });
  await testClient.mine({ blocks: 1 });
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

export async function receiptLogs(publicClient: PublicClient, hash: Hash, abi: Abi) {
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const logs = parseEventLogs({ abi, logs: receipt.logs });
  // Generic `Abi` makes viem type `args` as tuple|object; our events use named fields.
  return logs as Array<(typeof logs)[number] & { eventName: string; args: Record<string, unknown> }>;
}

export function stackToDeploymentAddresses(
  stack: Awaited<ReturnType<typeof deployCommerceBaseStack>> & {
    fixedPriceConsignment?: `0x${string}`;
    fixedPriceConsignmentImpl?: `0x${string}`;
    ascendingHoldLib?: `0x${string}`;
    ascendingOpenLib?: `0x${string}`;
    ascendingConsignment?: `0x${string}`;
    ascendingConsignmentImpl?: `0x${string}`;
    bridgeGateway?: `0x${string}`;
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
    ...(stack.ascendingHoldLib ? { ascendingHoldLib: getAddress(stack.ascendingHoldLib) } : {}),
    ...(stack.ascendingOpenLib ? { ascendingOpenLib: getAddress(stack.ascendingOpenLib) } : {}),
    ...(stack.ascendingConsignment
      ? { ascendingConsignment: getAddress(stack.ascendingConsignment) }
      : {}),
    ...(stack.ascendingConsignmentImpl
      ? { ascendingConsignmentImpl: getAddress(stack.ascendingConsignmentImpl) }
      : {}),
    ...(stack.bridgeGateway ? { bridgeGateway: getAddress(stack.bridgeGateway) } : {}),
    ...(stack.commercePayoutSink
      ? { commercePayoutSink: getAddress(stack.commercePayoutSink) }
      : {}),
    deployedAt: new Date().toISOString(),
  };
}
