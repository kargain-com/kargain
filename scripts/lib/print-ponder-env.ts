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
    console.error(`Missing ${SEPOLIA_DEPLOYMENT_PATH} — run pnpm deploy:v2 first`);
    process.exit(1);
  }

  const timelock = manifest.timelock ?? SEPOLIA_FALLBACK.timelock;
  const adapter = manifest.proxyOnftAdapter ?? SEPOLIA_FALLBACK.proxyOnftAdapter;

  const exports: string[] = [
    `# Generation ${manifest.generation} Base Sepolia (chain ${manifest.chainId}) — from manifest`,
    `# Semver: see manifest.contractVersions or on-chain VERSION()`,
    `export PONDER_KAR_PASSPORT_ADDRESS='${manifest.karPassport}'`,
    `export PONDER_KAR_PRO_PASS_ADDRESS='${manifest.karProPass}'`,
    `export PONDER_KAR_PRO_STAKING_ADDRESS='${manifest.karProStaking}'`,
    `export PONDER_MARKETPLACE_ADDRESS='${manifest.marketplace}'`,
    `export PONDER_MARKETPLACE_IMPL_ADDRESS='${manifest.marketplaceImpl}'`,
    `export PONDER_USDC_ADDRESS='${manifest.usdc ?? SEPOLIA_FALLBACK.usdc}'`,
    `export PONDER_NATIVE_FEED_ADDRESS='${manifest.nativeFeed ?? SEPOLIA_FALLBACK.nativeFeed}'`,
    `export PONDER_START_BLOCK_84532='${manifest.indexFromBlock}'`,
    `# After backfill: keep the same numeric value (do NOT set latest on Ponder 0.16 — changes build_id)`,
    `# VPS RPC: export PONDER_RPC_URL_84532=https://sepolia.base.org (see docs/indexer/OPERATIONS.md)`,
    `# Frontend overrides (optional — committed fallbacks in lib/web3/deployment-addresses.ts):`,
    `export NEXT_PUBLIC_KAR_PASSPORT_ADDRESS='${manifest.karPassport}'`,
    `export NEXT_PUBLIC_MARKETPLACE_ADDRESS='${manifest.marketplace}'`,
    `export NEXT_PUBLIC_KAR_PRO_PASS_ADDRESS='${manifest.karProPass}'`,
    `export NEXT_PUBLIC_KAR_PRO_STAKING_ADDRESS='${manifest.karProStaking}'`,
    ...(timelock ? [`export NEXT_PUBLIC_TIMELOCK_ADDRESS='${timelock}'`] : []),
    ...(adapter ? [`export NEXT_PUBLIC_PROXY_ONFT_ADAPTER_ADDRESS='${adapter}'`] : []),
    `# Governance (contracts/SPEC.md Part I):`,
    `#   deployer=${manifest.deployer ?? SEPOLIA_FALLBACK.deployer}`,
    `#   upgradeAuthority=${manifest.upgradeAuthority ?? SEPOLIA_FALLBACK.upgradeAuthority}`,
    ...(timelock ? [`#   timelock=${timelock} (Timelock48h on generation v2)`] : []),
  ];

  console.log(exports.join("\n"));
}

main();
