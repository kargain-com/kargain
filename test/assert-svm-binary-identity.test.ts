/**
 * Binary-identity gate: leading ELF digest + empty padding; named absences.
 * Three negative controls shown RED (refusal text) before green happy path.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { SvmDevnetEvidence } from "../lib/svm/devnet-evidence.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";
import {
  assertSvmBinaryIdentity,
  compareProgramDataElfToArtifact,
  formatSvmBinaryIdentityFailure,
  PROGRAMDATA_HEADER_WITH_AUTHORITY,
  programDataAddressFromProgramAccount,
  sliceElfFromProgramDataAccount,
} from "../scripts/lib/assert-svm-binary-identity.ts";
import { encodeSvmPubkeyBytes } from "../lib/web3/protocol-address.ts";

function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function programDataAccount(elf: Uint8Array): Uint8Array {
  const header = new Uint8Array(PROGRAMDATA_HEADER_WITH_AUTHORITY);
  header[0] = 3; // ProgramData discriminator (LE u32)
  header[12] = 1; // Option::Some
  const out = new Uint8Array(header.byteLength + elf.byteLength);
  out.set(header, 0);
  out.set(elf, header.byteLength);
  return out;
}

function programAccount(programDataPubkey: Uint8Array): Uint8Array {
  const out = new Uint8Array(36);
  out[0] = 2; // Program discriminator
  out.set(programDataPubkey, 4);
  return out;
}

const ARTIFACT = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4, 5, 6]);
const ARTIFACT_DIGEST = sha256Hex(ARTIFACT);
/** Valid hex git head (≤40 chars) — matches evidence-write GIT_HEAD_HEX. */
const SOURCE = "70b60985dccabcdef0123456789abcdef0123456";

function fullEvidence(
  overrides: Partial<SvmDevnetEvidence["programs"]> = {},
): SvmDevnetEvidence {
  const row = (programId: string) => ({
    programId,
    deploySlot: 100,
    soSha256: ARTIFACT_DIGEST,
    soBytes: ARTIFACT.byteLength,
    sourceGitHead: SOURCE,
  });
  return {
    cluster: "solana-devnet",
    eid: 40168,
    namespace: 2000040168,
    programs: {
      kar_passport: row(FIXTURE_SVM_STACK.karPassport),
      kar_gateway: row(FIXTURE_SVM_STACK.bridgeGateway),
      kar_pro_staking: row(FIXTURE_SVM_STACK.karProStaking),
      kar_pro_pass: row(FIXTURE_SVM_STACK.karProPass),
      kar_fixed_price: row(FIXTURE_SVM_STACK.fixedPriceConsignment),
      kar_ascending: row(FIXTURE_SVM_STACK.ascendingConsignment),
      ...overrides,
    },
  };
}

