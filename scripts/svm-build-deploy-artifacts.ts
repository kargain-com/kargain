/**
 * Thin CLI for the svm-deploy-artifact owner.
 *
 * Usage:
 *   pnpm svm:build-artifacts --purpose upgradeable_ship --programs kar_passport,kar_gateway
 *   pnpm svm:build-artifacts --purpose stand_preload --programs kar-passport,kar-gateway
 *
 * --programs accepts evidence stems (kar_passport) or crate dirs (kar-passport).
 */

import {
  buildDeployArtifacts,
  DEPLOY_ARTIFACT_PURPOSES,
  programDirForStem,
  type DeployArtifactPurpose,
} from "./lib/svm-deploy-artifact.js";

const CALLER = "svm-build-deploy-artifacts.ts";

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) {
    throw new Error(`${CALLER}: missing ${name}`);
  }
  return process.argv[i + 1]!;
}

function main(): void {
  const purposeRaw = arg("--purpose");
  if (!(purposeRaw in DEPLOY_ARTIFACT_PURPOSES)) {
    throw new Error(
      `${CALLER}: --purpose must be stand_preload|upgradeable_ship (got ${purposeRaw})`,
    );
  }
  const purpose = purposeRaw as DeployArtifactPurpose;
  const programsCsv = arg("--programs");
  const entries = programsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error(`${CALLER}: --programs empty`);
  }
  const programDirs = entries.map((e) =>
    e.includes("-") ? e : programDirForStem(e),
  );

  const result = buildDeployArtifacts({ purpose, programDirs });
  console.log(
    `==> built purpose=${result.purpose} outDir=${result.outDirAbs} n=${result.artifacts.length}`,
  );
  for (const a of result.artifacts) {
    console.log(
      `    ${a.stem} e_flags=0x${a.eFlags.toString(16)} path=${a.path}`,
    );
  }
}

main();
