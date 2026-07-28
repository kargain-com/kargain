/**
 * Nuclear full-stack deploy for commercial chains 84532 | 11155111.
 * Sequence: Timelock → KarProPass → Staking → Passport → Marketplace →
 * AuctionEscrow → KarPassportBridgeGateway → setBridgeGateway.
 *
 * `--dry-run` / `--compare`: print 84532 vs 11155111 parity table; no txs.
 * Live deploy requires DEPLOYER_PRIVATE_KEY and `--network baseSepolia|ethereumSepolia`.
 */

import { encodeFunctionData, getAddress, type Hash, type PublicClient } from "viem";

import { AuctionEscrowAbi, MarketplaceEscrowAbi } from "../lib/contracts/abis.generated.js";
import {
  isCommercialChainId,
  verifyFeedBytecode,
} from "./lib/chainlink-feeds.js";
import {
  buildNuclearDeployPlan,
  formatNuclearParityTable,
} from "./lib/nuclear-deploy-plan.js";
import {
  commercialDeploymentPath,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import { computeIndexFromBlock, writeDeploymentManifest } from "./lib/write-deployment.js";
import { CONTRACT_VERSIONS } from "./lib/contract-versions.js";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000" as const;

type ViemSuite = {
  sendDeploymentTransaction: (
    contractName: string,
    constructorArgs?: readonly unknown[],
  ) => Promise<{
    contract: { address: `0x${string}` };
    deploymentTransaction: { hash: Hash };
  }>;
  getPublicClient: () => Promise<PublicClient>;
  getWalletClients: () => Promise<
    Array<{ account: { address: `0x${string}` }; [key: string]: unknown }>
  >;
  getContractAt: (
    name: string,
    address: `0x${string}`,
  ) => Promise<{
    address: `0x${string}`;
    write: Record<string, (...args: unknown[]) => Promise<Hash>>;
    read: Record<string, (...args: unknown[]) => Promise<unknown>>;
  }>;
};

type DeployResult = {
  address: `0x${string}`;
  txHash: Hash;
  blockNumber: bigint;
};

function argvHas(...flags: string[]): boolean {
  return process.argv.some((arg) => flags.includes(arg));
}

async function waitForBytecode(viem: ViemSuite, address: `0x${string}`, label: string) {
  const publicClient = await viem.getPublicClient();
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const bytecode = await publicClient.getBytecode({ address });
    if (bytecode && bytecode !== "0x") return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`${label} bytecode not visible on RPC after 120s (${address})`);
}

function isTransientDeployError(message: string): boolean {
  return /TransactionNotFoundError|could not be found|NonceTooLow|nonce.*lower|in-flight transaction limit|replacement transaction underpriced|unexpected status code|rate limit|429|timeout|ECONNRESET|ETIMEDOUT/i.test(
    message,
  );
}

