/**
 * Nuclear-shaped local stack for Hardhat rehearsal (mirrors scripts/deploy.ts order).
 * Modes initialize with owner = deployer; USDC admitted before Timelock handoff.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  encodeFunctionData,
  getAddress,
  getContract,
  type Abi,
  type Hex,
} from "viem";

import {
  ASCENDING_ABANDONMENT_WINDOW,
  ASCENDING_CHALLENGE_BOND,
  ASCENDING_CHALLENGE_WINDOW,
  ASCENDING_EXTENSION_WINDOW,
  ASCENDING_MAX_DURATION,
  ASCENDING_MIN_DURATION,
  ASCENDING_MIN_INCREMENT_BPS,
  ASCENDING_PROTECTION_WINDOW,
  AUCTION_PLATFORM_FEE_BPS,
  MARKETPLACE_FEE_BPS,
  MARKETPLACE_MAX_FEED_STALENESS,
} from "./verify-constructor-args.js";
import {
  deployAscendingConsignment,
  deployCommerceBaseStack,
  deployFixedPriceConsignment,
  type DeployedContract,
  type ViemSuite,
  type WalletClient,
} from "./local-stack.js";
import {
  assertPaymentTokensAdmitted,
  assertSourcesRegistered,
} from "./nuclear-ordering.js";

const require = createRequire(import.meta.url);
const endpointArtifactPath = require
  .resolve("@layerzerolabs/test-devtools-evm-hardhat/package.json")
  .replace(/package.json$/, "artifacts/contracts/mocks/EndpointV2Mock.sol/EndpointV2Mock.json");
const endpointArtifact = JSON.parse(readFileSync(endpointArtifactPath, "utf8")) as {
  abi: Abi;
  bytecode: Hex;
};

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Local EndpointV2Mock eid (arbitrary; rehearsal never sends messages). */
export const REHEARSAL_LZ_EID = 1;

export type NuclearRehearsalStack = {
  /** Deployer / Timelock proposer+executor (passport Ownable before handoff). */
  deployer: WalletClient;
  /** Distinct from Timelock owner — G3 pause + revoke. */
  guardian: WalletClient;
  seller: WalletClient;
  verifier: WalletClient;
  bidder: WalletClient;
  bidder2: WalletClient;
  stranger: WalletClient;
  passport: DeployedContract;
  staking: DeployedContract;
  proPass: DeployedContract;
  usdc: DeployedContract;
  nativeFeed: DeployedContract;
  timelock: DeployedContract;
  fixedPrice: DeployedContract;
  fixedPriceImpl: DeployedContract;
  ascending: DeployedContract;
  ascendingImpl: DeployedContract;
  gateway: DeployedContract;
  lzEndpoint: `0x${string}`;
  platformRecipient: `0x${string}`;
};

function paymentTokenEnabled(cfg: unknown): boolean {
  if (Array.isArray(cfg)) return Boolean(cfg[2]);
  if (cfg && typeof cfg === "object" && "enabled" in cfg) {
    return Boolean((cfg as { enabled: boolean }).enabled);
  }
  return false;
}

