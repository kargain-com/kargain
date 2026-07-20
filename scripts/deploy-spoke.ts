import { execFileSync } from "node:child_process";
import hardhat from "hardhat";
import { getAddress, type Hash } from "viem";

import { LZ_ENDPOINT_V2_BY_CHAIN } from "./lib/chainlink-feeds.js";
import { CONTRACT_VERSIONS } from "./lib/contract-versions.js";
import {
  loadSpokeDeployment,
  SPOKE_CHAIN_ID,
  SPOKE_DEPLOYMENT_PATH,
  type SpokeDeploymentManifest,
} from "./lib/load-deployment.js";
import { writeSpokeDeploymentManifest } from "./lib/write-deployment.js";

const ETHERSCAN = "https://sepolia.etherscan.io";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

type ViemSuite = Awaited<ReturnType<typeof hardhat.network.connect>>["viem"];

type DeployResult = {
  address: `0x${string}`;
  txHash: Hash;
  blockNumber: bigint;
};

function gitCommitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
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

  const existing = loadSpokeDeployment();
  if (existing?.karPassportOnft) {
    console.error(
      `KarPassportONFT721 already deployed at ${existing.karPassportOnft} — aborting to avoid overwrite.`,
    );
    process.exit(1);
  }

  const lzEndpoint = LZ_ENDPOINT_V2_BY_CHAIN[11155111];
  const connection = await hardhat.network.connect();
  const { viem } = connection;

  try {
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    if (chainId !== SPOKE_CHAIN_ID) {
      throw new Error(`Expected chain ${SPOKE_CHAIN_ID}, got ${chainId}`);
    }

    const [deployer] = await viem.getWalletClients();
    const deployerAddress = getAddress(deployer.account.address);

    console.log("Kargain KarPassportONFT721 spoke deploy — Ethereum Sepolia");
    console.log(`Deployer:  ${deployerAddress}`);
    console.log(`Chain:     ${chainId}`);
    console.log(`Endpoint:  ${lzEndpoint}`);
    console.log("");

    const spoke = await deployStep(viem, "KarPassportONFT721", "KarPassportONFT721", [
      lzEndpoint,
      deployerAddress,
    ]);

    const manifest: SpokeDeploymentManifest = {
      chainId: SPOKE_CHAIN_ID,
      gitCommit: gitCommitHead(),
      contractVersions: {
        KarPassportONFT721: CONTRACT_VERSIONS.KarPassportONFT721,
      },
      karPassportOnft: spoke.address,
      layerZeroEndpoint: lzEndpoint,
      deployer: deployerAddress,
      blocks: { karPassportOnft: Number(spoke.blockNumber) },
      peers: null,
      pathwayConfigHash: null,
    };

    writeSpokeDeploymentManifest(SPOKE_DEPLOYMENT_PATH, manifest);

    console.log("");
    console.log("Spoke deployment complete:");
    console.log(`  KarPassportONFT721: ${spoke.address}`);
    console.log(`  Manifest:           ${SPOKE_DEPLOYMENT_PATH}`);
    console.log(`  peers / pathwayConfigHash: null (wiring iteration)`);
    console.log("");
    console.log("Next: pnpm verify:spoke:sepolia");
    console.log(`Etherscan: ${ETHERSCAN}/address/${spoke.address}`);
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
