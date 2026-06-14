import hardhat from "hardhat";
import { encodeFunctionData, getAddress, type Hash } from "viem";
import { MarketplaceEscrowAbi } from "../lib/contracts/abis.generated.js";
import {
  LEGACY_SEPOLIA_BLOCKS,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_DEPLOYMENT_PATH,
  SEPOLIA_FALLBACK,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import { computeIndexFromBlock, writeDeploymentManifest } from "./lib/write-deployment.js";

const BASESCAN = "https://sepolia.basescan.org";

const PLATFORM_RECIPIENT = SEPOLIA_FALLBACK.platformRecipient;
const USDC = SEPOLIA_FALLBACK.usdc;
const NATIVE_USD_FEED = SEPOLIA_FALLBACK.nativeFeed;
const EUR_USD_FEED = SEPOLIA_FALLBACK.eurFeed;
const FEE_BPS = 10n;
const PRO_FEE_BPS = 0n;
const MAX_FEED_STALENESS = 3600n;

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
  const { contract, deploymentTransaction } = await viem.sendDeploymentTransaction(
    contractName,
    constructorArgs,
  );
  const publicClient = await viem.getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deploymentTransaction.hash,
  });
  await waitForBytecode(viem, contract.address, label);
  console.log(`${label} tx: ${deploymentTransaction.hash} (block ${receipt.blockNumber})`);
  return {
    address: contract.address,
    txHash: deploymentTransaction.hash,
    blockNumber: receipt.blockNumber,
  };
}

async function verifyProPassStakingLink(
  viem: ViemSuite,
  proPassAddress: `0x${string}`,
  expectedStaking: `0x${string}`,
) {
  const publicClient = await viem.getPublicClient();
  const proPass = await viem.getContractAt("KarProPass", proPassAddress);
  const staking = getAddress(
    (await proPass.read.staking([])) as `0x${string}`,
  );
  if (staking !== getAddress(expectedStaking)) {
    throw new Error(
      `KarProPass.staking mismatch: expected ${expectedStaking}, got ${staking}`,
    );
  }
  console.log(`KarProPass.staking verified: ${staking}`);
}

async function main() {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.error(
      "DEPLOYER_PRIVATE_KEY not set in .env.local\n" +
        "Add your private key and run again:\n" +
        "DEPLOYER_PRIVATE_KEY=0x... pnpm deploy:v1.1",
    );
    process.exit(1);
  }

  const karProPassAddress = getAddress(SEPOLIA_FALLBACK.karProPass);
  const karProStakingAddress = getAddress(SEPOLIA_FALLBACK.karProStaking);

  const connection = await hardhat.network.connect();
  const { viem } = connection;

  try {
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    if (chainId !== SEPOLIA_CHAIN_ID) {
      throw new Error(`Expected chain ${SEPOLIA_CHAIN_ID}, got ${chainId}`);
    }

    const [deployer] = await viem.getWalletClients();
    const deployerAddress = getAddress(deployer.account.address);

    console.log("Phase 5 partial v1.1 redeploy (KarPassport + Marketplace only)");
    console.log(`Deployer:       ${deployerAddress}`);
    console.log(`Chain:          ${chainId}`);
    console.log(`KarProPass:     ${karProPassAddress} (unchanged)`);
    console.log(`KarProStaking:  ${karProStakingAddress} (unchanged)`);
    console.log("");

    await verifyProPassStakingLink(viem, karProPassAddress, karProStakingAddress);

    const karPassport = await deployStep(viem, "KarPassport v1.1", "KarPassport", [
      karProStakingAddress,
    ]);

    const marketplaceImpl = await deployStep(viem, "MarketplaceEscrow impl", "MarketplaceEscrow", [
      karPassport.address,
      USDC,
      NATIVE_USD_FEED,
      EUR_USD_FEED,
      karProStakingAddress,
      PLATFORM_RECIPIENT,
      FEE_BPS,
      PRO_FEE_BPS,
      MAX_FEED_STALENESS,
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
    const upgradeAuthority = getAddress(
      (await marketplace.read.upgradeAuthority([])) as `0x${string}`,
    );

    if (upgradeAuthority !== deployerAddress) {
      throw new Error(
        `upgradeAuthority mismatch: expected ${deployerAddress}, got ${upgradeAuthority}`,
      );
    }

    const passportContract = await viem.getContractAt("KarPassport", karPassport.address);
    const nextTokenId = await passportContract.read.nextTokenId([]);
    const bytecode = await publicClient.getBytecode({ address: karPassport.address });
    if (!bytecode || bytecode === "0x") {
      throw new Error("KarPassport bytecode missing after deploy");
    }

    const blocks = {
      karProPass: LEGACY_SEPOLIA_BLOCKS.karProPass,
      karProStaking: LEGACY_SEPOLIA_BLOCKS.karProStaking,
      karPassport: Number(karPassport.blockNumber),
      marketplaceImpl: Number(marketplaceImpl.blockNumber),
      marketplace: Number(proxy.blockNumber),
    };

    const manifest: DeploymentManifest = {
      chainId: SEPOLIA_CHAIN_ID,
      generation: "v1.1",
      karPassport: karPassport.address,
      karProPass: karProPassAddress,
      karProStaking: karProStakingAddress,
      marketplace: proxy.address,
      marketplaceImpl: marketplaceImpl.address,
      usdc: USDC,
      nativeFeed: NATIVE_USD_FEED,
      eurFeed: EUR_USD_FEED,
      platformRecipient: PLATFORM_RECIPIENT,
      deployer: deployerAddress,
      deployedAt: new Date().toISOString(),
      unchanged: ["karProPass", "karProStaking"],
      blocks,
      indexFromBlock: computeIndexFromBlock(blocks),
      txHashes: {
        karPassport: karPassport.txHash,
        marketplaceImpl: marketplaceImpl.txHash,
        marketplace: proxy.txHash,
      },
    };

    writeDeploymentManifest(SEPOLIA_DEPLOYMENT_PATH, manifest);

    console.log("");
    console.log("Deployment complete:");
    console.log(`  KarProPass:              ${karProPassAddress} (unchanged)`);
    console.log(`  KarProStaking:           ${karProStakingAddress} (unchanged)`);
    console.log(`  KarPassport:             ${karPassport.address}`);
    console.log(`  MarketplaceEscrow impl:  ${marketplaceImpl.address}`);
    console.log(`  MarketplaceEscrow proxy: ${proxy.address}`);
    console.log(`  upgradeAuthority:        ${upgradeAuthority}`);
    console.log(`  indexFromBlock:          ${manifest.indexFromBlock}`);
    console.log(`  KarPassport.nextTokenId: ${nextTokenId}`);
    console.log(`  Manifest:                ${SEPOLIA_DEPLOYMENT_PATH}`);
    console.log("");
    console.log("Next: node --import tsx scripts/lib/print-ponder-env.ts");
    console.log("");
    console.log("Basescan:");
    console.log(`  KarPassport:             ${BASESCAN}/address/${karPassport.address}`);
    console.log(`  MarketplaceEscrow impl:  ${BASESCAN}/address/${marketplaceImpl.address}`);
    console.log(`  MarketplaceEscrow proxy: ${BASESCAN}/address/${proxy.address}`);
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
