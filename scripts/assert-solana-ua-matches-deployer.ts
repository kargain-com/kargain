/**
 * Fail-closed: SOLANA_UPGRADE_AUTHORITY ≡ deployer pubkey (S4–S9).
 * Sole CLI entry for live bash deploy paths — calls svm-deploy-plan owner.
 *
 *   pnpm exec tsx scripts/assert-solana-ua-matches-deployer.ts
 */
import { createRequire } from "node:module";

import { assertSolanaUpgradeAuthorityMatchesDeployer } from "./lib/svm-deploy-plan.js";
import { materializeSolanaDeployer } from "./lib/svm-materialize-deployer.js";

const require = createRequire(import.meta.url);
try {
  require("dotenv").config({ path: ".env.local" });
} catch {
  /* optional */
}

try {
  const { pubkey } = materializeSolanaDeployer();
  const ua = assertSolanaUpgradeAuthorityMatchesDeployer(pubkey);
  process.stdout.write(`${ua}\n`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
