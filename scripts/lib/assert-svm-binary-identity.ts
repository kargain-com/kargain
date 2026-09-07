/**
 * Sole owner: evidence `programs.*.soSha256` ≡ on-chain ProgramData ELF leading
 * bytes, with the remainder proven empty padding. Sibling of upgrade-authority
 * assert — does not measure Authority.
 *
 * Program ids come from the commercial registry census; digests/source/soBytes
 * from deploy evidence. Absence is a named refusal (modes today).
 */
import { createHash } from "node:crypto";

import {
  SVM_COMMERCIAL_PROGRAM_CENSUS,
  type CommercialProgramEvidenceKey,
} from "../../lib/svm/ingest-config.js";
import type { SvmDevnetEvidence } from "../../lib/svm/devnet-evidence.js";
import type { SvmCommercialActiveStack } from "../../lib/web3/commercial-active.js";
import { encodeSvmPubkeyBytes } from "../../lib/web3/protocol-address.js";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const GIT_HEAD_HEX = /^[a-f0-9]{7,40}$/;

/** ProgramData metadata size when upgrade authority Option is Some (loader-v3). */
export const PROGRAMDATA_HEADER_WITH_AUTHORITY = 45;
/** ProgramData metadata size when upgrade authority Option is None. */
export const PROGRAMDATA_HEADER_NO_AUTHORITY = 13;
/** Upgradeable Program account: u32 discriminator + 32-byte ProgramData address. */
export const PROGRAM_ACCOUNT_LEN = 36;
const PROGRAM_STATE_DISCRIMINATOR = 2;
const PROGRAMDATA_STATE_DISCRIMINATOR = 3;

export type ElfCompareOk = {
  ok: true;
  measuredSha256: string;
  soBytes: number;
  paddingBytes: number;
};

export type ElfCompareFailCause =
  | "digest_mismatch"
  | "padding_nonempty"
  | "elf_shorter_than_artifact";

export type ElfCompareFail = {
  ok: false;
  cause: ElfCompareFailCause;
  message: string;
  expectedSha256?: string;
  measuredSha256?: string;
  soBytes: number;
  elfRegionBytes: number;
  firstNonZeroPaddingOffset?: number;
};

export type ElfCompareResult = ElfCompareOk | ElfCompareFail;

/**
 * Compare ProgramData ELF region to evidence artifact length + digest.
 * Leading `soBytes` must hash to `soSha256`; bytes past that must be 0x00.
 */
export function compareProgramDataElfToArtifact(args: {
  elfRegion: Uint8Array;
  soSha256: string;
  soBytes: number;
}): ElfCompareResult {
  const { elfRegion, soSha256, soBytes } = args;
  if (!Number.isInteger(soBytes) || soBytes <= 0) {
    throw new Error(
      `compareProgramDataElfToArtifact: soBytes must be a positive integer (got ${soBytes})`,
    );
  }
  if (!SHA256_HEX.test(soSha256)) {
    throw new Error(
      `compareProgramDataElfToArtifact: soSha256 must be 64 lowercase hex (got ${JSON.stringify(soSha256)})`,
    );
  }
  if (elfRegion.byteLength < soBytes) {
    return {
      ok: false,
      cause: "elf_shorter_than_artifact",
      message:
        `ELF region (${elfRegion.byteLength} B) shorter than artifact soBytes=${soBytes} — ` +
        `cannot prove leading digest`,
      expectedSha256: soSha256,
      soBytes,
      elfRegionBytes: elfRegion.byteLength,
    };
  }
  const leading = elfRegion.subarray(0, soBytes);
  const measuredSha256 = createHash("sha256").update(leading).digest("hex");
  if (measuredSha256 !== soSha256) {
    return {
      ok: false,
      cause: "digest_mismatch",
      message:
        `leading digest mismatch: evidence soSha256=${soSha256} ≠ ` +
        `measured sha256(elf[0..${soBytes}))=${measuredSha256}`,
      expectedSha256: soSha256,
      measuredSha256,
      soBytes,
      elfRegionBytes: elfRegion.byteLength,
    };
  }
  for (let i = soBytes; i < elfRegion.byteLength; i++) {
    if (elfRegion[i] !== 0) {
      return {
        ok: false,
        cause: "padding_nonempty",
        message:
          `padding region non-empty at offset ${i} ` +
          `(artifact soBytes=${soBytes}, elfRegion=${elfRegion.byteLength} B, ` +
          `byte=0x${elfRegion[i]!.toString(16).padStart(2, "0")}) — ` +
          `leading digest matched ${soSha256}`,
        expectedSha256: soSha256,
        measuredSha256,
        soBytes,
        elfRegionBytes: elfRegion.byteLength,
        firstNonZeroPaddingOffset: i,
      };
    }
  }
  return {
    ok: true,
    measuredSha256,
    soBytes,
    paddingBytes: elfRegion.byteLength - soBytes,
  };
}

