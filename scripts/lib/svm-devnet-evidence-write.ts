/**
 * Sole write owner for `deployments/svm-{eid}.json` (deploy-machine only).
 * Additive merge — never blank-overwrite; refuse by name on destructive edits.
 * Outside the application runtime graph (scripts/ only; lib must not import this).
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type {
  SvmDevnetEvidence,
  SvmDevnetProgramEvidence,
} from "../../lib/svm/devnet-evidence.js";
import { COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST } from "../../lib/svm/ingest-config.js";

export class SvmDevnetEvidenceWriteError extends Error {
  readonly causeCode: string;

  constructor(causeCode: string, message: string) {
    super(message);
    this.name = "SvmDevnetEvidenceWriteError";
    this.causeCode = causeCode;
  }
}

export type SvmProgramEvidencePatch = {
  programId: string;
  /** Required on every program row write that records a built artifact. */
  soSha256: string;
  soBytes: number;
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
   * Top-level fields to set. Existing values may only be restated identically;
   * a different value refuses by name with both sides.
   */
  topLevel?: Readonly<Record<string, unknown>>;
  /** Per-program patches — additive only; never deletes a prior key. */
  programs?: Readonly<Record<string, SvmProgramEvidencePatch>>;
};

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function sha256FileHex(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

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

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assertDigest(patch: SvmProgramEvidencePatch, key: string, caller: string): void {
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
  assertDigest(patch, key, caller);

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
    programId: patch.programId.trim(),
    soSha256: patch.soSha256,
    soBytes: patch.soBytes,
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

/**
 * Pure merge: prior ∪ patch. Never drops a prior program key.
 */
export function mergeSvmDevnetEvidence(
  args: MergeSvmDevnetEvidenceArgs,
): SvmDevnetEvidence {
  const { caller, prior, topLevel, programs: programPatches } = args;
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

  const eid = (topLevel?.eid as number | undefined) ?? prior?.eid;
  const cluster =
    (topLevel?.cluster as string | undefined) ?? prior?.cluster;
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

  if (topLevel) {
    for (const [field, value] of Object.entries(topLevel)) {
      if (value === undefined) continue;
      if (field === "programs") {
        throw new SvmDevnetEvidenceWriteError(
          "programs_via_toplevel",
          `svm evidence write refused (${caller}): programs must use the programs patch, not topLevel`,
        );
      }
      if (prior && field in prior && prior[field] !== undefined) {
        if (!jsonEqual(prior[field], value)) {
          throw new SvmDevnetEvidenceWriteError(
            "toplevel_conflict",
            `svm evidence write refused (${caller}): top-level "${field}" conflict ` +
              `(prior=${JSON.stringify(prior[field])}, attempted=${JSON.stringify(value)})`,
          );
        }
      }
      next[field] = value;
    }
  }

  return next;
}

/** Exported for constructed-violation tests and any future full-document validators. */
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

/** Commercial census keys — for gates; reuses ingest-config list. */
export function commercialEvidenceKeys(): readonly string[] {
  return COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST;
}
