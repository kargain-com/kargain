/**
 * Sole write owner for `deployments/svm-{eid}.json` (deploy-machine only).
 * Additive merge — never blank-overwrite; refuse by name on destructive edits.
 * Outside the application runtime graph (scripts/ only; lib must not import this).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type {
  SvmDevnetEvidence,
  SvmDevnetPathwayPeers,
  SvmDevnetProgramEvidence,
} from "../../lib/svm/devnet-evidence.js";

export class SvmDevnetEvidenceWriteError extends Error {
  readonly causeCode: string;

  constructor(causeCode: string, message: string) {
    super(message);
    this.name = "SvmDevnetEvidenceWriteError";
    this.causeCode = causeCode;
  }
}

/**
 * Document identity — immutable once set (restate identically or refuse).
 * Source identity of a BPF artifact lives on the program row (`sourceGitHead`), not here.
 */
export const SVM_EVIDENCE_IDENTITY_FIELDS = [
  "cluster",
  "eid",
  "namespace",
  "deployerPubkey",
  "upgradeAuthority",
  "gatewayConfigAuthority",
  "forfeitRecipient",
  "layerZeroEndpoint",
] as const;

/**
 * Snapshot / pathway / proof annotations — replace only via explicit `annotations`.
 */
export const SVM_EVIDENCE_ANNOTATION_FIELDS = [
  "rpcUrl",
  "slotAtEvidence",
  "indexFromSlot",
  "solanaCli",
  "cargoBuildSbf",
  "commercialActive",
  "wired",
  "minStakePin",
  "peers",
  "pathwayConfigHash",
  "note",
  "oapp",
  "y4",
  "s5Prove",
  "abandonedPriorPrograms",
] as const;

export type SvmEvidenceIdentityField =
  (typeof SVM_EVIDENCE_IDENTITY_FIELDS)[number];
export type SvmEvidenceAnnotationField =
  (typeof SVM_EVIDENCE_ANNOTATION_FIELDS)[number];

const IDENTITY_SET = new Set<string>(SVM_EVIDENCE_IDENTITY_FIELDS);
const ANNOTATION_SET = new Set<string>(SVM_EVIDENCE_ANNOTATION_FIELDS);

/** Retired document-level source identity — must not be written. */
const RETIRED_DOCUMENT_SOURCE_FIELDS = new Set(["deployGitHead"]);

export type SvmProgramEvidencePatch = {
  programId: string;
  /** Required on every program row write that records a built artifact. */
  soSha256: string;
  soBytes: number;
  /** Git commit the .so was built from — required with every digest write. */
  sourceGitHead: string;
  upgradeAuthority?: string;
  /**
   * Set only when the programId first becomes followable.
   * Refused when the prior row already has a different deploySlot.
   */
  deploySlot?: number;
};

export type MergeSvmDevnetEvidenceArgs = {
  /** Call-site name for refusal messages (script / function). */
  caller: string;
  prior: SvmDevnetEvidence | null;
  /**
   * Identity fields: may only restate an existing value identically.
   * A differing value refuses by name with both sides.
   */
  identity?: Readonly<Partial<Record<SvmEvidenceIdentityField, unknown>>>;
  /**
   * Annotation fields: replaced only when this argument is present.
   * Passing a differing annotation via `identity` (or inventing a third channel) refuses.
   */
  annotations?: Readonly<Partial<Record<SvmEvidenceAnnotationField, unknown>>>;
  /** Per-program patches — additive only; never deletes a prior key. */
  programs?: Readonly<Record<string, SvmProgramEvidencePatch>>;
};

const SHA256_HEX = /^[a-f0-9]{64}$/;
const GIT_HEAD_HEX = /^[a-f0-9]{7,40}$/;

export function artifactDigestFromSo(soPath: string): {
  soSha256: string;
  soBytes: number;
} {
  const buf = readFileSync(soPath);
  return {
    soSha256: createHash("sha256").update(buf).digest("hex"),
    soBytes: buf.byteLength,
  };
}

/** Git HEAD at the moment a BPF digest is recorded (program-row source identity). */
export function currentSourceGitHead(cwd = process.cwd()): string {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  }).trim();
  if (!GIT_HEAD_HEX.test(head)) {
    throw new SvmDevnetEvidenceWriteError(
      "invalid_source_git_head",
      `svm evidence write refused: git rev-parse HEAD produced invalid value`,
    );
  }
  return head;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assertDigestAndSource(
  patch: SvmProgramEvidencePatch,
  key: string,
  caller: string,
): void {
  if (typeof patch.soSha256 !== "string" || !SHA256_HEX.test(patch.soSha256)) {
    throw new SvmDevnetEvidenceWriteError(
      "missing_so_sha256",
      `svm evidence write refused (${caller}): program "${key}" written without soSha256 ` +
        `(got ${JSON.stringify(patch.soSha256)})`,
    );
  }
  if (
    typeof patch.soBytes !== "number" ||
    !Number.isInteger(patch.soBytes) ||
    patch.soBytes <= 0
  ) {
    throw new SvmDevnetEvidenceWriteError(
      "missing_so_bytes",
      `svm evidence write refused (${caller}): program "${key}" written without positive soBytes ` +
        `(got ${JSON.stringify(patch.soBytes)})`,
    );
  }
  if (
    typeof patch.sourceGitHead !== "string" ||
    !GIT_HEAD_HEX.test(patch.sourceGitHead)
  ) {
    throw new SvmDevnetEvidenceWriteError(
      "missing_source_git_head",
      `svm evidence write refused (${caller}): program "${key}" has digest but no sourceGitHead ` +
        `(got ${JSON.stringify(patch.sourceGitHead)})`,
    );
  }
  if (typeof patch.programId !== "string" || patch.programId.trim() === "") {
    throw new SvmDevnetEvidenceWriteError(
      "missing_program_id",
      `svm evidence write refused (${caller}): program "${key}" written without programId`,
    );
  }
}