/**
 * Slice ELF bytes from a ProgramData account data buffer.
 * Authority Option tag at offset 12: 1 → header 45, 0 → header 13; else refuse.
 */
export function sliceElfFromProgramDataAccount(data: Uint8Array):
  | { ok: true; elfRegion: Uint8Array; headerBytes: number }
  | { ok: false; message: string } {
  if (data.byteLength < PROGRAMDATA_HEADER_NO_AUTHORITY) {
    return {
      ok: false,
      message: `ProgramData account too short (${data.byteLength} B)`,
    };
  }
  const disc = data[0]! | (data[1]! << 8) | (data[2]! << 16) | (data[3]! << 24);
  if (disc !== PROGRAMDATA_STATE_DISCRIMINATOR) {
    return {
      ok: false,
      message: `ProgramData discriminator ${disc} ≠ ${PROGRAMDATA_STATE_DISCRIMINATOR}`,
    };
  }
  const authorityTag = data[12];
  if (authorityTag !== 0 && authorityTag !== 1) {
    return {
      ok: false,
      message: `ProgramData authority Option tag ${authorityTag} is neither 0 nor 1`,
    };
  }
  const headerBytes =
    authorityTag === 1
      ? PROGRAMDATA_HEADER_WITH_AUTHORITY
      : PROGRAMDATA_HEADER_NO_AUTHORITY;
  if (data.byteLength < headerBytes) {
    return {
      ok: false,
      message: `ProgramData account shorter than header (${data.byteLength} < ${headerBytes})`,
    };
  }
  return {
    ok: true,
    elfRegion: data.subarray(headerBytes),
    headerBytes,
  };
}

/**
 * Read ProgramData address from an upgradeable Program account (36 bytes).
 */
