import hardhat from "hardhat";
import { encodeFunctionData, getAddress, type Hash } from "viem";
import { MarketplaceEscrowAbi } from "../lib/contracts/abis.generated.js";
import {
  currencyCodeBytes32,
  filterLiveFeeds,
  getChainFeedConfig,
  LZ_ENDPOINT_V2,
} from "./lib/chainlink-feeds.js";
import {
  SEPOLIA_CHAIN_ID,
  SEPOLIA_DEPLOYMENT_PATH,
  SEPOLIA_FALLBACK,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import { computeIndexFromBlock, writeDeploymentManifest } from "./lib/write-deployment.js";
import { CONTRACT_VERSIONS } from "./lib/contract-versions.js";

const BASESCAN = "https://sepolia.basescan.org";

const PLATFORM_RECIPIENT = SEPOLIA_FALLBACK.platformRecipient;
const FEE_BPS = 10n;
const PRO_FEE_BPS = 0n;
const MAX_FEED_STALENESS = 3600n;
const DISPUTE_DEPOSIT = 10_000_000_000_000_000n; // 0.01 ether

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
    if (chainId !== SEPOLIA_CHAIN_ID) {
      throw new Error(`Expected chain ${SEPOLIA_CHAIN_ID}, got ${chainId}`);
    }

    const feedConfig = getChainFeedConfig(chainId);
    const liveCurrencies = await filterLiveFeeds(publicClient, feedConfig);

    const [deployer] = await viem.getWalletClients();
    const deployerAddress = getAddress(deployer.account.address);
    const karProPassAddress = getAddress(SEPOLIA_FALLBACK.karProPass);

    console.log("Kargain v2 deploy — Base Sepolia (parallel stack, no v1 migration)");
    console.log(`Deployer: ${deployerAddress}`);
    console.log(`Chain:    ${chainId}`);
    console.log("");

    // 1. Timelock48h
    const timelock = await deployStep(viem, "Timelock48h", "Timelock48h", [
      [deployerAddress],
      [deployerAddress],
      deployerAddress,
    ]);

    // 2–4. KarProStaking v2 + link existing KarProPass
    const proPass = await viem.getContractAt("KarProPass", karProPassAddress);
    const staking = await deployStep(viem, "KarProStaking v2", "KarProStaking", [
      karProPassAddress,
      deployerAddress,
    ]);
    await proPass.write.setStaking([staking.address], { account: deployer.account });

    // 5. KarPassport v2
    const tokenIdOffset = BigInt(chainId) << 128n;
    const karPassport = await deployStep(viem, "KarPassport v2", "KarPassport", [
      staking.address,
      deployerAddress,
      DISPUTE_DEPOSIT,
    ]);

    // 6–7. MarketplaceEscrow impl + new proxy (genesis upgradeAuthority = deployer)
    const marketplaceImpl = await deployStep(viem, "MarketplaceEscrow v2 impl", "MarketplaceEscrow", [
      karPassport.address,
      feedConfig.usdc,
      feedConfig.nativeUsdFeed,
      staking.address,
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

    const proxy = await deployStep(viem, "MarketplaceEscrow v2 proxy", "ERC1967Proxy", [
      marketplaceImpl.address,
      initData,
    ]);

    const marketplace = await viem.getContractAt("MarketplaceEscrow", proxy.address);

    // 8. Genesis currency + USDC payment token (deployer is upgradeAuthority)
    for (const entry of liveCurrencies) {
      if (entry.code === "USD" || entry.code === "NATIVE") continue;
      const code = currencyCodeBytes32(entry.code);
      await marketplace.write.setCurrencyFeed([code, entry.feed], { account: deployer.account });
      console.log(`  Registered ${entry.code} feed: ${entry.feed}`);
    }
    await marketplace.write.approvePaymentToken([feedConfig.usdc, getAddress("0x0000000000000000000000000000000000000000")], {
      account: deployer.account,
    });

    // 9. Transfer upgradeAuthority to Timelock
    await marketplace.write.transferUpgradeAuthority([timelock.address], { account: deployer.account });

    // 10. ProxyONFT721Adapter (LayerZero testnet eids: Base Sepolia 40245 only until peers configured)
    const onftAdapter = await deployStep(viem, "ProxyONFT721Adapter", "ProxyONFT721Adapter", [
      karPassport.address,
      proxy.address,
      LZ_ENDPOINT_V2,
      deployerAddress,
    ]);

    const upgradeAuthority = getAddress(
      (await marketplace.read.upgradeAuthority([])) as `0x${string}`,
    );
    if (upgradeAuthority !== getAddress(timelock.address)) {
      throw new Error(`upgradeAuthority should be timelock, got ${upgradeAuthority}`);
    }

    const blocks = {
      timelock: Number(timelock.blockNumber),
      karProStaking: Number(staking.blockNumber),
      karPassport: Number(karPassport.blockNumber),
      marketplaceImpl: Number(marketplaceImpl.blockNumber),
      marketplace: Number(proxy.blockNumber),
      proxyOnftAdapter: Number(onftAdapter.blockNumber),
    };

    const manifest: DeploymentManifest = {
      chainId: SEPOLIA_CHAIN_ID,
      generation: "v2",
      karPassport: karPassport.address,
      karProPass: karProPassAddress,
      karProStaking: staking.address,
      marketplace: proxy.address,
      marketplaceImpl: marketplaceImpl.address,
      usdc: feedConfig.usdc,
      nativeFeed: feedConfig.nativeUsdFeed,
      timelock: timelock.address,
      proxyOnftAdapter: onftAdapter.address,
      layerZeroEndpoint: LZ_ENDPOINT_V2,
      platformRecipient: PLATFORM_RECIPIENT,
      deployer: deployerAddress,
      upgradeAuthority,
      tokenIdOffset: tokenIdOffset.toString(),
      deployedAt: new Date().toISOString(),
      unchanged: ["karProPass"],
      blocks,
      indexFromBlock: computeIndexFromBlock(blocks),
      txHashes: {
        timelock: timelock.txHash,
        karProStaking: staking.txHash,
        karPassport: karPassport.txHash,
        marketplaceImpl: marketplaceImpl.txHash,
        marketplace: proxy.txHash,
        proxyOnftAdapter: onftAdapter.txHash,
      },
      contractVersions: { ...CONTRACT_VERSIONS },
    };

    writeDeploymentManifest(SEPOLIA_DEPLOYMENT_PATH, manifest);

    console.log("");
    console.log("v2 deployment complete:");
    console.log(`  Timelock48h:             ${timelock.address}`);
    console.log(`  KarProPass:              ${karProPassAddress} (reused)`);
    console.log(`  KarProStaking v2:        ${staking.address}`);
    console.log(`  KarPassport v2:          ${karPassport.address}`);
    console.log(`  MarketplaceEscrow proxy: ${proxy.address}`);
    console.log(`  ProxyONFT721Adapter:     ${onftAdapter.address}`);
    console.log(`  upgradeAuthority:        ${upgradeAuthority}`);
    console.log(`  tokenIdOffset:           ${tokenIdOffset}`);
    console.log(`  Manifest:                ${SEPOLIA_DEPLOYMENT_PATH}`);
    console.log("");
    console.log("Configure LayerZero peers among 40xxx testnet eids before bridging.");
    console.log(`Basescan: ${BASESCAN}/address/${proxy.address}`);
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
