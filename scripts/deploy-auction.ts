import hardhat from "hardhat";
import { encodeFunctionData, getAddress, type Hash } from "viem";

import { isCommercialChainId, wethForChain } from "./lib/chainlink-feeds.js";
import { AUCTION_PLATFORM_FEE_BPS } from "./lib/verify-constructor-args.js";
import { CONTRACT_VERSIONS } from "./lib/contract-versions.js";
import {
  commercialDeploymentPath,
  requireCommercialDeployment,
  SEPOLIA_FALLBACK,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import { writeDeploymentManifest } from "./lib/write-deployment.js";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

type ViemSuite = Awaited<ReturnType<typeof hardhat.network.connect>>["viem"];

type DeployResult = {
  address: `0x${string}`;
  txHash: Hash;
  blockNumber: bigint;
};

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

async function deployStep(
  viem: ViemSuite,
  label: string,
  contractName: string,
  constructorArgs: readonly unknown[] = [],
): Promise<DeployResult> {
  const publicClient = await viem.getPublicClient();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 5; attempt++) {
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
      return {
        address: contract.address,
        txHash: deploymentTransaction.hash,
        blockNumber: receipt.blockNumber,
      };
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (/TransactionNotFoundError|could not be found/i.test(message) && attempt < 5) {
        console.warn(`${label}: RPC lag on attempt ${attempt}, retrying in 5s…`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

async function main() {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.error("DEPLOYER_PRIVATE_KEY not set in .env.local");
    process.exit(1);
  }

  const connection = await hardhat.network.connect();
  const { viem } = connection;

  try {
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    if (!isCommercialChainId(chainId)) {
      throw new Error(`Expected commercial chain 84532|11155111, got ${chainId}`);
    }

    const existing = requireCommercialDeployment(chainId);
    if (existing.auctionEscrow) {
      console.error(
        `AuctionEscrow already deployed at ${existing.auctionEscrow} — aborting to avoid overwrite.`,
      );
      process.exit(1);
    }

    const timelock = getAddress(existing.timelock ?? SEPOLIA_FALLBACK.timelock);
    const usdc = getAddress(existing.usdc ?? SEPOLIA_FALLBACK.usdc);
    const platformRecipient = getAddress(
      existing.platformRecipient ?? SEPOLIA_FALLBACK.platformRecipient,
    );
    const karPassport = getAddress(existing.karPassport);
    const karProStaking = getAddress(existing.karProStaking);
    const weth = wethForChain(chainId);
    const manifestPath = commercialDeploymentPath(chainId);

    const [deployer] = await viem.getWalletClients();
    const deployerAddress = getAddress(deployer.account.address);

    console.log(`Kargain AuctionEscrow deploy — chain ${chainId} (additive)`);
    console.log(`Deployer: ${deployerAddress}`);
    console.log(`Chain:    ${chainId}`);
    console.log(`Timelock: ${timelock}`);
    console.log(`WETH:     ${weth}`);
    console.log("");

    const impl = await deployStep(viem, "AuctionEscrow impl", "AuctionEscrow", [
      karPassport,
      usdc,
      weth,
      karProStaking,
      platformRecipient,
      AUCTION_PLATFORM_FEE_BPS,
    ]);

    const implContract = await viem.getContractAt("AuctionEscrow", impl.address);
    const initData = encodeFunctionData({
      abi: implContract.abi,
      functionName: "initialize",
      args: [timelock],
    });

    const proxy = await deployStep(viem, "AuctionEscrow proxy", "ERC1967Proxy", [
      impl.address,
      initData,
    ]);

    const auction = await viem.getContractAt("AuctionEscrow", proxy.address);
    const upgradeAuthority = getAddress(
      (await auction.read.upgradeAuthority([])) as `0x${string}`,
    );
    if (upgradeAuthority !== timelock) {
      throw new Error(`upgradeAuthority should be timelock, got ${upgradeAuthority}`);
    }

    const merged: DeploymentManifest = {
      ...existing,
      auctionEscrow: proxy.address,
      auctionEscrowImpl: impl.address,
      blocks: {
        ...existing.blocks,
        auctionEscrow: Number(proxy.blockNumber),
        auctionEscrowImpl: Number(impl.blockNumber),
      },
      txHashes: {
        ...existing.txHashes,
        auctionEscrow: proxy.txHash,
        auctionEscrowImpl: impl.txHash,
      },
      contractVersions: {
        ...existing.contractVersions,
        AuctionEscrow: CONTRACT_VERSIONS.AuctionEscrow,
      },
      indexFromBlock: existing.indexFromBlock,
    };

    writeDeploymentManifest(manifestPath, merged);

    console.log("");
    console.log("AuctionEscrow deployment complete:");
    console.log(`  AuctionEscrow impl:  ${impl.address}`);
    console.log(`  AuctionEscrow proxy: ${proxy.address}`);
    console.log(`  upgradeAuthority:    ${upgradeAuthority}`);
    console.log(`  Manifest:            ${manifestPath}`);
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
