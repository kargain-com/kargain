/**
 * Completes v2 deploy steps 8–11 when the core contracts are already deployed.
 * Usage: hardhat run scripts/deploy-v2-finish.ts --network baseSepolia
 */
import hardhat from "hardhat";
import { getAddress } from "viem";

import { LZ_ENDPOINT_V2, getChainFeedConfig } from "./lib/chainlink-feeds.js";
import {
  SEPOLIA_CHAIN_ID,
  SEPOLIA_DEPLOYMENT_PATH,
  SEPOLIA_FALLBACK,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import { CONTRACT_VERSIONS } from "./lib/contract-versions.js";
import { computeIndexFromBlock, writeDeploymentManifest } from "./lib/write-deployment.js";

const PARTIAL = {
  timelock: "0x9319e223ff31c954a940b14f04025b56a53ed384" as const,
  karProStaking: "0xb5d79551bb11f726d2a1a110bac645c4345da568" as const,
  karPassport: "0x2c46b2310e2cb09b0feedd174d9cd3870137f594" as const,
  marketplaceImpl: "0x58d5e740b29ab549fbd4d0a147fcdedc32e0b6a3" as const,
  marketplace: "0x9411af4c4ec26d939fb1ad04362456cb41616c19" as const,
  karProPass: SEPOLIA_FALLBACK.karProPass,
  blocks: {
    timelock: 43399252,
    karProStaking: 43399255,
    karPassport: 43399258,
    marketplaceImpl: 43399261,
    marketplace: 43399264,
  },
  txHashes: {
    timelock: "0xc88ade4c2eaf5bd4f599a5b88a2f21523ffa492657232153a246d3ccac952f75",
    karProStaking: "0xccf21682a49779ec2da890ddc1dd6126c63fa13fec105cce574a837cdc27e806",
    karPassport: "0xd2db0ddab8bf2b29e1b2a89ba256066e7ea7764a995ebee04ebdedb201fe4d56",
    marketplaceImpl: "0x1a7838cd59659c78e1df7c539449f109080c5c56fa58e519e3b9e633b926ff54",
    marketplace: "0x9738d25a14cd7220b7ccd6005e2b6323f34314e146ecc4cdb6d5e7ea085c01c3",
  },
};

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

    const [deployer] = await viem.getWalletClients();
    const deployerAddress = getAddress(deployer.account.address);
    const feedConfig = getChainFeedConfig(chainId);
    const tokenIdOffset = BigInt(chainId) << 128n;

    const timelock = getAddress(PARTIAL.timelock);
    const karProStaking = getAddress(PARTIAL.karProStaking);
    const karPassport = getAddress(PARTIAL.karPassport);
    const marketplaceImpl = getAddress(PARTIAL.marketplaceImpl);
    const proxy = getAddress(PARTIAL.marketplace);
    const karProPassAddress = getAddress(PARTIAL.karProPass);

    const marketplace = await viem.getContractAt("MarketplaceEscrow", proxy);

    const upgradeAuthorityBefore = getAddress(
      (await marketplace.read.upgradeAuthority([])) as `0x${string}`,
    );
    console.log(`Current upgradeAuthority: ${upgradeAuthorityBefore}`);

    const usdcPayment = (await marketplace.read.paymentTokens([feedConfig.usdc])) as readonly [
      `0x${string}`,
      boolean,
    ];
    const usdcEnabled = usdcPayment[1];
    if (!usdcEnabled) {
      console.log("approvePaymentToken(USDC)…");
      await marketplace.write.approvePaymentToken(
        [feedConfig.usdc, getAddress("0x0000000000000000000000000000000000000000")],
        { account: deployer.account },
      );
    } else {
      console.log("USDC payment token already approved");
    }

    if (upgradeAuthorityBefore !== timelock) {
      if (upgradeAuthorityBefore === deployerAddress) {
        console.log("transferUpgradeAuthority(timelock)…");
        await marketplace.write.transferUpgradeAuthority([timelock], {
          account: deployer.account,
        });
      } else {
        console.warn(
          `upgradeAuthority is ${upgradeAuthorityBefore}, not deployer — USDC/timelock steps may need timelock ops`,
        );
      }
    } else {
      console.log("upgradeAuthority already timelock");
    }

    let onftAdapterAddress: `0x${string}`;
    let onftBlock: number;
    let onftTx: string;

    console.log("Deploying ProxyONFT721Adapter…");
    const { contract: onftAdapter, deploymentTransaction } =
      await viem.sendDeploymentTransaction("ProxyONFT721Adapter", [
        karPassport,
        proxy,
        LZ_ENDPOINT_V2,
        deployerAddress,
      ]);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: deploymentTransaction.hash,
      timeout: 180_000,
    });
    onftAdapterAddress = onftAdapter.address;
    onftBlock = Number(receipt.blockNumber);
    onftTx = deploymentTransaction.hash;
    console.log(`ProxyONFT721Adapter: ${onftAdapterAddress} (block ${onftBlock})`);

    const upgradeAuthority = getAddress(
      (await marketplace.read.upgradeAuthority([])) as `0x${string}`,
    );
    if (upgradeAuthority !== timelock) {
      throw new Error(`upgradeAuthority should be timelock, got ${upgradeAuthority}`);
    }

    const manifest: DeploymentManifest = {
      chainId: SEPOLIA_CHAIN_ID,
      generation: "v2",
      karPassport,
      karProPass: karProPassAddress,
      karProStaking,
      marketplace: proxy,
      marketplaceImpl,
      usdc: feedConfig.usdc,
      nativeFeed: feedConfig.nativeUsdFeed,
      timelock,
      proxyOnftAdapter: onftAdapterAddress,
      layerZeroEndpoint: LZ_ENDPOINT_V2,
      platformRecipient: SEPOLIA_FALLBACK.platformRecipient,
      deployer: deployerAddress,
      upgradeAuthority,
      tokenIdOffset: tokenIdOffset.toString(),
      deployedAt: new Date().toISOString(),
      unchanged: ["karProPass"],
      blocks: {
        ...PARTIAL.blocks,
        proxyOnftAdapter: onftBlock,
      },
      indexFromBlock: computeIndexFromBlock({
        ...PARTIAL.blocks,
        proxyOnftAdapter: onftBlock,
      }),
      txHashes: {
        ...PARTIAL.txHashes,
        proxyOnftAdapter: onftTx,
      },
      contractVersions: { ...CONTRACT_VERSIONS },
    };

    writeDeploymentManifest(SEPOLIA_DEPLOYMENT_PATH, manifest);

    console.log("");
    console.log("v2 deploy finish complete:");
    console.log(`  Manifest: ${SEPOLIA_DEPLOYMENT_PATH}`);
    console.log(`  upgradeAuthority: ${upgradeAuthority}`);
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
