import { config as loadEnv } from "dotenv";
import { getAddress } from "viem";

import { isContractVerifiedOnEtherscan } from "./lib/etherscan-api.js";
import {
  requireSpokeDeployment,
  SPOKE_CHAIN_ID,
  SPOKE_DEPLOYMENT_PATH,
} from "./lib/load-deployment.js";
import { runHardhatVerify, type VerifyRunResult } from "./lib/run-hardhat-verify.js";
import { VERIFY_TARGETS } from "./lib/verify-constructor-args.js";

loadEnv({ path: ".env.local" });
loadEnv();

const ETHERSCAN = "https://sepolia.etherscan.io";

type VerifyStatus = VerifyRunResult | "missing" | "failed";

function parseVerifyArgv(argv: string[]) {
  return {
    force: argv.includes("--force"),
    strict: argv.includes("--strict"),
  };
}

async function main() {
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "ETHERSCAN_API_KEY not set.\n" +
        "Add your Etherscan v2 API key to .env.local (or .env) and run:\n" +
        "pnpm verify:spoke:sepolia",
    );
    process.exit(1);
  }

  const { force, strict } = parseVerifyArgv(process.argv.slice(2));
  let manifest;
  try {
    manifest = requireSpokeDeployment();
  } catch {
    console.error(`Missing ${SPOKE_DEPLOYMENT_PATH} — run pnpm deploy:spoke:sepolia first`);
    process.exit(1);
  }

  const target = VERIFY_TARGETS.karPassportOnft;
  const address = getAddress(manifest.karPassportOnft);
  const constructorArgs = target.buildArgs(manifest);

  console.log("Etherscan verification for Kargain spoke (Ethereum Sepolia)");
  console.log(`Chain:              ${manifest.chainId}`);
  console.log(`KarPassportONFT721: ${address}`);
  if (force) console.log("Force mode: re-submitting even if explorer shows verified source.");
  if (strict) console.log("Strict mode: exit 1 on bytecode mismatch or unexpected failure.");

  console.log(`\n${target.label}`);
  console.log(`  Address:   ${address}`);
  console.log(`  Etherscan: ${ETHERSCAN}/address/${address}`);

  let status: VerifyStatus = "missing";

  if (!force) {
    const alreadyVerified = await isContractVerifiedOnEtherscan(
      address,
      apiKey,
      SPOKE_CHAIN_ID,
    );
    if (alreadyVerified === true) {
      console.log("  Skipping — source already verified on Etherscan.");
      status = "skipped";
    }
  }

  if (status !== "skipped") {
    console.log("  Submitting Hardhat verify…");
    try {
      const result = runHardhatVerify({
        address,
        contract: target.contract,
        constructorArgs,
        network: "ethereumSepolia",
      });
      if (result === "bytecode_mismatch") {
        console.log("  Local compile differs from on-chain — explorer verify skipped.");
        status = "bytecode_mismatch";
      } else {
        console.log(`  Done (${result}).`);
        status = result;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  Failed — ${message}`);
      status = "failed";
    }
  }

  console.log("\nSummary:");
  console.log(`  ${target.label}: ${status}`);

  if (status === "failed") {
    console.error("\nVerification failed unexpectedly — retry with --force.");
    process.exit(1);
  }

  if (strict && status === "bytecode_mismatch") {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
