/**
 * Sole owner of “how many bytes to allocate” for a founder-approved
 * `solana program extend` before upgrade-in-place.
 *
 * Policy (commercial-census extend): target capacity = ceil(artifactBytes × 5/4)
 * — 125 % of the new .so — so near-term growth does not require another
 * irreversible extend. Exact-deficit extends are intentionally not offered here.
 *
 * Each planned row is classified from measured bytes only:
 * required (artifact > deployed), headroom (fits but below 125% target), or none.
 *
 * Accepted `--programs` keys = commercial census only
 * (`COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST`). No second hand-written list.
 */

import {
  COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST,
  type CommercialProgramEvidenceKey,
} from "../../lib/svm/ingest-config.js";

export const ARTIFACT_CAPACITY_HEADROOM_NUMERATOR = 5 as const;
export const ARTIFACT_CAPACITY_HEADROOM_DENOMINATOR = 4 as const;

export const EXTEND_NOT_IN_REGISTRY = "extend_not_in_registry" as const;
export const EXTEND_PROGRAMS_EMPTY = "extend_programs_empty" as const;
export const EXTEND_ARTIFACT_MISSING = "extend_artifact_missing" as const;
export const EXTEND_CAPACITY_UNREADABLE = "extend_capacity_unreadable" as const;
export const EXTEND_TARGET_BELOW_ARTIFACT = "extend_target_below_artifact" as const;

/** Ordered commercial evidence keys — sole accepted extend set. */
export function commercialExtendEvidenceKeys(): readonly CommercialProgramEvidenceKey[] {
  return COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST;
}

/** ceil(artifact × 5/4) via integer arithmetic (no float). */
export function targetCapacityAtArtifactHeadroom(
  artifactBytes: number,
): number {
  if (!Number.isInteger(artifactBytes) || artifactBytes <= 0) {
    throw new Error(
      `targetCapacityAtArtifactHeadroom: artifactBytes must be a positive integer (got ${artifactBytes})`,
    );
  }
  return Math.ceil(
    (artifactBytes * ARTIFACT_CAPACITY_HEADROOM_NUMERATOR) /
      ARTIFACT_CAPACITY_HEADROOM_DENOMINATOR,
  );
}

/**
 * required — artifact does not fit deployed ProgramData (blocks upgrade).
 * headroom — artifact fits; only the 125% policy asks for more.
 * none — deployed already meets the 125% target (no extend).
 * Decided from measured bytes only — never from program-name lists.
 */
export type ExtendPlanKind = "required" | "headroom" | "none";

export type ProgramExtendPlan =
  | {
      ok: true;
      skip: true;
      kind: "none";
      reason: "already_at_or_above_target";
      deployedCapacityBytes: number;
      artifactBytes: number;
      targetCapacityBytes: number;
      additionalBytes: 0;
    }
  | {
      ok: true;
      skip: false;
      kind: "required" | "headroom";
      deployedCapacityBytes: number;
      artifactBytes: number;
      targetCapacityBytes: number;
      additionalBytes: number;
    };

/**
 * ADDITIONAL_BYTES for `solana program extend <PROGRAM_ID> <ADDITIONAL_BYTES>`.
 * Skip when deployed capacity already meets the 125 % target.
 * Kind partitions: none | required (artifact > deployed) | headroom (fits, below target).
 */
