import { config as loadEnv } from "dotenv";
import { getAddress } from "viem";

import {
  LEGACY_SEPOLIA_BLOCKS,
  loadSepoliaDeployment,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_FALLBACK,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import { isContractVerifiedOnEtherscan } from "./lib/etherscan-api.js";
import { runHardhatVerify } from "./lib/run-hardhat-verify.js";
import {
  VERIFY_TARGETS,
  type VerifyTargetKey,
} from "./lib/verify-constructor-args.js";

loadEnv({ path: ".env.local" });
loadEnv();

const BASESCAN = "https://sepolia.basescan.org";

function resolveManifest(): DeploymentManifest {
  const fromFile = loadSepoliaDeployment();
  if (fromFile) return fromFile;

  console.warn(
    "deployments/84532.json not found — using committed SEPOLIA_FALLBACK addresses.",
  );

  return {
    chainId: SEPOLIA_CHAIN_ID,
    generation: "v1.1",
    karPassport: SEPOLIA_FALLBACK.karPassport,
    karProPass: SEPOLIA_FALLBACK.karProPass,
    karProStaking: SEPOLIA_FALLBACK.karProStaking,
    marketplace: SEPOLIA_FALLBACK.marketplace,
    marketplaceImpl: SEPOLIA_FALLBACK.marketplaceImpl,
    usdc: SEPOLIA_FALLBACK.usdc,
    nativeFeed: SEPOLIA_FALLBACK.nativeFeed,
    eurFeed: SEPOLIA_FALLBACK.eurFeed,
    platformRecipient: SEPOLIA_FALLBACK.platformRecipient,
    deployer: SEPOLIA_FALLBACK.deployer,
    deployedAt: "",
    unchanged: ["karProPass", "karProStaking"],
    blocks: { ...LEGACY_SEPOLIA_BLOCKS },
    indexFromBlock: 42_830_248,
  };
}

async function verifyTarget(
  key: VerifyTargetKey,
  manifest: DeploymentManifest,
  apiKey: string,
  force: boolean,
) {
  const target = VERIFY_TARGETS[key];
  const address = getAddress(manifest[target.addressKey]);
  const constructorArgs = target.buildArgs(manifest);

  console.log(`\n${target.label}`);
  console.log(`  Address: ${address}`);
  console.log(`  Basescan: ${BASESCAN}/address/${address}`);

  if (!force) {
    const alreadyVerified = await isContractVerifiedOnEtherscan(address, apiKey);
    if (alreadyVerified === true) {
      console.log("  Skipping — source already verified on Basescan.");
      return "skipped" as const;
    }
  }

  console.log("  Submitting Hardhat verify…");
  const result = runHardhatVerify({
    address,
    contract: target.contract,
    constructorArgs,
  });
  console.log(`  Done (${result}).`);
  return result;
}

async function main() {
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "ETHERSCAN_API_KEY not set.\n" +
        "Add your Etherscan v2 API key to .env.local (or .env) and run:\n" +
        "pnpm verify:v1.1",
    );
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  const manifest = resolveManifest();

  console.log("Basescan verification for KarPassport v1.1 (Base Sepolia)");
  console.log(`Chain: ${manifest.chainId}`);
  console.log(`KarPassport:    ${manifest.karPassport}`);
  console.log(`Marketplace impl: ${manifest.marketplaceImpl}`);
  console.log(`Marketplace proxy: ${manifest.marketplace}`);
  if (force) console.log("Force mode: re-submitting even if explorer shows verified source.");

  const order: VerifyTargetKey[] = [
    "karPassport",
    "marketplaceImpl",
    "marketplaceProxy",
  ];

  const summary: Record<VerifyTargetKey, string> = {
    karPassport: "pending",
    marketplaceImpl: "pending",
    marketplaceProxy: "pending",
  };

  for (const key of order) {
    summary[key] = await verifyTarget(key, manifest, apiKey, force);
  }

  console.log("\nSummary:");
  for (const key of order) {
    console.log(`  ${VERIFY_TARGETS[key].label}: ${summary[key]}`);
  }
  console.log("\nOpen proxy on Basescan to confirm implementation link after both impl + proxy verify.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
