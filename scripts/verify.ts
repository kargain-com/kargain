import { config as loadEnv } from "dotenv";
import { getAddress } from "viem";

import {
  assertDeployEvidence,
  formatDeployEvidenceFailure,
} from "./lib/assert-deploy-evidence.js";
import { isContractVerifiedOnEtherscan } from "./lib/etherscan-api.js";
import { restoreDeploymentCompileEvidence } from "./lib/deployment-build-info.js";
import {
  commercialDeploymentPath,
  requireCommercialDeployment,
  requireSepoliaDeployment,
  SEPOLIA_DEPLOYMENT_PATH,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import { runHardhatVerify, type VerifyRunResult } from "./lib/run-hardhat-verify.js";
import {
  VERIFY_TARGETS,
  type HubVerifyTargetKey,
} from "./lib/verify-constructor-args.js";

loadEnv({ path: ".env.local" });
loadEnv();

/** Commerce cutover Phase 1: legacy escrows retired — FixedPrice/Ascending modes only. */
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

type VerifyStatus = VerifyRunResult | "missing" | "failed";

function explorerForChain(chainId: number): { name: string; url: string } {
  if (chainId === 11155111) {
    return { name: "Etherscan", url: "https://sepolia.etherscan.io" };
  }
  return { name: "Basescan", url: "https://sepolia.basescan.org" };
}

function hardhatNetworkForChain(chainId: number): string {
  return chainId === 11155111 ? "ethereumSepolia" : "baseSepolia";
}

async function verifyTarget(
  key: HubVerifyTargetKey,
  manifest: DeploymentManifest,
  apiKey: string,
  force: boolean,
  network: string,
  explorerUrl: string,
): Promise<VerifyStatus> {
  const target = VERIFY_TARGETS[key];
  const rawAddress = manifest[target.addressKey as keyof DeploymentManifest] as
    | `0x${string}`
    | undefined;

  if (!rawAddress) {
    console.log(`\n${target.label}`);
    console.log("  Skipping — address not in manifest.");
    return "missing";
  }

  const address = getAddress(rawAddress);
  const constructorArgs = target.buildArgs(manifest);

  console.log(`\n${target.label}`);
  console.log(`  Address: ${address}`);
  console.log(`  Explorer: ${explorerUrl}/address/${address}`);

  if (!force) {
    const alreadyVerified = await isContractVerifiedOnEtherscan(
      address,
      apiKey,
      manifest.chainId,
    );
    if (alreadyVerified === true) {
      console.log("  Skipping — source already verified on explorer.");
      return "skipped";
    }
  }

  console.log("  Submitting Hardhat verify…");
  try {
    const libraries =
      key === "ascendingConsignmentImpl" &&
      manifest.ascendingHoldLib &&
      manifest.ascendingOpenLib
        ? {
            AscendingHoldLib: manifest.ascendingHoldLib,
            AscendingOpenLib: manifest.ascendingOpenLib,
          }
        : undefined;
    const result = runHardhatVerify({
      address,
      contract: target.contract,
      constructorArgs,
      network,
      libraries,
    });
    if (result === "bytecode_mismatch") {
      console.log("  Confirm behavior with smoke / on-chain reads.");
      return "bytecode_mismatch";
    }
    console.log(`  Done (${result}).`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  Failed — ${message}`);
    return "failed";
  }
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

  const order = FULL_VERIFY_ORDER;
  const explorer = explorerForChain(manifest.chainId);
  const network = hardhatNetworkForChain(manifest.chainId);

  console.log(`${explorer.name} verification for Kargain`);
  console.log(`Generation: ${manifest.generation}`);
  console.log(`Chain: ${manifest.chainId} (hardhat network ${network})`);
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
  if (strict) console.log("Strict mode: exit 1 on bytecode mismatch or unexpected failure.");

  const evidence = assertDeployEvidence(manifest);
  if (!evidence.ok) {
    console.error(formatDeployEvidenceFailure(evidence));
    process.exit(1);
  }

  try {
    restoreDeploymentCompileEvidence({
      chainId: manifest.chainId,
      buildInfoId: manifest.buildInfoId!,
      buildInfoSha256: manifest.buildInfoSha256!,
    });
    console.log(
      `Restored deploy-time build-info ${manifest.buildInfoId} (sha256 ${manifest.buildInfoSha256!.slice(0, 16)}…)`,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const summary: Record<string, VerifyStatus> = {};
  for (const key of order) {
    summary[key] = await verifyTarget(
      key,
      manifest,
      apiKey,
      force,
      network,
      explorer.url,
    );
  }

  console.log("\nSummary:");
  for (const key of order) {
    console.log(`  ${VERIFY_TARGETS[key].label}: ${summary[key]}`);
  }
  console.log(
    `\nOpen proxy on ${explorer.name} to confirm implementation link after impl + proxy verify.`,
  );

  const failed = order.filter((key) => summary[key] === "failed");
  const mismatches = order.filter((key) => summary[key] === "bytecode_mismatch");
  const verified = order.filter((key) => summary[key] === "verified");

  if (mismatches.length > 0) {
    console.log(
      `\n${mismatches.length} bytecode mismatch(es) — explorer verify skipped; on-chain deploy is still valid.`,
    );
    if (!strict) {
      console.log("  (Use --strict to fail this run when mismatches occur.)");
    }
  }

  if (verified.length > 0) {
    console.log(`\n${verified.length} contract(s) newly verified on ${explorer.name}.`);
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} verification(s) failed unexpectedly — retry with --force.`);
    process.exit(1);
  }

  if (strict && mismatches.length > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
