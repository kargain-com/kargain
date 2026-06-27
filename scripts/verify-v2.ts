import { config as loadEnv } from "dotenv";
import { getAddress } from "viem";

import { isContractVerifiedOnEtherscan } from "./lib/etherscan-api.js";
import {
  requireSepoliaDeployment,
  SEPOLIA_DEPLOYMENT_PATH,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import { runHardhatVerify } from "./lib/run-hardhat-verify.js";
import {
  VERIFY_V2_TARGETS,
  type VerifyV2TargetKey,
} from "./lib/verify-constructor-args.js";

loadEnv({ path: ".env.local" });
loadEnv();

const BASESCAN = "https://sepolia.basescan.org";

async function verifyTarget(
  key: VerifyV2TargetKey,
  manifest: DeploymentManifest,
  apiKey: string,
  force: boolean,
) {
  const target = VERIFY_V2_TARGETS[key];
  const rawAddress = manifest[target.addressKey];
  if (!rawAddress) {
    console.log(`\n${target.label}`);
    console.log("  Skipping — address not in manifest.");
    return "skipped" as const;
  }

  const address = getAddress(rawAddress);
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
  try {
    const result = runHardhatVerify({
      address,
      contract: target.contract,
      constructorArgs,
    });
    console.log(`  Done (${result}).`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  Failed — ${message.split("\n")[0]}`);
    return "failed" as const;
  }
}

async function main() {
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "ETHERSCAN_API_KEY not set.\n" +
        "Add your Etherscan v2 API key to .env.local (or .env) and run:\n" +
        "pnpm verify:v2",
    );
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  let manifest: DeploymentManifest;
  try {
    manifest = requireSepoliaDeployment();
  } catch {
    console.error(`Missing ${SEPOLIA_DEPLOYMENT_PATH} — run pnpm deploy:v2 first`);
    process.exit(1);
  }

  if (manifest.generation !== "v2") {
    console.warn(`Warning: manifest generation is "${manifest.generation}", expected "v2".`);
  }

  console.log("Basescan verification for Kargain generation v2 (Base Sepolia)");
  console.log(`Chain: ${manifest.chainId}`);
  console.log(`KarPassport:         ${manifest.karPassport}`);
  console.log(`Marketplace proxy:   ${manifest.marketplace}`);
  console.log(`Timelock:            ${manifest.timelock ?? "(missing)"}`);
  if (force) console.log("Force mode: re-submitting even if explorer shows verified source.");

  const order: VerifyV2TargetKey[] = [
    "timelock",
    "karProStaking",
    "karPassport",
    "marketplaceImpl",
    "marketplaceProxy",
    "proxyOnftAdapter",
  ];

  const summary: Record<string, string> = {};
  for (const key of order) {
    summary[key] = await verifyTarget(key, manifest, apiKey, force);
  }

  console.log("\nSummary:");
  for (const key of order) {
    console.log(`  ${VERIFY_V2_TARGETS[key].label}: ${summary[key]}`);
  }
  console.log("\nOpen proxy on Basescan to confirm implementation link after impl + proxy verify.");

  const failed = order.filter((key) => summary[key] === "failed");
  if (failed.length > 0) {
    console.error(`\n${failed.length} verification(s) failed — deploy is still valid; retry individually with --force.`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
