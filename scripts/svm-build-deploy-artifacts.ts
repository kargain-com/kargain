/**
 * Thin CLI for the svm-deploy-artifact owner.
 *
 * Usage:
 *   pnpm svm:build-artifacts -- --purpose upgradeable_ship --programs kar_passport
 *   pnpm svm:build-artifacts -- --purpose upgradeable_ship
 *   pnpm svm:build-artifacts -- --purpose stand_preload --programs kar_passport,kar_gateway
 *
 * Shipping --programs: census evidence keys only (default = whole census).
 * Stand --programs: crate dirs or stems (harness allowed); required when purpose is stand_preload.
 */

import {
  admitCommercialDeployStem,
  buildDeployArtifacts,
  commercialDeployArtifactStems,
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

function optionalArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

function main(): void {
  const purposeRaw = arg("--purpose");
  if (!(purposeRaw in DEPLOY_ARTIFACT_PURPOSES)) {
    throw new Error(
      `${CALLER}: --purpose must be stand_preload|upgradeable_ship (got ${purposeRaw})`,
    );
  }
  const purpose = purposeRaw as DeployArtifactPurpose;
  const programsCsv = optionalArg("--programs");

  let programDirs: string[];
  if (purpose === "upgradeable_ship") {
    const entries =
      programsCsv === undefined || programsCsv.trim() === ""
        ? [...commercialDeployArtifactStems()]
        : programsCsv
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    if (entries.length === 0) {
      throw new Error(`${CALLER}: --programs empty`);
    }
    programDirs = [];
    for (const entry of entries) {
      const admitted = admitCommercialDeployStem(entry);
      if (!admitted.ok) {
        throw new Error(
          `${CALLER}: deploy_artifact_unknown_program entry=${entry} — ` +
            `shipping builds admit only SVM_COMMERCIAL_PROGRAM_CENSUS evidence keys`,
        );
      }
      programDirs.push(admitted.programDir);
    }
  } else {
    if (programsCsv === undefined || programsCsv.trim() === "") {
      throw new Error(
        `${CALLER}: --programs required for stand_preload (crate dirs or stems)`,
      );
    }
    const entries = programsCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (entries.length === 0) {
      throw new Error(`${CALLER}: --programs empty`);
    }
    programDirs = entries.map((e) =>
      e.includes("-") ? e : programDirForStem(e),
    );
  }

  const result = buildDeployArtifacts({ purpose, programDirs });
  console.log(
    `==> built purpose=${result.purpose} outDir=${result.outDirAbs} n=${result.artifacts.length}` +
      (result.gitHead !== undefined ? ` gitHead=${result.gitHead}` : "") +
      (result.manifestPath !== undefined
        ? ` manifest=${result.manifestPath}`
        : ""),
  );
  for (const a of result.artifacts) {
    const digest =
      a.sha256 !== undefined
        ? ` sha256=${a.sha256} bytes=${a.bytes}`
        : "";
    console.log(
      `    ${a.stem} e_flags=0x${a.eFlags.toString(16)}${digest} path=${a.path}`,
    );
  }
}

main();