function mergeProgramRow(
  caller: string,
  key: string,
  prior: SvmDevnetProgramEvidence | undefined,
  patch: SvmProgramEvidencePatch,
): SvmDevnetProgramEvidence {
  assertDigestAndSource(patch, key, caller);

  const nextId = patch.programId.trim();
  if (prior?.programId && prior.programId.trim() !== nextId) {
    throw new SvmDevnetEvidenceWriteError(
      "program_id_immutable",
      `svm evidence write refused (${caller}): program "${key}" programId is immutable ` +
        `(prior=${prior.programId}, attempted=${nextId})`,
    );
  }

  if (
    prior &&
    typeof prior.deploySlot === "number" &&
    patch.deploySlot !== undefined &&
    patch.deploySlot !== prior.deploySlot
  ) {
    throw new SvmDevnetEvidenceWriteError(
      "deploy_slot_immutable",
      `svm evidence write refused (${caller}): program "${key}" deploySlot is immutable ` +
        `(prior=${prior.deploySlot}, attempted=${patch.deploySlot})`,
    );
  }

  const deploySlot =
    typeof prior?.deploySlot === "number"
      ? prior.deploySlot
      : patch.deploySlot;

  const next: SvmDevnetProgramEvidence = {
    programId: nextId,
    soSha256: patch.soSha256,
    soBytes: patch.soBytes,
    sourceGitHead: patch.sourceGitHead,
  };
  if (typeof deploySlot === "number") {
    next.deploySlot = deploySlot;
  }
  if (patch.upgradeAuthority !== undefined) {
    next.upgradeAuthority = patch.upgradeAuthority;
  } else if (prior?.upgradeAuthority !== undefined) {
    next.upgradeAuthority = prior.upgradeAuthority;
  }
  return next;
}

function applyIdentity(
  caller: string,
  prior: SvmDevnetEvidence | null,
  next: SvmDevnetEvidence,
  identity: MergeSvmDevnetEvidenceArgs["identity"],
): void {
  if (!identity) return;
  for (const [field, value] of Object.entries(identity)) {
    if (value === undefined) continue;
    if (RETIRED_DOCUMENT_SOURCE_FIELDS.has(field)) {
      throw new SvmDevnetEvidenceWriteError(
        "retired_document_source_field",
        `svm evidence write refused (${caller}): "${field}" is retired — ` +
          `source identity lives on each program row as sourceGitHead`,
      );
    }
    if (ANNOTATION_SET.has(field)) {
      throw new SvmDevnetEvidenceWriteError(
        "annotation_requires_explicit_argument",
        `svm evidence write refused (${caller}): annotation "${field}" requires explicit ` +
          `annotations argument (prior=${JSON.stringify(prior?.[field])}, ` +
          `attempted=${JSON.stringify(value)})`,
      );
    }
    if (!IDENTITY_SET.has(field)) {
      throw new SvmDevnetEvidenceWriteError(
        "unknown_identity_field",
        `svm evidence write refused (${caller}): "${field}" is not an identity field`,
      );
    }
    if (prior && field in prior && prior[field] !== undefined) {
      if (!jsonEqual(prior[field], value)) {
        throw new SvmDevnetEvidenceWriteError(
          "identity_conflict",
          `svm evidence write refused (${caller}): identity "${field}" conflict ` +
            `(prior=${JSON.stringify(prior[field])}, attempted=${JSON.stringify(value)})`,
        );
      }
    }
    next[field] = value;
  }
}

