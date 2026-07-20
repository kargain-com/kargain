/**
 * Additive ProxyONFT721Adapter redeploy on Base Sepolia (84532).
 *
 * Overwrites manifest.proxyOnftAdapter and pushes the prior address into
 * historical.proxyOnftAdapter. Does NOT update sepolia-addresses.ts /
 * CONTRACT_VERSIONS (Bridge 5b).
 *
 * Usage:
 *   pnpm deploy:adapter:sepolia -- --force
 */
import hardhat from "hardhat";
import { getAddress, type Hash } from "viem";

import { LZ_ENDPOINT_V2_BY_CHAIN } from "./lib/chainlink-feeds.js";
import {
  requireSepoliaDeployment,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_DEPLOYMENT_PATH,
  type DeploymentManifest,
  type HistoricalProxyOnftAdapter,
} from "./lib/load-deployment.js";
import { writeDeploymentManifest } from "./lib/write-deployment.js";

const BASESCAN = "https://sepolia.basescan.org";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

type ViemSuite = Awaited<ReturnType<typeof hardhat.network.connect>>["viem"];

type DeployResult = {
  address: `0x${string}`;
  txHash: Hash;
  blockNumber: bigint;
};

function parseForce(argv: string[]): boolean {
  return argv.includes("--force");
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

  if (!parseForce(process.argv.slice(2))) {
    console.error(
      "Refusing to overwrite proxyOnftAdapter without --force.\n" +
        "  pnpm deploy:adapter:sepolia -- --force",
    );
    process.exit(1);
  }

  const existing = requireSepoliaDeployment();
  if (!existing.proxyOnftAdapter) {
    console.error(`proxyOnftAdapter missing in ${SEPOLIA_DEPLOYMENT_PATH}`);
    process.exit(1);
  }
  if (!existing.karPassport || !existing.marketplace) {
    console.error("Manifest missing karPassport or marketplace");
    process.exit(1);
  }

  const lzEndpoint = getAddress(
    existing.layerZeroEndpoint ?? LZ_ENDPOINT_V2_BY_CHAIN[84532],
  );
  const karPassport = getAddress(existing.karPassport);
  const marketplace = getAddress(existing.marketplace);
  const priorAdapter = getAddress(existing.proxyOnftAdapter);

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
    const manifestDeployer = existing.deployer ? getAddress(existing.deployer) : null;
    if (manifestDeployer && manifestDeployer !== deployerAddress) {
      throw new Error(
        `Deployer ${deployerAddress} does not match manifest.deployer ${manifestDeployer}`,
      );
    }

    console.log("Kargain ProxyONFT721Adapter redeploy — Base Sepolia (additive)");
    console.log(`Deployer:      ${deployerAddress}`);
    console.log(`Chain:         ${chainId}`);
    console.log(`Prior adapter: ${priorAdapter}`);
    console.log(`KarPassport:   ${karPassport}`);
    console.log(`Marketplace:   ${marketplace}`);
    console.log(`LZ Endpoint:   ${lzEndpoint}`);
    console.log("");

    const deployed = await deployStep(viem, "ProxyONFT721Adapter", "ProxyONFT721Adapter", [
      karPassport,
      marketplace,
      lzEndpoint,
      deployerAddress,
    ]);

    const adapter = await viem.getContractAt("ProxyONFT721Adapter", deployed.address);
    const onChainVersion = (await adapter.read.VERSION([])) as string;

    const priorEntry: HistoricalProxyOnftAdapter = {
      address: priorAdapter,
      block: existing.blocks.proxyOnftAdapter,
      txHash: existing.txHashes?.proxyOnftAdapter,
      version: existing.contractVersions?.ProxyONFT721Adapter ?? "1.0.0-rc.1",
      replacedAt: new Date().toISOString(),
    };

    const priorHistorical = existing.historical?.proxyOnftAdapter ?? [];

    const merged: DeploymentManifest = {
      ...existing,
      proxyOnftAdapter: deployed.address,
      layerZeroEndpoint: lzEndpoint,
      historical: {
        ...existing.historical,
        proxyOnftAdapter: [...priorHistorical, priorEntry],
      },
      blocks: {
        ...existing.blocks,
        proxyOnftAdapter: Number(deployed.blockNumber),
      },
      txHashes: {
        ...existing.txHashes,
        proxyOnftAdapter: deployed.txHash,
      },
      contractVersions: {
        ...(existing.contractVersions ?? {}),
        ProxyONFT721Adapter: onChainVersion,
      } as DeploymentManifest["contractVersions"],
      indexFromBlock: existing.indexFromBlock,
    };

    writeDeploymentManifest(SEPOLIA_DEPLOYMENT_PATH, merged);

    console.log("");
    console.log("ProxyONFT721Adapter redeploy complete:");
    console.log(`  New adapter:  ${deployed.address}`);
    console.log(`  VERSION:      ${onChainVersion}`);
    console.log(`  Prior kept:   ${priorAdapter} → historical.proxyOnftAdapter`);
    console.log(`  Manifest:     ${SEPOLIA_DEPLOYMENT_PATH}`);
    console.log(`  Basescan:     ${BASESCAN}/address/${deployed.address}`);
    console.log("");
    console.log(
      "Next (user): pnpm verify:sepolia (adapter target) → deploy/verify spoke → pnpm bridge:wire.",
    );
    console.log(
      "Bridge 5b: update SEPOLIA_ACTIVE + CONTRACT_VERSIONS + SPEC I.9.1 (smoke:sepolia VERSION mismatch is expected until then).",
    );
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