export function programDataAddressFromProgramAccount(
  data: Uint8Array,
): { ok: true; programDataAddress: string } | { ok: false; message: string } {
  if (data.byteLength < PROGRAM_ACCOUNT_LEN) {
    return {
      ok: false,
      message: `Program account too short (${data.byteLength} B, need ${PROGRAM_ACCOUNT_LEN})`,
    };
  }
  const disc = data[0]! | (data[1]! << 8) | (data[2]! << 16) | (data[3]! << 24);
  if (disc !== PROGRAM_STATE_DISCRIMINATOR) {
    return {
      ok: false,
      message: `Program discriminator ${disc} ≠ ${PROGRAM_STATE_DISCRIMINATOR}`,
    };
  }
  const pubkeyBytes = data.subarray(4, 36);
  try {
    return {
      ok: true,
      programDataAddress: encodeSvmPubkeyBytes(pubkeyBytes),
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type FetchProgramDataElf = (
  programId: string,
) => Promise<Uint8Array>;

export type SvmBinaryIdentityProgramOk = {
  evidenceKey: CommercialProgramEvidenceKey;
  programId: string;
  ok: true;
  soSha256: string;
  measuredSha256: string;
  soBytes: number;
  paddingBytes: number;
  sourceGitHead: string;
};

export type SvmBinaryIdentityProgramFail = {
  evidenceKey: CommercialProgramEvidenceKey;
  programId: string;
  ok: false;
  cause:
    | "missing_digest_and_source"
    | "missing_source_git_head"
    | "missing_so_bytes"
    | "invalid_so_sha256"
    | "program_id_mismatch"
    | "fetch_failed"
    | ElfCompareFailCause;
  message: string;
};

export type SvmBinaryIdentityOk = {
  ok: true;
  /** Programs whose leading ELF was hashed against evidence digests. */
  compared: number;
  programs: SvmBinaryIdentityProgramOk[];
};

export type SvmBinaryIdentityFail = {
  ok: false;
  compared: number;
  reasons: SvmBinaryIdentityProgramFail[];
};

export type SvmBinaryIdentityResult =
  | SvmBinaryIdentityOk
  | SvmBinaryIdentityFail;

function stackProgramId(
  stack: SvmCommercialActiveStack,
  field: (typeof SVM_COMMERCIAL_PROGRAM_CENSUS)[number]["stackField"],
): string | undefined {
  const value = stack[field];
  return typeof value === "string" ? value.trim() : undefined;
}

function hasDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function hasSource(value: unknown): value is string {
  return typeof value === "string" && GIT_HEAD_HEX.test(value);
}

/**
 * Prove evidence digests against on-chain ProgramData ELF for every commercial
 * census program. Empty compared set refuses even if no other reasons.
 */
export async function assertSvmBinaryIdentity(args: {
  stack: SvmCommercialActiveStack;
  evidence: SvmDevnetEvidence;
  fetchProgramDataElf: FetchProgramDataElf;
}): Promise<SvmBinaryIdentityResult> {
  const { stack, evidence, fetchProgramDataElf } = args;
  const reasons: SvmBinaryIdentityProgramFail[] = [];
  const successes: SvmBinaryIdentityProgramOk[] = [];
  let compared = 0;

  const programs = evidence.programs;
  if (!programs || typeof programs !== "object") {
    return {
      ok: false,
      compared: 0,
      reasons: [
        {
          evidenceKey: "kar_passport",
          programId: "(absent)",
          ok: false,
          cause: "missing_digest_and_source",
          message: "Evidence missing programs object",
        },
      ],
    };
  }

  for (const row of SVM_COMMERCIAL_PROGRAM_CENSUS) {
    const registryId = stackProgramId(stack, row.stackField);
    if (!registryId) {
      reasons.push({
        evidenceKey: row.evidenceKey,
        programId: "(absent)",
        ok: false,
        cause: "program_id_mismatch",
        message: `registry missing program id for ${row.evidenceKey}`,
      });
      continue;
    }

    const evRow = programs[row.evidenceKey];
    const evidenceId =
      evRow != null && typeof evRow === "object" && typeof evRow.programId === "string"
        ? evRow.programId.trim()
        : "";
    if (!evidenceId) {
      reasons.push({
        evidenceKey: row.evidenceKey,
        programId: registryId,
        ok: false,
        cause: "missing_digest_and_source",
        message:
          `programs.${row.evidenceKey} missing programId in evidence ` +
          `(registry=${registryId})`,
      });
      continue;
    }
    if (evidenceId !== registryId) {
      reasons.push({
        evidenceKey: row.evidenceKey,
        programId: registryId,
        ok: false,
        cause: "program_id_mismatch",
        message:
          `programs.${row.evidenceKey} programId mismatch: ` +
          `registry=${registryId} evidence=${evidenceId}`,
      });
      continue;
    }

    const digestRaw = evRow?.soSha256;
    const sourceRaw = evRow?.sourceGitHead;
    const digestPresent = typeof digestRaw === "string" && digestRaw.length > 0;
    const sourcePresent = typeof sourceRaw === "string" && sourceRaw.length > 0;

    if (!digestPresent && !sourcePresent) {
      reasons.push({
        evidenceKey: row.evidenceKey,
        programId: registryId,
        ok: false,
        cause: "missing_digest_and_source",
        message:
          `programs.${row.evidenceKey} (${registryId}): evidence carries neither ` +
          `soSha256 nor sourceGitHead — refuse (fill only via real deploy/rebuild)`,
      });
      continue;
    }

    if (digestPresent && !hasDigest(digestRaw)) {
      reasons.push({
        evidenceKey: row.evidenceKey,
        programId: registryId,
        ok: false,
        cause: "invalid_so_sha256",
        message:
          `programs.${row.evidenceKey} (${registryId}): soSha256 present but invalid ` +
          `(got ${JSON.stringify(digestRaw)})`,
      });
      continue;
    }

    if (digestPresent && !hasSource(sourceRaw)) {
      reasons.push({
        evidenceKey: row.evidenceKey,
        programId: registryId,
        ok: false,
        cause: "missing_source_git_head",
        message:
          `programs.${row.evidenceKey} (${registryId}): has soSha256=${digestRaw} ` +
          `but no valid sourceGitHead (got ${JSON.stringify(sourceRaw)})`,
      });
      continue;
    }

    if (!digestPresent && sourcePresent) {
      reasons.push({
        evidenceKey: row.evidenceKey,
        programId: registryId,
        ok: false,
        cause: "missing_digest_and_source",
        message:
          `programs.${row.evidenceKey} (${registryId}): has sourceGitHead=${sourceRaw} ` +
          `but no soSha256 — refuse`,
      });
      continue;
    }

    // digestPresent && hasSource — narrow for tsc after the guards above.
    if (!hasDigest(digestRaw) || !hasSource(sourceRaw)) {
      reasons.push({
        evidenceKey: row.evidenceKey,
        programId: registryId,
        ok: false,
        cause: "missing_digest_and_source",
        message:
          `programs.${row.evidenceKey} (${registryId}): unreachable digest/source state`,
      });
      continue;
    }
    const soSha256 = digestRaw;
    const sourceGitHead = sourceRaw;

    const soBytes = evRow?.soBytes;
    if (
      typeof soBytes !== "number" ||
      !Number.isInteger(soBytes) ||
      soBytes <= 0
    ) {
      reasons.push({
        evidenceKey: row.evidenceKey,
        programId: registryId,
        ok: false,
        cause: "missing_so_bytes",
        message:
          `programs.${row.evidenceKey} (${registryId}): has soSha256 but no positive soBytes ` +
          `(got ${JSON.stringify(soBytes)})`,
      });
      continue;
    }

    let elfRegion: Uint8Array;
    try {
      elfRegion = await fetchProgramDataElf(registryId);
    } catch (err) {
      reasons.push({
        evidenceKey: row.evidenceKey,
        programId: registryId,
        ok: false,
        cause: "fetch_failed",
        message:
          `programs.${row.evidenceKey} (${registryId}): fetch failed — ` +
          (err instanceof Error ? err.message : String(err)),
      });
      continue;
    }

    compared += 1;
    const cmp = compareProgramDataElfToArtifact({
      elfRegion,
      soSha256,
      soBytes,
    });
    if (!cmp.ok) {
      reasons.push({
        evidenceKey: row.evidenceKey,
        programId: registryId,
        ok: false,
        cause: cmp.cause,
        message: `programs.${row.evidenceKey} (${registryId}): ${cmp.message}`,
      });
      continue;
    }
    successes.push({
      evidenceKey: row.evidenceKey,
      programId: registryId,
      ok: true,
      soSha256,
      measuredSha256: cmp.measuredSha256,
      soBytes: cmp.soBytes,
      paddingBytes: cmp.paddingBytes,
      sourceGitHead,
    });
  }

  if (reasons.length > 0) {
    return { ok: false, compared, reasons };
  }
  if (compared === 0) {
    return {
      ok: false,
      compared: 0,
      reasons: [
        {
          evidenceKey: "kar_passport",
          programId: "(none)",
          ok: false,
          cause: "missing_digest_and_source",
          message:
            "binary-identity compared 0 programs — green over an empty set is not acceptance",
        },
      ],
    };
  }
  return { ok: true, compared, programs: successes };
}

export function formatSvmBinaryIdentityFailure(
  result: SvmBinaryIdentityFail,
): string {
  return [
    "SVM binary-identity refuse — evidence digest ≢ on-chain ProgramData ELF " +
      `(compared ${result.compared}):`,
    ...result.reasons.map((r) => `  - [${r.cause}] ${r.message}`),
  ].join("\n");
}

export function formatSvmBinaryIdentitySuccessLines(
  result: SvmBinaryIdentityOk,
): string[] {
  const lines = [
    `  OK ${result.compared} program(s) evidence soSha256 ≡ ProgramData leading ELF; padding empty`,
  ];
  for (const p of result.programs) {
    lines.push(
      `  - ${p.evidenceKey}: digest=${p.measuredSha256.slice(0, 8)}… ` +
        `soBytes=${p.soBytes} padding=${p.paddingBytes} source=${p.sourceGitHead.slice(0, 7)}`,
    );
  }
  return lines;
}