function applyAnnotations(
  caller: string,
  prior: SvmDevnetEvidence | null,
  next: SvmDevnetEvidence,
  annotations: MergeSvmDevnetEvidenceArgs["annotations"],
): void {
  if (!annotations) return;
  for (const [field, value] of Object.entries(annotations)) {
    if (value === undefined) continue;
    if (RETIRED_DOCUMENT_SOURCE_FIELDS.has(field)) {
      throw new SvmDevnetEvidenceWriteError(
        "retired_document_source_field",
        `svm evidence write refused (${caller}): "${field}" is retired — ` +
          `source identity lives on each program row as sourceGitHead`,
      );
    }
    if (IDENTITY_SET.has(field)) {
      throw new SvmDevnetEvidenceWriteError(
        "annotation_channel_misuse",
        `svm evidence write refused (${caller}): identity "${field}" must use the identity channel ` +
          `(prior=${JSON.stringify(prior?.[field])}, attempted=${JSON.stringify(value)})`,
      );
    }
    if (!ANNOTATION_SET.has(field)) {
      throw new SvmDevnetEvidenceWriteError(
        "unknown_annotation_field",
        `svm evidence write refused (${caller}): "${field}" is not an annotation field ` +
          `(pass explicit annotations only for known snapshot/pathway/proof keys)`,
      );
    }
    // Explicit annotations argument = intentional replace (no silent path).
    next[field] = value;
  }
}

/**
 * Pure merge: prior ∪ patch. Never drops a prior program key.
 * Strips retired document-level `deployGitHead` (source identity is per-program).
 */
export function mergeSvmDevnetEvidence(
  args: MergeSvmDevnetEvidenceArgs,
): SvmDevnetEvidence {
  const { caller, prior, identity, annotations, programs: programPatches } =
    args;
  if (!caller.trim()) {
    throw new SvmDevnetEvidenceWriteError(
      "missing_caller",
      "svm evidence write refused: caller name required",
    );
  }

  const basePrograms: Record<string, SvmDevnetProgramEvidence> = {
    ...(prior?.programs ?? {}),
  };
  const priorKeys = Object.keys(basePrograms);

  if (programPatches) {
    for (const [key, patch] of Object.entries(programPatches)) {
      basePrograms[key] = mergeProgramRow(
        caller,
        key,
        basePrograms[key],
        patch,
      );
    }
  }

  assertRetainsPriorProgramKeys(caller, priorKeys, Object.keys(basePrograms));

  if (!basePrograms.kar_passport || !basePrograms.kar_gateway) {
    throw new SvmDevnetEvidenceWriteError(
      "missing_baseline_programs",
      `svm evidence write refused (${caller}): kar_passport and kar_gateway are required baseline keys`,
    );
  }

  const eid = (identity?.eid as number | undefined) ?? prior?.eid;
  const cluster =
    (identity?.cluster as string | undefined) ?? prior?.cluster;
  if (typeof eid !== "number" || !Number.isInteger(eid)) {
    throw new SvmDevnetEvidenceWriteError(
      "missing_eid",
      `svm evidence write refused (${caller}): eid required`,
    );
  }
  if (typeof cluster !== "string" || cluster.trim() === "") {
    throw new SvmDevnetEvidenceWriteError(
      "missing_cluster",
      `svm evidence write refused (${caller}): cluster required`,
    );
  }

  const next: SvmDevnetEvidence = {
    ...(prior ?? {}),
    cluster,
    eid,
    programs: basePrograms as SvmDevnetEvidence["programs"],
  };
  // Source identity is per-program; document-level deployGitHead is retired.
  delete next.deployGitHead;

  applyIdentity(caller, prior, next, identity);
  applyAnnotations(caller, prior, next, annotations);

  return next;
}

/** Exported for constructed-violation tests and validators. */
export function assertRetainsPriorProgramKeys(
  caller: string,
  priorKeys: readonly string[],
  nextKeys: readonly string[],
): void {
  const next = new Set(nextKeys);
  for (const key of priorKeys) {
    if (!next.has(key)) {
      throw new SvmDevnetEvidenceWriteError(
        "program_key_dropped",
        `svm evidence write refused (${caller}): would drop existing program key "${key}"`,
      );
    }
  }
}

/**
 * Merge then persist. Sole filesystem writer for svm-{eid}.json evidence.
 */
export function mergeAndWriteSvmDevnetEvidence(
  path: string,
  args: Omit<MergeSvmDevnetEvidenceArgs, "prior"> & {
    prior: SvmDevnetEvidence | null;
  },
): SvmDevnetEvidence {
  const merged = mergeSvmDevnetEvidence(args);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

/** Bridge-wire pathway peers write — exercised by policy tests. */
export function writeSvmBridgePathwayEvidence(args: {
  path: string;
  prior: SvmDevnetEvidence;
  peers: SvmDevnetPathwayPeers;
  pathwayConfigHash: `0x${string}`;
  oapp: string;
  note: string;
}): SvmDevnetEvidence {
  return mergeAndWriteSvmDevnetEvidence(args.path, {
    caller: "bridge-wire.ts",
    prior: args.prior,
    annotations: {
      peers: args.peers,
      pathwayConfigHash: args.pathwayConfigHash,
      oapp: args.oapp,
      note: args.note,
    },
  });
}

/** Y4 prove annotation write — exercised by policy tests. */
export function writeSvmY4ProveEvidence(args: {
  path: string;
  prior: SvmDevnetEvidence;
  y4: Record<string, unknown>;
}): SvmDevnetEvidence {
  return mergeAndWriteSvmDevnetEvidence(args.path, {
    caller: "svm-devnet-y4-prove.ts",
    prior: args.prior,
    annotations: {
      y4: args.y4,
    },
  });
}