describe("compareProgramDataElfToArtifact", () => {
  it("NEGATIVE foreign bytecode vs our digest → digest_mismatch (RED text)", () => {
    const foreign = new Uint8Array(ARTIFACT.byteLength);
    foreign.fill(0xaa);
    const padding = new Uint8Array(8);
    const elf = new Uint8Array(foreign.byteLength + padding.byteLength);
    elf.set(foreign, 0);
    const result = compareProgramDataElfToArtifact({
      elfRegion: elf,
      soSha256: ARTIFACT_DIGEST,
      soBytes: ARTIFACT.byteLength,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.cause, "digest_mismatch");
    assert.match(result.message, /leading digest mismatch/);
    assert.match(result.message, new RegExp(ARTIFACT_DIGEST));
    assert.match(result.message, /measured sha256/);
    assert.notEqual(result.measuredSha256, ARTIFACT_DIGEST);
  });

  it("NEGATIVE difference past artifact length in padding → padding_nonempty (RED text)", () => {
    const padding = new Uint8Array(16);
    padding[4] = 0x42;
    const elf = new Uint8Array(ARTIFACT.byteLength + padding.byteLength);
    elf.set(ARTIFACT, 0);
    elf.set(padding, ARTIFACT.byteLength);
    const result = compareProgramDataElfToArtifact({
      elfRegion: elf,
      soSha256: ARTIFACT_DIGEST,
      soBytes: ARTIFACT.byteLength,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.cause, "padding_nonempty");
    assert.match(result.message, /padding region non-empty/);
    assert.match(result.message, /offset 14/); // soBytes(10) + 4
    assert.equal(result.firstNonZeroPaddingOffset, ARTIFACT.byteLength + 4);
    // Truncation-only would have accepted — leading digest matches.
    assert.equal(result.measuredSha256, ARTIFACT_DIGEST);
  });

  it("green: leading digest matches and padding is empty", () => {
    const padding = new Uint8Array(24);
    const elf = new Uint8Array(ARTIFACT.byteLength + padding.byteLength);
    elf.set(ARTIFACT, 0);
    const result = compareProgramDataElfToArtifact({
      elfRegion: elf,
      soSha256: ARTIFACT_DIGEST,
      soBytes: ARTIFACT.byteLength,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.measuredSha256, ARTIFACT_DIGEST);
    assert.equal(result.paddingBytes, 24);
  });
});

describe("ProgramData / Program account slicing", () => {
  it("slices ELF after 45-byte header when authority Option is Some", () => {
    const account = programDataAccount(ARTIFACT);
    const sliced = sliceElfFromProgramDataAccount(account);
    assert.equal(sliced.ok, true);
    if (!sliced.ok) return;
    assert.equal(sliced.headerBytes, 45);
    assert.deepEqual(Buffer.from(sliced.elfRegion), Buffer.from(ARTIFACT));
  });

  it("reads ProgramData address from Program account", () => {
    const pd = new Uint8Array(32);
    pd[0] = 9;
    pd[31] = 7;
    const acct = programAccount(pd);
    const parsed = programDataAddressFromProgramAccount(acct);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.programDataAddress, encodeSvmPubkeyBytes(pd));
  });
});

describe("assertSvmBinaryIdentity", () => {
  it("NEGATIVE commercial program with no digest → missing_digest_and_source (RED text)", async () => {
    const evidence = fullEvidence({
      kar_fixed_price: {
        programId: FIXTURE_SVM_STACK.fixedPriceConsignment,
        deploySlot: 104,
      },
      kar_ascending: {
        programId: FIXTURE_SVM_STACK.ascendingConsignment,
        deploySlot: 105,
      },
    });
    const result = await assertSvmBinaryIdentity({
      stack: FIXTURE_SVM_STACK,
      evidence,
      fetchProgramDataElf: async () => {
        const padding = new Uint8Array(8);
        const elf = new Uint8Array(ARTIFACT.byteLength + padding.byteLength);
        elf.set(ARTIFACT, 0);
        return elf;
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.compared, 4);
    const modes = result.reasons.filter(
      (r) => r.cause === "missing_digest_and_source",
    );
    assert.ok(modes.length >= 2);
    const text = formatSvmBinaryIdentityFailure(result);
    assert.match(text, /kar_fixed_price/);
    assert.match(text, /neither soSha256 nor sourceGitHead/);
    assert.match(text, /\[missing_digest_and_source\]/);
  });

  it("digest without sourceGitHead refuses by name", async () => {
    const evidence = fullEvidence({
      kar_passport: {
        programId: FIXTURE_SVM_STACK.karPassport,
        deploySlot: 102,
        soSha256: ARTIFACT_DIGEST,
        soBytes: ARTIFACT.byteLength,
      },
    });
    const result = await assertSvmBinaryIdentity({
      stack: FIXTURE_SVM_STACK,
      evidence,
      fetchProgramDataElf: async () => ARTIFACT,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    const hit = result.reasons.find(
      (r) =>
        r.evidenceKey === "kar_passport" &&
        r.cause === "missing_source_git_head",
    );
    assert.ok(hit);
    assert.match(hit!.message, /no valid sourceGitHead/);
    assert.match(hit!.message, new RegExp(ARTIFACT_DIGEST));
  });

  it("green over six programs with digests; compared count is not empty", async () => {
    const evidence = fullEvidence();
    let fetchCount = 0;
    const result = await assertSvmBinaryIdentity({
      stack: FIXTURE_SVM_STACK,
      evidence,
      fetchProgramDataElf: async () => {
        fetchCount += 1;
        const padding = new Uint8Array(12);
        const elf = new Uint8Array(ARTIFACT.byteLength + padding.byteLength);
        elf.set(ARTIFACT, 0);
        return elf;
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.compared, 6);
    assert.equal(fetchCount, 6);
    assert.equal(result.programs.length, 6);
  });

  it("empty compared set refuses even if reasons empty-shaped path is forced", async () => {
    // All six missing digest → compared stays 0; overall refuse.
    const bare = (programId: string, slot: number) => ({
      programId,
      deploySlot: slot,
    });
    const evidence: SvmDevnetEvidence = {
      cluster: "solana-devnet",
      eid: 40168,
      programs: {
        kar_passport: bare(FIXTURE_SVM_STACK.karPassport, 102),
        kar_gateway: bare(FIXTURE_SVM_STACK.bridgeGateway, 103),
        kar_pro_staking: bare(FIXTURE_SVM_STACK.karProStaking, 100),
        kar_pro_pass: bare(FIXTURE_SVM_STACK.karProPass, 101),
        kar_fixed_price: bare(FIXTURE_SVM_STACK.fixedPriceConsignment, 104),
        kar_ascending: bare(FIXTURE_SVM_STACK.ascendingConsignment, 105),
      },
    };
    const result = await assertSvmBinaryIdentity({
      stack: FIXTURE_SVM_STACK,
      evidence,
      fetchProgramDataElf: async () => {
        throw new Error("must not fetch when digests absent");
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.compared, 0);
    assert.ok(result.reasons.length >= 6);
  });
});
