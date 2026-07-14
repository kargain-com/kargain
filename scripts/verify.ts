import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";

import { isContractVerifiedOnEtherscan } from "./lib/etherscan-api.js";
import {
  requireSepoliaDeployment,
  SEPOLIA_DEPLOYMENT_PATH,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import { runHardhatVerify, type VerifyRunResult } from "./lib/run-hardhat-verify.js";
import {
  VERIFY_TARGETS,
  type VerifyTargetKey,
} from "./lib/verify-constructor-args.js";

loadEnv({ path: ".env.local" });
loadEnv();

const BASESCAN = "https://sepolia.basescan.org";
const PENDING_AUCTION_IMPL_PATH = join(
  process.cwd(),
  "deployments/84532.pending-auction-impl.json",
);

const FULL_VERIFY_ORDER: VerifyTargetKey[] = [
  "timelock",
  "karProStaking",
  "karPassport",
  "marketplaceImpl",
  "marketplaceProxy",
  "proxyOnftAdapter",
  "auctionEscrowImpl",
  "auctionEscrowProxy",
];

const AUCTION_VERIFY_ORDER: VerifyTargetKey[] = ["auctionEscrowImpl", "auctionEscrowProxy"];

type VerifyStatus = VerifyRunResult | "missing" | "failed";

function pendingAuctionImplAddress(): `0x${string}` | null {
  if (!existsSync(PENDING_AUCTION_IMPL_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(PENDING_AUCTION_IMPL_PATH, "utf8")) as {
      auctionEscrowImpl?: string;
    };
    if (!raw.auctionEscrowImpl) return null;
    return getAddress(raw.auctionEscrowImpl);
  } catch {
    return null;
  }
}

async function verifyTarget(
  key: VerifyTargetKey,
  manifest: DeploymentManifest,
  apiKey: string,
  force: boolean,
): Promise<VerifyStatus> {
  const target = VERIFY_TARGETS[key];
  let addressSource = "manifest";
  let rawAddress = manifest[target.addressKey];

  if (key === "auctionEscrowImpl") {
    const pendingAddr = pendingAuctionImplAddress();
    if (pendingAddr) {
      rawAddress = pendingAddr;
      addressSource = "pending";
    }
  }

  if (!rawAddress) {
    console.log(`\n${target.label}`);
    console.log("  Skipping — address not in manifest.");
    return "missing";
  }

  const address = getAddress(rawAddress);
  const constructorArgs = target.buildArgs(manifest);

  console.log(`\n${target.label}`);
  console.log(`  Address: ${address}`);
  if (addressSource === "pending") {
    console.log(`  Source:  pending file (${PENDING_AUCTION_IMPL_PATH})`);
  }
  console.log(`  Basescan: ${BASESCAN}/address/${address}`);

  if (!force) {
    const alreadyVerified = await isContractVerifiedOnEtherscan(address, apiKey);
    if (alreadyVerified === true) {
      console.log("  Skipping — source already verified on Basescan.");
      return "skipped";
    }
  }

  console.log("  Submitting Hardhat verify…");
  try {
    const result = runHardhatVerify({
      address,
      contract: target.contract,
      constructorArgs,
    });
    if (result === "bytecode_mismatch") {
      console.log("  Confirm behavior with: pnpm smoke:sepolia");
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
    auctionOnly: argv.includes("--auction-only"),
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

  const { force, strict, auctionOnly } = parseVerifyArgv(process.argv.slice(2));
  let manifest: DeploymentManifest;
  try {
    manifest = requireSepoliaDeployment();
  } catch {
    console.error(`Missing ${SEPOLIA_DEPLOYMENT_PATH} — run pnpm deploy:sepolia first`);
    process.exit(1);
  }

  const order = auctionOnly ? AUCTION_VERIFY_ORDER : FULL_VERIFY_ORDER;

  console.log("Basescan verification for Kargain (Base Sepolia)");
  console.log(`Generation: ${manifest.generation}`);
  console.log(`Chain: ${manifest.chainId}`);
  if (auctionOnly) {
    console.log("Scope:    auction targets only (--auction-only)");
  }
  console.log(`KarPassport:         ${manifest.karPassport}`);
  console.log(`Marketplace proxy:   ${manifest.marketplace}`);
  console.log(`Timelock:            ${manifest.timelock ?? "(missing)"}`);
  if (manifest.auctionEscrow) {
    console.log(`AuctionEscrow proxy: ${manifest.auctionEscrow}`);
  }
  if (force) console.log("Force mode: re-submitting even if explorer shows verified source.");
  if (strict) console.log("Strict mode: exit 1 on bytecode mismatch or unexpected failure.");

  const summary: Record<string, VerifyStatus> = {};
  for (const key of order) {
    summary[key] = await verifyTarget(key, manifest, apiKey, force);
  }

  console.log("\nSummary:");
  for (const key of order) {
    console.log(`  ${VERIFY_TARGETS[key].label}: ${summary[key]}`);
  }
  console.log("\nOpen proxy on Basescan to confirm implementation link after impl + proxy verify.");

  const failed = order.filter((key) => summary[key] === "failed");
  const mismatches = order.filter((key) => summary[key] === "bytecode_mismatch");
  const verified = order.filter((key) => summary[key] === "verified");

  if (mismatches.length > 0) {
    console.log(
      `\n${mismatches.length} bytecode mismatch(es) — explorer verify skipped; on-chain deploy is still valid.`,
    );
    console.log("  Gate: pnpm smoke:sepolia");
    if (!strict) {
      console.log("  (Use --strict to fail this run when mismatches occur.)");
    }
  }

  if (verified.length > 0) {
    console.log(`\n${verified.length} contract(s) newly verified on Basescan.`);
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
