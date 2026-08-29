/**
 * SVM commercial deploy CLI.
 *
 *   pnpm deploy:svm:dry-run
 *   pnpm deploy:svm          # live Devnet rebuild (retain deployer upgrade authority)
 *
 * Live: build → upgradeable deploy → **keep deployer as upgrade authority** → init → evidence.
 * Hand-off to SOLANA_UPGRADE_AUTHORITY only after destination proof (Y5) — never at first deploy.
 * Never logs SOLANA_DEPLOYER_PRIVATE_KEY.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import {
  buildSvmDeployPlan,
  formatSvmDeployPlanTable,
  resolveSolanaUpgradeAuthority,
  type SvmDeployCluster,
} from "./lib/svm-deploy-plan.js";

const require = createRequire(import.meta.url);
try {
  require("dotenv").config({ path: ".env.local" });
} catch {
  /* optional */
}

function parseArgs(argv: string[]): {
  dryRun: boolean;
  live: boolean;
  cluster: SvmDeployCluster;
} {
  let dryRun = false;
  let live = false;
  let cluster: SvmDeployCluster = "solana-devnet";
  for (const a of argv) {
    if (a === "--dry-run" || a === "--compare") dryRun = true;
    if (a === "--live") live = true;
    if (a === "--local") cluster = "local";
    if (a === "--devnet") cluster = "solana-devnet";
  }
  return { dryRun, live, cluster };
}

function main(): void {
  const { dryRun, live, cluster } = parseArgs(process.argv.slice(2));

  if (live) {
    if (cluster !== "solana-devnet") {
      console.error("Live deploy only supports --devnet (Solana Devnet).");
      process.exit(1);
    }
    const r = spawnSync("bash", ["svm/scripts/deploy-devnet.sh"], {
      stdio: "inherit",
      env: process.env,
    });
    process.exit(r.status ?? 1);
  }

  if (!dryRun) {
    console.error(
      "Use --dry-run or --live. Examples: pnpm deploy:svm:dry-run · pnpm deploy:svm",
    );
    process.exit(1);
  }

  let upgradeAuthority: string;
  try {
    upgradeAuthority = resolveSolanaUpgradeAuthority();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const plan = buildSvmDeployPlan({ cluster, upgradeAuthority });
  console.log(formatSvmDeployPlanTable(plan));
  console.log("\nDry-run complete — no txs.");
}

main();
