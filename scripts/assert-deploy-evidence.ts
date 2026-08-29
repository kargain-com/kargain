/**
 * Read-only: refuse explorer verify when deploy-time build-info / artifact
 * digests are missing or drifted.
 *
 *   pnpm verify:deploy-evidence
 *   pnpm verify:deploy-evidence -- --eth
 */
import { config as loadEnv } from "dotenv";

import {
  assertDeployEvidence,
  formatDeployEvidenceFailure,
} from "./lib/assert-deploy-evidence.js";
import {
  commercialDeploymentPath,
  requireCommercialDeployment,
  requireSepoliaDeployment,
  SEPOLIA_DEPLOYMENT_PATH,
} from "./lib/load-deployment.js";

loadEnv({ path: ".env.local" });
loadEnv();

function main() {
  const eth =
    process.argv.includes("--eth") || process.argv.includes("--chain=11155111");
  let manifest;
  try {
    manifest = eth
      ? requireCommercialDeployment(11155111)
      : requireSepoliaDeployment();
  } catch {
    const path = eth ? commercialDeploymentPath(11155111) : SEPOLIA_DEPLOYMENT_PATH();
    console.error(`Missing ${path} — run nuclear deploy first`);
    process.exit(1);
  }

  console.log(
    `Deploy evidence — chain ${manifest.chainId} generation ${manifest.generation}`,
  );
  const result = assertDeployEvidence(manifest);
  if (!result.ok) {
    console.error(formatDeployEvidenceFailure(result));
    process.exit(1);
  }
  console.log(
    `  OK buildInfoId=${manifest.buildInfoId} sha256=${manifest.buildInfoSha256?.slice(0, 16)}…`,
  );
  console.log(
    `  OK artifactDigests (${Object.keys(manifest.artifactDigests ?? {}).length} paths)`,
  );
  console.log("\nEvidence intact — safe to run verify:bytecode-identity / verify:sepolia.");
}

main();
