/**
 * SVM commercial deploy CLI — dry-run only in S4a (no Devnet writes).
 *
 *   pnpm deploy:svm:dry-run
 *   SVM_UPGRADE_AUTHORITY=<base58> pnpm deploy:svm:dry-run
 *
 * Live deploy lands in S4b (deploy → set-upgrade-authority Squads → pathway wire).
 */

import {
  buildSvmDeployPlan,
  formatSvmDeployPlanTable,
  resolveSvmUpgradeAuthority,
  type SvmDeployCluster,
} from "./lib/svm-deploy-plan.js";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  cluster: SvmDeployCluster;
} {
  let dryRun = false;
  let cluster: SvmDeployCluster = "solana-devnet";
  for (const a of argv) {
    if (a === "--dry-run" || a === "--compare") dryRun = true;
    if (a === "--local") cluster = "local";
    if (a === "--devnet") cluster = "solana-devnet";
  }
  return { dryRun, cluster };
}

function main(): void {
  const { dryRun, cluster } = parseArgs(process.argv.slice(2));
  if (!dryRun) {
    console.error(
      "S4a: only --dry-run is supported (no Devnet writes). Use: pnpm deploy:svm:dry-run",
    );
    process.exit(1);
  }

  let upgradeAuthority: string;
  try {
    upgradeAuthority = resolveSvmUpgradeAuthority();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const plan = buildSvmDeployPlan({ cluster, upgradeAuthority });
  console.log(formatSvmDeployPlanTable(plan));
  console.log("\nDry-run complete — no txs.");
}

main();
