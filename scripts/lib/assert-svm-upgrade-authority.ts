/**
 * Sole owner: evidence `programs.*.upgradeAuthority` ≡ on-chain ProgramData
 * Authority for every live SVM program row with a programId (I4).
 *
 * Does not upgrade, hand off, or rewrite evidence. Abandoned prior program ids
 * are not asserted (they live under `abandonedPriorPrograms` only).
 * Commercial census completeness is NOT this owner's job — ingest entry only.
 */
import { commercialProgramCensusGaps } from "../../lib/svm/ingest-config.js";
import type { SvmDevnetEvidence } from "./load-deployment.js";

export type SvmAuthorityOk = {
  ok: true;
  /** Commercial rows (excludes mock_staking) that matched on-chain Authority. */
  checked: number;
  /** Stand-only mock_staking matched when present. */
  standOnlyChecked: number;
};

export type SvmAuthorityFail = {
  ok: false;
  reasons: string[];
};

export type SvmAuthorityResult = SvmAuthorityOk | SvmAuthorityFail;

/** Parse `solana program show` stdout for the upgrade Authority line. */
export function parseProgramShowAuthority(showOutput: string): string | null {
  const m = /^Authority:\s*(\S+)\s*$/m.exec(showOutput);
  if (!m) return null;
  const auth = m[1]!.trim();
  if (!auth || auth === "disabled") return null;
  return auth;
}

export type FetchProgramAuthority = (
  programId: string,
) => Promise<string | null>;

/**
 * Compare each evidence program row with a programId to on-chain Authority.
 * Refuses missing per-program UA, fetch failure, and mismatch.
 * Refuses leftover `plannedFinalUpgradeAuthority` (not a live ops field).
 * Incomplete commercial census is not a refusal here.
 */
export async function assertSvmUpgradeAuthority(
  evidence: SvmDevnetEvidence,
  fetchAuthority: FetchProgramAuthority,
): Promise<SvmAuthorityResult> {
  const reasons: string[] = [];

  if (
    Object.prototype.hasOwnProperty.call(evidence, "plannedFinalUpgradeAuthority")
  ) {
    reasons.push(
      "Evidence still has plannedFinalUpgradeAuthority — remove; S4–S9 UA is deployer (env ≡ pubkey)",
    );
  }

  const programs = evidence.programs;
  if (!programs || typeof programs !== "object") {
    return { ok: false, reasons: ["Evidence missing programs"] };
  }

  const entries: Array<[string, { programId?: string; upgradeAuthority?: string }]> = [];
  for (const [name, row] of Object.entries(programs)) {
    if (row != null && typeof row === "object") {
      entries.push([name, row]);
    }
  }

  if (entries.length === 0) {
    reasons.push("Evidence programs is empty");
  }

  let checked = 0;
  let standOnlyChecked = 0;
  for (const [name, row] of entries) {
    const programId = row.programId?.trim();
    const recorded = row.upgradeAuthority?.trim();
    if (!programId) {
      // Present key with empty id is malformed; absent optional keys are not listed.
      reasons.push(`programs.${name} missing programId`);
      continue;
    }
    if (!recorded) {
      reasons.push(
        `programs.${name} (${programId}) missing upgradeAuthority in evidence`,
      );
      continue;
    }
    let onChain: string | null;
    try {
      onChain = await fetchAuthority(programId);
    } catch (err) {
      reasons.push(
        `programs.${name} (${programId}): fetch failed — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }
    if (!onChain) {
      reasons.push(
        `programs.${name} (${programId}): on-chain Authority unread or disabled`,
      );
      continue;
    }
    if (onChain !== recorded) {
      reasons.push(
        `programs.${name} (${programId}): evidence UA ${recorded} ≠ on-chain ${onChain}`,
      );
      continue;
    }
    if (name === "mock_staking") {
      standOnlyChecked += 1;
    } else {
      checked += 1;
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, checked, standOnlyChecked };
}

export function formatSvmAuthorityFailure(result: SvmAuthorityFail): string {
  return [
    "SVM upgrade-authority evidence mismatch — refuse (fix evidence or redeploy):",
    ...result.reasons.map((r) => `  - ${r}`),
  ].join("\n");
}

/**
 * Census summary for verify stdout — never refuses.
 * Completeness = same predicate as commercialProgramCensusGaps / the ingest
 * commercial assert (programId + deploySlot). Incomplete names causes
 * separately: missing programId (deploy) vs missing deploySlot (fill from
 * `solana program show`).
 */
export function formatSvmCommercialCensusSummary(
  evidence: SvmDevnetEvidence,
): string {
  const gaps = commercialProgramCensusGaps(evidence);
  const k = 6 - gaps.length;
  if (gaps.length === 0) {
    return `census: checked 6 of 6; complete`;
  }
  const noId = gaps
    .filter((g) => g.cause === "missing_program_id")
    .map((g) => g.key)
    .sort();
  const noSlot = gaps
    .filter((g) => g.cause === "missing_deploy_slot")
    .map((g) => g.key)
    .sort();
  const parts: string[] = [];
  if (noId.length > 0) {
    parts.push(`missing programId: ${noId.join(", ")}`);
  }
  if (noSlot.length > 0) {
    parts.push(`missing deploySlot: ${noSlot.join(", ")}`);
  }
  return `census: checked ${k} of 6; incomplete: ${parts.join("; ")}`;
}

/** Format success lines after authority check (founder-visible). */
export function formatSvmAuthoritySuccessLines(
  result: SvmAuthorityOk,
  evidence: SvmDevnetEvidence,
): string[] {
  const lines = [
    `  OK ${result.checked} program(s) evidence ≡ on-chain Authority`,
  ];
  if (result.standOnlyChecked > 0) {
    lines.push(
      `  stand-only mock_staking: OK (${result.standOnlyChecked})`,
    );
  }
  lines.push(`  ${formatSvmCommercialCensusSummary(evidence)}`);
  return lines;
}
