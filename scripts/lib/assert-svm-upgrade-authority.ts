/**
 * Sole owner: evidence `programs.*.upgradeAuthority` ≡ on-chain ProgramData
 * Authority for every live SVM commercial program (I4).
 *
 * Does not upgrade, hand off, or rewrite evidence. Abandoned prior program ids
 * are not asserted (they live under `abandonedPriorPrograms` only).
 */
import type { SvmDevnetEvidence } from "./load-deployment.js";

export type SvmAuthorityOk = { ok: true; checked: number };

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
 * Compare each live evidence program's recorded UA to chain.
 * Refuses missing per-program UA, fetch failure, and mismatch.
 * Refuses leftover `plannedFinalUpgradeAuthority` (not a live ops field).
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
      "Evidence still has plannedFinalUpgradeAuthority — remove; S4–S8 UA is deployer (env ≡ pubkey)",
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
  for (const [name, row] of entries) {
    const programId = row.programId?.trim();
    const recorded = row.upgradeAuthority?.trim();
    if (!programId) {
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
    checked += 1;
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, checked };
}

export function formatSvmAuthorityFailure(result: SvmAuthorityFail): string {
  return [
    "SVM upgrade-authority evidence mismatch — refuse (fix evidence or redeploy):",
    ...result.reasons.map((r) => `  - ${r}`),
  ].join("\n");
}
