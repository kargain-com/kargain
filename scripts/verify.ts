/**
 * Nuclear explorer verify from retained deploy-time build-info (no Hardhat verify).
 *
 *   pnpm verify:sepolia
 *   pnpm verify:sepolia:eth
 */
import { config as loadEnv } from "dotenv";

import {
  commercialDeploymentPath,
  requireCommercialDeployment,
  requireSepoliaDeployment,
  SEPOLIA_DEPLOYMENT_PATH,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import { VERIFY_TARGETS, type HubVerifyTargetKey } from "./lib/verify-constructor-args.js";
import { verifyManifestFromDeployEvidence } from "./lib/verify-from-deploy-evidence.js";

loadEnv({ path: ".env.local" });
loadEnv();

const FULL_VERIFY_ORDER: HubVerifyTargetKey[] = [
  "timelock",
  "karProStaking",
  "karPassport",
  "bridgeGateway",
  "fixedPriceConsignmentImpl",
  "fixedPriceConsignmentProxy",
  "ascendingHoldLib",
  "ascendingOpenLib",
  "ascendingConsignmentImpl",
  "ascendingConsignmentProxy",
];

function explorerForChain(chainId: number): { name: string; url: string } {
  if (chainId === 11155111) {
    return { name: "Etherscan", url: "https://sepolia.etherscan.io" };
  }
  return { name: "Basescan", url: "https://sepolia.basescan.org" };
}

function parseVerifyArgv(argv: string[]) {
  return {
    force: argv.includes("--force"),
    strict: argv.includes("--strict"),
    eth: argv.includes("--eth") || argv.includes("--chain=11155111"),
  };
}

async function main() {
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "ETHERSCAN_API_KEY not set.\n" +
        "Add your Etherscan v2 API key to .env.local (or .env) and run:\n" +
        "pnpm verify:sepolia",
    );
    process.exit(1);
  }

  const { force, strict, eth } = parseVerifyArgv(process.argv.slice(2));
  let manifest: DeploymentManifest;
  try {
    manifest = eth
      ? requireCommercialDeployment(11155111)
      : requireSepoliaDeployment();
  } catch {
    const path = eth ? commercialDeploymentPath(11155111) : SEPOLIA_DEPLOYMENT_PATH();
    console.error(`Missing ${path} — run nuclear deploy first`);
    process.exit(1);
  }

  const explorer = explorerForChain(manifest.chainId);

  console.log(`${explorer.name} verification for Kargain (from deploy evidence)`);
  console.log(`Generation: ${manifest.generation}`);
  console.log(`Chain: ${manifest.chainId}`);
  console.log(`KarPassport:         ${manifest.karPassport}`);
  console.log(`Timelock:            ${manifest.timelock ?? "(missing)"}`);
  if (manifest.fixedPriceConsignment) {
    console.log(`FixedPriceConsignment proxy: ${manifest.fixedPriceConsignment}`);
  }
  if (manifest.ascendingConsignment) {
    console.log(`AscendingConsignment proxy:  ${manifest.ascendingConsignment}`);
  }
  if (manifest.bridgeGateway) {
    console.log(`Bridge gateway:      ${manifest.bridgeGateway}`);
  }
  if (force) console.log("Force mode: re-submitting even if explorer shows verified source.");
  if (strict) console.log("Strict mode: exit 1 on any failed target.");

  const results = await verifyManifestFromDeployEvidence({
    manifest,
    apiKey,
    force,
    order: FULL_VERIFY_ORDER,
  });

  console.log("\nSummary:");
  for (const r of results) {
    console.log(`  ${r.label}: ${r.status}${r.detail ? ` — ${r.detail.slice(0, 120)}` : ""}`);
    console.log(`    ${explorer.url}/address/${r.address}`);
  }

  const failed = results.filter((r) => r.status === "failed");
  const verified = results.filter((r) => r.status === "verified");
  if (verified.length > 0) {
    console.log(`\n${verified.length} contract(s) newly verified on ${explorer.name}.`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} verification(s) failed:`);
    for (const r of failed) {
      console.error(`  ${VERIFY_TARGETS[r.key].label}: ${r.detail ?? "failed"}`);
    }
    process.exit(1);
  }
  if (strict && failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