export function planProgramExtend(args: {
  deployedCapacityBytes: number;
  artifactBytes: number;
}): ProgramExtendPlan {
  const { deployedCapacityBytes, artifactBytes } = args;
  if (
    !Number.isInteger(deployedCapacityBytes) ||
    deployedCapacityBytes <= 0
  ) {
    throw new Error(
      `planProgramExtend: deployedCapacityBytes must be a positive integer (got ${deployedCapacityBytes})`,
    );
  }
  if (!Number.isInteger(artifactBytes) || artifactBytes <= 0) {
    throw new Error(
      `planProgramExtend: artifactBytes must be a positive integer (got ${artifactBytes})`,
    );
  }
  const targetCapacityBytes = targetCapacityAtArtifactHeadroom(artifactBytes);
  if (deployedCapacityBytes >= targetCapacityBytes) {
    return {
      ok: true,
      skip: true,
      kind: "none",
      reason: "already_at_or_above_target",
      deployedCapacityBytes,
      artifactBytes,
      targetCapacityBytes,
      additionalBytes: 0,
    };
  }
  const kind: "required" | "headroom" =
    artifactBytes > deployedCapacityBytes ? "required" : "headroom";
  return {
    ok: true,
    skip: false,
    kind,
    deployedCapacityBytes,
    artifactBytes,
    targetCapacityBytes,
    additionalBytes: targetCapacityBytes - deployedCapacityBytes,
  };
}

/**
 * Rent delta for growing program-data from `fromBytes` to `toBytes`.
 * Rent is linear in data length: Δ = rent(to) − rent(from).
 */
export function rentDeltaLamports(args: {
  rentExemptFromLamports: number;
  rentExemptToLamports: number;
}): number {
  const { rentExemptFromLamports, rentExemptToLamports } = args;
  if (
    !Number.isInteger(rentExemptFromLamports) ||
    rentExemptFromLamports < 0 ||
    !Number.isInteger(rentExemptToLamports) ||
    rentExemptToLamports < 0
  ) {
    throw new Error(
      `rentDeltaLamports: rent figures must be non-negative integers`,
    );
  }
  if (rentExemptToLamports < rentExemptFromLamports) {
    throw new Error(
      `rentDeltaLamports: to-rent ${rentExemptToLamports} < from-rent ${rentExemptFromLamports}`,
    );
  }
  return rentExemptToLamports - rentExemptFromLamports;
}

/**
 * Refuse when `--programs` is empty or names a key outside the commercial census.
 * Message lists the registry keys that are accepted.
 */
export function assertExtendProgramsInRegistry(
  keys: readonly string[],
  registryKeys: readonly string[] = commercialExtendEvidenceKeys(),
): void {
  if (keys.length === 0) {
    throw new Error(
      `${EXTEND_PROGRAMS_EMPTY}: --programs empty — commercial registry keys: ` +
        registryKeys.join(","),
    );
  }
  const allowed = new Set(registryKeys);
  for (const k of keys) {
    if (!allowed.has(k)) {
      throw new Error(
        `${EXTEND_NOT_IN_REGISTRY}: ${k} is not in the commercial registry ` +
          `(accepted: ${registryKeys.join(",")})`,
      );
    }
  }
}

/** Defence-in-depth: planned target must cover the artifact byte length. */
export function assertExtendTargetCoversArtifact(args: {
  evidenceKey: string;
  artifactBytes: number;
  targetCapacityBytes: number;
}): void {
  const { evidenceKey, artifactBytes, targetCapacityBytes } = args;
  if (
    !Number.isInteger(artifactBytes) ||
    artifactBytes <= 0 ||
    !Number.isInteger(targetCapacityBytes) ||
    targetCapacityBytes <= 0
  ) {
    throw new Error(
      `${EXTEND_TARGET_BELOW_ARTIFACT}: ${evidenceKey} capacity figures must be positive integers ` +
        `(artifact=${artifactBytes}, target=${targetCapacityBytes})`,
    );
  }
  if (targetCapacityBytes < artifactBytes) {
    throw new Error(
      `${EXTEND_TARGET_BELOW_ARTIFACT}: ${evidenceKey} targetCapacityBytes=${targetCapacityBytes} ` +
        `< artifactBytes=${artifactBytes}`,
    );
  }
}

export function assertExtendArtifactPresent(args: {
  evidenceKey: string;
  soPath: string;
  exists: (path: string) => boolean;
}): void {
  const { evidenceKey, soPath, exists } = args;
  if (!exists(soPath)) {
    throw new Error(
      `${EXTEND_ARTIFACT_MISSING}: ${evidenceKey} artifact absent at ${soPath}`,
    );
  }
}

