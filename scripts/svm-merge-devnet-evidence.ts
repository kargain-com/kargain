/**
 * CLI: additive merge write for deployments/svm-{eid}.json via sole owner.
 *
 *   pnpm exec tsx scripts/svm-merge-devnet-evidence.ts \
 *     --caller deploy-s9-0-modes.sh \
 *     --evidence deployments/svm-40168.json \
 *     --programs-json '{"kar_fixed_price":{...}}' \
 *     --attach-so-json '{"kar_fixed_price":"svm/target/deploy/kar_fixed_price.so"}'
 *
 * Digests + sourceGitHead are taken from --attach-so-json when provided (preferred).
 * Never prints env secret values.
 */

import { readFileSync } from "node:fs";

import { loadSvmDevnetEvidence, svmDevnetEvidencePath } from "./lib/load-deployment.js";
import {
  artifactDigestFromSo,
  currentSourceGitHead,
  mergeAndWriteSvmDevnetEvidence,
  SVM_EVIDENCE_ANNOTATION_FIELDS,
  SVM_EVIDENCE_IDENTITY_FIELDS,
  type SvmEvidenceAnnotationField,
  type SvmEvidenceIdentityField,
  type SvmProgramEvidencePatch,
} from "./lib/svm-devnet-evidence-write.js";

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

const IDENTITY_SET = new Set<string>(SVM_EVIDENCE_IDENTITY_FIELDS);
const ANNOTATION_SET = new Set<string>(SVM_EVIDENCE_ANNOTATION_FIELDS);

function partitionTopLevel(raw: Record<string, unknown>): {
  identity?: Partial<Record<SvmEvidenceIdentityField, unknown>>;
  annotations?: Partial<Record<SvmEvidenceAnnotationField, unknown>>;
} {
  const identity: Partial<Record<SvmEvidenceIdentityField, unknown>> = {};
  const annotations: Partial<Record<SvmEvidenceAnnotationField, unknown>> = {};
  let hasIdentity = false;
  let hasAnnotations = false;
  for (const [field, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (IDENTITY_SET.has(field)) {
      identity[field as SvmEvidenceIdentityField] = value;
      hasIdentity = true;
    } else if (ANNOTATION_SET.has(field)) {
      annotations[field as SvmEvidenceAnnotationField] = value;
      hasAnnotations = true;
    } else {
      throw new Error(
        `svm-merge-devnet-evidence: unknown top-level field "${field}" ` +
          `(use identity or annotation fields only; deployGitHead is retired)`,
      );
    }
  }
  return {
    identity: hasIdentity ? identity : undefined,
    annotations: hasAnnotations ? annotations : undefined,
  };
}

function main(): void {
  const caller = arg("--caller");
  const evidencePath =
    optionalArg("--evidence") ?? svmDevnetEvidencePath(40168);
  const eid = Number(optionalArg("--eid") ?? "40168");
  const programsRaw = optionalArg("--programs-json");
  const identityRaw = optionalArg("--identity-json");
  const annotationsRaw = optionalArg("--annotations-json");
  const topLevelRaw = optionalArg("--toplevel-json");
  const attachSoRaw = optionalArg("--attach-so-json");
  const sourceHeadOverride = optionalArg("--source-git-head");

  let programs: Record<string, SvmProgramEvidencePatch> = programsRaw
    ? (parseJsonArg(programsRaw) as Record<string, SvmProgramEvidencePatch>)
    : {};

  const sourceGitHead = sourceHeadOverride ?? currentSourceGitHead();

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
          sourceGitHead: row.sourceGitHead ?? sourceGitHead,
        },
      };
    }
  }

  for (const [key, row] of Object.entries(programs)) {
    if (row.soSha256 && !row.sourceGitHead) {
      programs[key] = { ...row, sourceGitHead };
    }
  }

  let identity:
    | Partial<Record<SvmEvidenceIdentityField, unknown>>
    | undefined;
  let annotations:
    | Partial<Record<SvmEvidenceAnnotationField, unknown>>
    | undefined;

  if (identityRaw) {
    identity = parseJsonArg(identityRaw) as Partial<
      Record<SvmEvidenceIdentityField, unknown>
    >;
  }
  if (annotationsRaw) {
    annotations = parseJsonArg(annotationsRaw) as Partial<
      Record<SvmEvidenceAnnotationField, unknown>
    >;
  }
  if (topLevelRaw) {
    const partitioned = partitionTopLevel(
      parseJsonArg(topLevelRaw) as Record<string, unknown>,
    );
    identity = { ...partitioned.identity, ...identity };
    annotations = { ...partitioned.annotations, ...annotations };
  }

  const prior = loadSvmDevnetEvidence(eid);
  const merged = mergeAndWriteSvmDevnetEvidence(evidencePath, {
    caller,
    prior,
    identity,
    annotations,
    programs,
  });
  console.log(
    `evidence merged → ${evidencePath} (programs=${Object.keys(merged.programs).join(",")})`,
  );
}

main();
