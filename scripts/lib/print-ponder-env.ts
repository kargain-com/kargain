import {
  requireSepoliaDeployment,
  SEPOLIA_DEPLOYMENT_PATH,
  SEPOLIA_FALLBACK,
} from "./load-deployment.js";

function main() {
  let manifest;
  try {
    manifest = requireSepoliaDeployment();
  } catch {
    console.error(`Missing ${SEPOLIA_DEPLOYMENT_PATH} — run pnpm deploy:v1.1 first`);
    process.exit(1);
  }

  const exports: string[] = [
    `# Phase ${manifest.generation} Base Sepolia (chain ${manifest.chainId}) — generated from manifest`,
    `export PONDER_KAR_PASSPORT_ADDRESS='${manifest.karPassport}'`,
    `export PONDER_KAR_PRO_PASS_ADDRESS='${manifest.karProPass}'`,
    `export PONDER_KAR_PRO_STAKING_ADDRESS='${manifest.karProStaking}'`,
    `export PONDER_MARKETPLACE_ADDRESS='${manifest.marketplace}'`,
    `export PONDER_MARKETPLACE_IMPL_ADDRESS='${manifest.marketplaceImpl}'`,
    `export PONDER_USDC_ADDRESS='${manifest.usdc ?? SEPOLIA_FALLBACK.usdc}'`,
    `export PONDER_NATIVE_FEED_ADDRESS='${manifest.nativeFeed ?? SEPOLIA_FALLBACK.nativeFeed}'`,
    `export PONDER_START_BLOCK_84532='${manifest.indexFromBlock}'`,
    `# After backfill completes: export PONDER_START_BLOCK_84532=latest`,
    `# Frontend overrides (optional — update deployment-addresses.ts committed fallbacks too):`,
    `export NEXT_PUBLIC_KAR_PASSPORT_ADDRESS='${manifest.karPassport}'`,
    `export NEXT_PUBLIC_MARKETPLACE_ADDRESS='${manifest.marketplace}'`,
    `export NEXT_PUBLIC_KAR_PRO_PASS_ADDRESS='${manifest.karProPass}'`,
    `export NEXT_PUBLIC_KAR_PRO_STAKING_ADDRESS='${manifest.karProStaking}'`,
  ];

  console.log(exports.join("\n"));
}

main();
