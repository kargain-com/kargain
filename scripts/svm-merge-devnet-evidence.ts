/**
 * CLI: additive merge write for deployments/svm-{eid}.json via sole owner.
 *
 *   pnpm exec tsx scripts/svm-merge-devnet-evidence.ts \
 *     --caller deploy-s9-0-modes.sh \
 *     --evidence deployments/svm-40168.json \
 *     --programs-json '{"kar_fixed_price":{...}}' \
 *     --attach-so-json '{"kar_fixed_price":"svm/target/deploy/kar_fixed_price.so"}'
 *
 * Digests are taken from --attach-so-json when provided (preferred).
 * Never prints env secret values.
 */

import { readFileSync } from "node:fs";

import { loadSvmDevnetEvidence, svmDevnetEvidencePath } from "./lib/load-deployment.ts";
import {
  artifactDigestFromSo,
  mergeAndWriteSvmDevnetEvidence,
  type SvmProgramEvidencePatch,
} from "./lib/svm-devnet-evidence-write.ts";

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) {
    throw new Error(`missing ${name}`);
  }
  return process.argv[i + 1]!;
}

function optionalArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

function parseJsonArg(raw: string): unknown {
  if (raw.startsWith("@")) {
    return JSON.parse(readFileSync(raw.slice(1), "utf8"));
  }
  return JSON.parse(raw);
}

function main(): void {
  const caller = arg("--caller");
  const evidencePath =
    optionalArg("--evidence") ?? svmDevnetEvidencePath(40168);
  const eid = Number(optionalArg("--eid") ?? "40168");
  const programsRaw = optionalArg("--programs-json");
  const topLevelRaw = optionalArg("--toplevel-json");
  const attachSoRaw = optionalArg("--attach-so-json");

  let programs: Record<string, SvmProgramEvidencePatch> = programsRaw
    ? (parseJsonArg(programsRaw) as Record<string, SvmProgramEvidencePatch>)
    : {};

  if (attachSoRaw) {
    const map = parseJsonArg(attachSoRaw) as Record<string, string>;
    for (const [key, soPath] of Object.entries(map)) {
      const digest = artifactDigestFromSo(soPath);
      const row = programs[key];
      if (!row) {
        throw new Error(`--attach-so-json key ${key} missing from --programs-json`);
      }
      programs = {
        ...programs,
        [key]: {
          ...row,
          soSha256: digest.soSha256,
          soBytes: digest.soBytes,
        },
      };
    }
  }

  const topLevel = topLevelRaw
    ? (parseJsonArg(topLevelRaw) as Record<string, unknown>)
    : undefined;

  const prior = loadSvmDevnetEvidence(eid);
  const merged = mergeAndWriteSvmDevnetEvidence(evidencePath, {
    caller,
    prior,
    topLevel,
    programs,
  });
  console.log(
    `evidence merged → ${evidencePath} (programs=${Object.keys(merged.programs).join(",")})`,
  );
}

main();