async function deployEndpointMock(viem: ViemSuite, deployer: WalletClient) {
  const publicClient = await viem.getPublicClient();
  const hash = await deployer.deployContract({
    abi: endpointArtifact.abi,
    bytecode: endpointArtifact.bytecode,
    args: [REHEARSAL_LZ_EID],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error("EndpointV2Mock deploy missing address");
  }
  return getContract({
    address: receipt.contractAddress,
    abi: endpointArtifact.abi,
    client: { public: publicClient, wallet: deployer },
  });
}

/**
 * Deploy in Nuclear #2 order: mode proxies (owner=deployer) → register → admit USDC →
 * gateway → mode ownership handoff → passport/staking handoff.
 */
export async function deployNuclearRehearsalStack(
  viem: ViemSuite,
): Promise<NuclearRehearsalStack> {
  const wallets = await viem.getWalletClients();
  const [deployer, guardian, seller, verifier, bidder, bidder2, stranger] = wallets;
  if (!deployer || !guardian || !seller || !verifier || !bidder || !bidder2 || !stranger) {
    throw new Error("deployNuclearRehearsalStack needs ≥7 Hardhat wallet clients");
  }

  const base = await deployCommerceBaseStack(viem);
  const { passport, staking, proPass, usdc, nativeFeed, timelock } = base;
  const platformRecipient = getAddress(deployer.account.address);
  const deployerAddress = getAddress(deployer.account.address);

  const fp = await deployFixedPriceConsignment(viem, {
    passport: passport.address,
    platformRecipient,
    feeBps: MARKETPLACE_FEE_BPS,
    nativeUsdFeed: nativeFeed.address,
    maxFeedStaleness: MARKETPLACE_MAX_FEED_STALENESS,
    owner: deployerAddress,
    guardian: getAddress(guardian.account.address),
  });

  const asc = await deployAscendingConsignment(viem, {
    passport: passport.address,
    karProStaking: staking.address,
    platformRecipient,
    feeBps: AUCTION_PLATFORM_FEE_BPS,
    forfeitRecipient: platformRecipient,
    challengeBond: ASCENDING_CHALLENGE_BOND,
    challengeWindow: ASCENDING_CHALLENGE_WINDOW,
    minDuration: ASCENDING_MIN_DURATION,
    maxDuration: ASCENDING_MAX_DURATION,
    extensionWindow: ASCENDING_EXTENSION_WINDOW,
    minIncrementBps: ASCENDING_MIN_INCREMENT_BPS,
    protectionWindow: ASCENDING_PROTECTION_WINDOW,
    abandonmentWindow: ASCENDING_ABANDONMENT_WINDOW,
    owner: deployerAddress,
    guardian: getAddress(guardian.account.address),
  });

  await passport.write.addEncumbranceSource([fp.proxy.address], {
    account: deployer.account,
  });
  await passport.write.addEncumbranceSource([asc.proxy.address], {
    account: deployer.account,
  });
  assertSourcesRegistered({
    fixedPriceRegistered: Boolean(
      await passport.read.isEncumbranceSource([fp.proxy.address]),
    ),
    ascendingRegistered: Boolean(
      await passport.read.isEncumbranceSource([asc.proxy.address]),
    ),
    fixedPrice: fp.proxy.address,
    ascending: asc.proxy.address,
  });

  await fp.mode.write.approvePaymentToken([usdc.address, ZERO], {
    account: deployer.account,
  });
  await asc.mode.write.approvePaymentToken([usdc.address], {
    account: deployer.account,
  });
  assertPaymentTokensAdmitted({
    fixedPriceUsdcEnabled: paymentTokenEnabled(
      await fp.mode.read.paymentTokens([usdc.address]),
    ),
    ascendingUsdcEnabled: Boolean(
      await asc.mode.read.paymentTokenEnabled([usdc.address]),
    ),
    usdc: usdc.address,
  });

  const endpoint = await deployEndpointMock(viem, deployer);
  const gateway = await viem.deployContract("KarPassportBridgeGateway", [
    passport.address,
    endpoint.address,
    deployer.account.address,
  ]);

  await passport.write.setBridgeGateway([gateway.address], { account: deployer.account });

  await fp.mode.write.transferOwnership([timelock.address], {
    account: deployer.account,
  });
  await asc.mode.write.transferOwnership([timelock.address], {
    account: deployer.account,
  });

  await passport.write.transferOwnership([timelock.address], { account: deployer.account });
  await staking.write.transferOwnership([timelock.address], { account: deployer.account });

  return {
    deployer,
    guardian,
    seller,
    verifier,
    bidder,
    bidder2,
    stranger,
    passport,
    staking,
    proPass,
    usdc,
    nativeFeed,
    timelock,
    fixedPrice: fp.mode,
    fixedPriceImpl: fp.impl,
    ascending: asc.mode,
    ascendingImpl: asc.impl,
    gateway,
    lzEndpoint: getAddress(endpoint.address),
    platformRecipient,
  };
}

export function encodeUpgradeToAndCall(impl: `0x${string}`): Hex {
  return encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "upgradeToAndCall",
        inputs: [
          { name: "newImplementation", type: "address" },
          { name: "data", type: "bytes" },
        ],
        outputs: [],
        stateMutability: "payable",
      },
    ],
    functionName: "upgradeToAndCall",
    args: [impl, "0x"],
  });
}