export function assertExtendCapacityReadable(args: {
  evidenceKey: string;
  showText: string;
  parseCapacity: (showText: string) => number;
}): number {
  const { evidenceKey, showText, parseCapacity } = args;
  try {
    return parseCapacity(showText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${EXTEND_CAPACITY_UNREADABLE}: ${evidenceKey} deployed ProgramData capacity cannot be read — ${detail}`,
    );
  }
}

/** Sum of per-row rent Δ lamports (founder total for dry-run approval). */
export function sumExtendRentDeltaLamports(
  rows: readonly { estimatedRentDeltaLamports: number }[],
): number {
  let total = 0;
  for (const row of rows) {
    const n = row.estimatedRentDeltaLamports;
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `sumExtendRentDeltaLamports: estimatedRentDeltaLamports must be a non-negative integer (got ${n})`,
      );
    }
    total += n;
  }
  return total;
}

export type ExtendPlanReportRow = {
  evidenceKey: string;
  maskedProgramId: string;
  deployedCapacityBytes: number;
  artifactBytes: number;
  targetCapacityBytes: number;
  additionalBytes: number;
  estimatedRentDeltaLamports: number;
  kind: ExtendPlanKind;
};

export type ExtendRentDeltaByKind = {
  required: number;
  headroom: number;
  none: number;
  combined: number;
};

/** Per-kind rentΔ sums; combined = required + headroom (none is always 0 spend). */
export function sumExtendRentDeltaByKind(
  rows: readonly ExtendPlanReportRow[],
): ExtendRentDeltaByKind {
  const required = sumExtendRentDeltaLamports(
    rows.filter((r) => r.kind === "required"),
  );
  const headroom = sumExtendRentDeltaLamports(
    rows.filter((r) => r.kind === "headroom"),
  );
  const none = sumExtendRentDeltaLamports(
    rows.filter((r) => r.kind === "none"),
  );
  return {
    required,
    headroom,
    none,
    combined: required + headroom,
  };
}

const REPORT_KINDS: readonly ExtendPlanKind[] = [
  "required",
  "headroom",
  "none",
];

function formatExtendPlanSection(
  kind: ExtendPlanKind,
  rows: readonly ExtendPlanReportRow[],
): string {
  const header =
    "program | id | deployed | artifact | target(125%) | additional | rentΔ lamports | kind";
  const rule =
    "--------|----|----------|----------|--------------|------------|----------------|-----";
  const lines = [`==> ${kind}`, header, rule];
  if (rows.length === 0) {
    lines.push("(none)");
  } else {
    for (const row of rows) {
      lines.push(
        [
          row.evidenceKey,
          row.maskedProgramId,
          String(row.deployedCapacityBytes),
          String(row.artifactBytes),
          String(row.targetCapacityBytes),
          String(row.additionalBytes),
          String(row.estimatedRentDeltaLamports),
          row.kind,
        ].join(" | "),
      );
    }
  }
  const groupSum = sumExtendRentDeltaLamports(rows);
  lines.push(`sum of rentΔ (${kind}) = ${groupSum} lamports`);
  return lines.join("\n");
}

/**
 * Founder-facing dry-run report: required, then headroom, then none;
 * each group totals its rentΔ; final combined = required + headroom.
 */
export function formatExtendPlanReport(
  rows: readonly ExtendPlanReportRow[],
): string {
  const sections: string[] = [];
  for (const kind of REPORT_KINDS) {
    sections.push(
      formatExtendPlanSection(
        kind,
        rows.filter((r) => r.kind === kind),
      ),
    );
  }
  const totals = sumExtendRentDeltaByKind(rows);
  sections.push(
    `sum of rentΔ (combined) = ${totals.combined} lamports ` +
      `(required ${totals.required} + headroom ${totals.headroom})`,
  );
  return sections.join("\n\n");
}