async function deployStep(
  viem: ViemSuite,
  label: string,
  contractName: string,
  constructorArgs: readonly unknown[] = [],
): Promise<DeployResult> {
  const publicClient = await viem.getPublicClient();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const { contract, deploymentTransaction } = await viem.sendDeploymentTransaction(
        contractName,
        constructorArgs,
      );
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: deploymentTransaction.hash,
        timeout: 180_000,
      });
      await waitForBytecode(viem, contract.address, label);
      console.log(`${label} tx: ${deploymentTransaction.hash} (block ${receipt.blockNumber})`);
      // Pace sequential deploys — EIP-7702 / public RPCs cap in-flight txs.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return {
        address: contract.address,
        txHash: deploymentTransaction.hash,
        blockNumber: receipt.blockNumber,
      };
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (isTransientDeployError(message) && attempt < 8) {
        const waitMs = Math.min(60_000, 5_000 * attempt);
        console.warn(
          `${label}: transient RPC/nonce on attempt ${attempt}, retrying in ${waitMs / 1000}s…`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/** Wait for a write tx hash with the same transient-error retries as deployStep. */
async function writeStep(
  viem: ViemSuite,
  label: string,
  send: () => Promise<Hash>,
): Promise<Hash> {
  const publicClient = await viem.getPublicClient();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const hash = await send();
      await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
      console.log(`  ${label} tx: ${hash}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return hash;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (isTransientDeployError(message) && attempt < 8) {
        const waitMs = Math.min(60_000, 5_000 * attempt);
        console.warn(
          `${label}: transient RPC/nonce on attempt ${attempt}, retrying in ${waitMs / 1000}s…`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

async function assertExternalBytecode(
  publicClient: PublicClient,
  label: string,
  address: `0x${string}`,
) {
  const ok = await verifyFeedBytecode(publicClient, address);
  if (!ok) {
    throw new Error(`${label} has no bytecode at ${address}`);
  }
}

function printDryRunCompare() {
  const base = buildNuclearDeployPlan(84532);
  const eth = buildNuclearDeployPlan(11155111);
  console.log("Nuclear deploy dry-run — parameter parity (no txs)\n");
  console.log(formatNuclearParityTable(base, eth));
  console.log("\nSteps (identical both chains):");
  for (const [i, step] of base.steps.entries()) {
    console.log(`  ${i + 1}. ${step}`);
  }
  console.log("\nExternals sourced from CHAINLINK_FEEDS / LZ_ENDPOINT_V2_BY_CHAIN only.");
}

async function runLiveDeploy() {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.error("DEPLOYER_PRIVATE_KEY not set in .env.local");
    process.exit(1);
  }

  const hardhat = (await import("hardhat")).default;
  const connection = await hardhat.network.connect();
  const viem = connection.viem as unknown as ViemSuite;

  try {
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    if (!isCommercialChainId(chainId)) {
      throw new Error(`Expected commercial chain 84532|11155111, got ${chainId}`);
    }

    const plan = buildNuclearDeployPlan(chainId);
    const { params, externals } = plan;

    await assertExternalBytecode(publicClient, "nativeUsdFeed", externals.nativeUsdFeed);
    await assertExternalBytecode(publicClient, "usdc", externals.usdc);
    await assertExternalBytecode(publicClient, "layerZeroEndpoint", externals.layerZeroEndpoint);

    const [deployer] = await viem.getWalletClients();
    const deployerAddress = getAddress(deployer.account.address);
    const manifestPath = commercialDeploymentPath(chainId);

    console.log(`Kargain nuclear deploy — chain ${chainId} (generation v2)`);
    console.log(`Deployer: ${deployerAddress}`);
    console.log(`Registry: ${plan.registry}`);
    console.log(`USDC:     ${externals.usdc}`);
    console.log(`LZ:       ${externals.layerZeroEndpoint}`);
    console.log("");

    const timelock = await deployStep(viem, "Timelock48h", "Timelock48h", [
      [deployerAddress],
      [deployerAddress],
      deployerAddress,
    ]);

    const karProPass = await deployStep(viem, "KarProPass", "KarProPass", [deployerAddress]);

    const staking = await deployStep(viem, "KarProStaking", "KarProStaking", [
      karProPass.address,
      deployerAddress,
    ]);
    const proPass = await viem.getContractAt("KarProPass", karProPass.address);
    await writeStep(viem, "setStaking", () =>
      proPass.write.setStaking([staking.address], { account: deployer.account }),
    );

    const karPassport = await deployStep(viem, "KarPassport", "KarPassport", [
      staking.address,
      deployerAddress,
      params.disputeDeposit,
    ]);

    const marketplaceImpl = await deployStep(viem, "MarketplaceEscrow impl", "MarketplaceEscrow", [
      karPassport.address,
      externals.nativeUsdFeed,
      staking.address,
      params.platformRecipient,
      params.marketplaceFeeBps,
      params.marketplaceProFeeBps,
      params.maxFeedStaleness,
    ]);

    const initData = encodeFunctionData({
      abi: MarketplaceEscrowAbi,
      functionName: "initialize",
      args: [deployerAddress],
    });

    const proxy = await deployStep(viem, "MarketplaceEscrow proxy", "ERC1967Proxy", [
      marketplaceImpl.address,
      initData,
    ]);

    const marketplace = await viem.getContractAt("MarketplaceEscrow", proxy.address);

    // USD-only: skip setCurrencyFeed for non-USD feeds even when live in CHAINLINK_FEEDS.
    await writeStep(viem, `approvePaymentToken(usdc=${externals.usdc})`, () =>
      marketplace.write.approvePaymentToken([externals.usdc, ADDRESS_ZERO], {
        account: deployer.account,
      }),
    );

    await writeStep(viem, "transferUpgradeAuthority → Timelock48h", () =>
      marketplace.write.transferUpgradeAuthority([timelock.address], {
        account: deployer.account,
      }),
    );

    const auctionImpl = await deployStep(viem, "AuctionEscrow impl", "AuctionEscrow", [
      karPassport.address,
      externals.usdc,
      staking.address,
      params.platformRecipient,
      params.auctionPlatformFeeBps,
    ]);

    const auctionInitData = encodeFunctionData({
      abi: AuctionEscrowAbi,
      functionName: "initialize",
      args: [timelock.address],
    });

    const auctionProxy = await deployStep(viem, "AuctionEscrow proxy", "ERC1967Proxy", [
      auctionImpl.address,
      auctionInitData,
    ]);

    const gateway = await deployStep(
      viem,
      "KarPassportBridgeGateway",
      "KarPassportBridgeGateway",
      [
        karPassport.address,
        proxy.address,
        auctionProxy.address,
        externals.layerZeroEndpoint,
        deployerAddress,
      ],
    );

    const passport = await viem.getContractAt("KarPassport", karPassport.address);
    await writeStep(viem, `setBridgeGateway → ${gateway.address}`, () =>
      passport.write.setBridgeGateway([gateway.address], { account: deployer.account }),
    );
    const boundGateway = getAddress(
      (await passport.read.bridgeGateway([])) as `0x${string}`,
    );
    if (boundGateway !== getAddress(gateway.address)) {
      throw new Error(`bridgeGateway mismatch: ${boundGateway} vs ${gateway.address}`);
    }

    const upgradeAuthority = getAddress(
      (await marketplace.read.upgradeAuthority([])) as `0x${string}`,
    );
    if (upgradeAuthority !== getAddress(timelock.address)) {
      throw new Error(`upgradeAuthority should be timelock, got ${upgradeAuthority}`);
    }

    const auction = await viem.getContractAt("AuctionEscrow", auctionProxy.address);
    const auctionUpgradeAuthority = getAddress(
      (await auction.read.upgradeAuthority([])) as `0x${string}`,
    );
    if (auctionUpgradeAuthority !== getAddress(timelock.address)) {
      throw new Error(
        `AuctionEscrow upgradeAuthority should be timelock, got ${auctionUpgradeAuthority}`,
      );
    }

    const blocks = {
      timelock: Number(timelock.blockNumber),
      karProPass: Number(karProPass.blockNumber),
      karProStaking: Number(staking.blockNumber),
      karPassport: Number(karPassport.blockNumber),
      marketplaceImpl: Number(marketplaceImpl.blockNumber),
      marketplace: Number(proxy.blockNumber),
      auctionEscrowImpl: Number(auctionImpl.blockNumber),
      auctionEscrow: Number(auctionProxy.blockNumber),
      bridgeGateway: Number(gateway.blockNumber),
    };

    const manifest: DeploymentManifest = {
      chainId,
      generation: "v2",
      karPassport: karPassport.address,
      karProPass: karProPass.address,
      karProStaking: staking.address,
      marketplace: proxy.address,
      marketplaceImpl: marketplaceImpl.address,
      auctionEscrow: auctionProxy.address,
      auctionEscrowImpl: auctionImpl.address,
      usdc: externals.usdc,
      nativeFeed: externals.nativeUsdFeed,
      timelock: timelock.address,
      bridgeGateway: gateway.address,
      layerZeroEndpoint: externals.layerZeroEndpoint,
      platformRecipient: params.platformRecipient,
      deployer: deployerAddress,
      upgradeAuthority,
      tokenIdOffset: plan.tokenIdOffset.toString(),
      deployedAt: new Date().toISOString(),
      blocks,
      indexFromBlock: computeIndexFromBlock(blocks),
      txHashes: {
        timelock: timelock.txHash,
        karProPass: karProPass.txHash,
        karProStaking: staking.txHash,
        karPassport: karPassport.txHash,
        marketplaceImpl: marketplaceImpl.txHash,
        marketplace: proxy.txHash,
        auctionEscrowImpl: auctionImpl.txHash,
        auctionEscrow: auctionProxy.txHash,
        bridgeGateway: gateway.txHash,
      },
      contractVersions: { ...CONTRACT_VERSIONS },
    };

    writeDeploymentManifest(manifestPath, manifest);

    console.log("");
    console.log("Nuclear deployment complete:");
    console.log(`  Timelock48h:              ${timelock.address}`);
    console.log(`  KarProPass:               ${karProPass.address}`);
    console.log(`  KarProStaking:            ${staking.address}`);
    console.log(`  KarPassport:              ${karPassport.address}`);
    console.log(`  MarketplaceEscrow proxy:  ${proxy.address}`);
    console.log(`  AuctionEscrow proxy:      ${auctionProxy.address}`);
    console.log(`  KarPassportBridgeGateway: ${gateway.address}`);
    console.log(`  bridgeGateway bound:      ${boundGateway}`);
    console.log(`  upgradeAuthority:         ${upgradeAuthority}`);
    console.log(`  tokenIdOffset:            ${plan.tokenIdOffset}`);
    console.log(`  Manifest:                 ${manifestPath}`);
    console.log("");
    console.log(
      "Next: update lib/web3/sepolia-addresses.ts (or ethereum twin) in the same PR, then pnpm ponder:config",
    );
    console.log("Next: pnpm bridge:wire after both commercial stacks are live");
  } finally {
    await connection.close();
  }
}

async function main() {
  if (argvHas("--dry-run", "--compare")) {
    printDryRunCompare();
    return;
  }
  await runLiveDeploy();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
