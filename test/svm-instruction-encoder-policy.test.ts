/**
 * Commercial instruction wire — TS encoder vs committed Rust goldens.
 *
 * Limit (append-only): compares the working manifest to `git show HEAD:<path>`
 * only. Protects each commit against the previous one; not a full history audit.
 *
 * Goldens are authored solely by Rust BorshSerialize (`kargain-ix-wire`).
 * This suite never repairs or regenerates them.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  bytesEqual,
  encodeDeclaredFieldForTests,
  encodeSvmInstruction,
  hexToBytes,
  ixManifestEntries,
  sampleFieldsFromManifest,
  type EncodeInstructionCause,
  type IxManifest,
  type IxManifestEntry,
} from "@/lib/svm/encode-instruction";
import {
  scanProductSources,
  type ProductSourcePredicate,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_REL = "svm/crates/kargain-ix-wire/ix.manifest.json";
const ENCODER_REL = "lib/svm/encode-instruction.ts";

const ENTRIES = ixManifestEntries();

function loadWorkingManifest(): IxManifest {
  return JSON.parse(readFileSync(path.join(ROOT, MANIFEST_REL), "utf8")) as IxManifest;
}

function loadHeadManifest(): IxManifest | null {
  try {
    const text = execFileSync(
      "git",
      ["show", `HEAD:${MANIFEST_REL}`],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(text) as IxManifest;
  } catch {
    // First introduction: no prior committed path.
    return null;
  }
}

function entryKey(e: Pick<IxManifestEntry, "program" | "index">): string {
  return `${e.program}:${e.index}`;
}

/** Hand-rolled commercial ix tag / second encoder outside the sole owner. */
export function handRolledIxPredicate(
  relPath: string,
  source: string,
): string | false {
  if (relPath === ENCODER_REL) return false;
  if (
    /\bexport\s+(?:async\s+)?function\s+encodeSvmInstruction\b/.test(source) ||
    /\bexport\s+const\s+encodeSvmInstruction\b/.test(source)
  ) {
    return `second commercial ix encoder (${relPath})`;
  }
  const mentionsCommercialIx =
    /\b(?:PassportIx|GatewayIx|StakingIx|PassIx|FixedPriceIx|AscendingIx)\b/.test(
      source,
    ) ||
    /\bkar-(?:passport|gateway|fixed-price|ascending|pro-staking|pro-pass)\b/.test(
      source,
    );
  const handTag =
    /Uint8Array\.of\(\s*\d+\s*\)/.test(source) ||
    /new Uint8Array\(\[\s*\d+\s*\]\)/.test(source) ||
    /Buffer\.from\(\[\s*\d+\s*\]\)/.test(source);
  if (mentionsCommercialIx && handTag) {
    return `hand-rolled instruction tag outside encode-instruction (${relPath})`;
  }
  return false;
}

describe("svm instruction encoder policy", () => {
  // Equality pin on the wire census (not a floor): appending a variant is
  // expected to turn this red until a human acknowledges the new wire entry.
  it("wire census entry count equals the acknowledged total (98)", () => {
    assert.equal(ENTRIES.length, 98);
    const working = loadWorkingManifest();
    assert.equal(working.entries.length, 98);
  });

  // Per-entry presence of goldenHex + sample, and unique (program,name,index).
  // Manifest↔Rust-source identity is owned by assert_committed_matches_regen
  // (pnpm test:svm / cargo); CI has no Rust toolchain, so that direction must
  // not be re-invented here as a second walk over the same committed objects.
  it("every manifest entry has goldenHex, sample, and a unique key", () => {
    const working = loadWorkingManifest();
    const seenKeys = new Set<string>();
    for (const e of working.entries) {
      assert.ok(
        typeof e.goldenHex === "string" && e.goldenHex.length > 0,
        `missing_golden:${e.program}:${e.name}`,
      );
      assert.ok(
        e.sample && typeof e.sample === "object",
        `missing_sample:${e.program}:${e.name}`,
      );
      const key = `${e.program}:${e.name}:${e.index}`;
      assert.equal(seenKeys.has(key), false, `duplicate_golden_key:${key}`);
      seenKeys.add(key);
    }
    assert.equal(seenKeys.size, working.entries.length);
  });

  it("per-program variant indices are dense from 0 with no gaps or duplicates", () => {
    const byProgram = new Map<string, number[]>();
    for (const e of ENTRIES) {
      const list = byProgram.get(e.program) ?? [];
      list.push(e.index);
      byProgram.set(e.program, list);
    }
    for (const [program, indices] of byProgram) {
      const sorted = [...indices].sort((a, b) => a - b);
      assert.deepEqual(
        sorted,
        [...indices].sort((a, b) => a - b),
      );
      const unique = new Set(sorted);
      assert.equal(
        unique.size,
        sorted.length,
        `duplicate_index:${program}`,
      );
      for (let i = 0; i < sorted.length; i++) {
        assert.equal(sorted[i], i, `index_gap:${program}:want_${i}_got_${sorted[i]}`);
      }
    }
  });

  it("TS encoder reproduces every committed golden byte-for-byte", () => {
    let comparisons = 0;
    for (const e of ENTRIES) {
      const fields = sampleFieldsFromManifest(e.sample);
      const result = encodeSvmInstruction({
        program: e.program,
        variant: e.name,
        fields,
      });
      assert.equal(
        result.ok,
        true,
        `encode_failed:${e.program}:${e.name}:${result.ok === false ? result.detail : ""}`,
      );
      if (!result.ok) continue;
      const golden = hexToBytes(e.goldenHex);
      assert.ok(
        bytesEqual(result.data, golden),
        `golden_mismatch:${e.program}:${e.name}`,
      );
      comparisons += 1;
    }
    assert.equal(comparisons, ENTRIES.length);
    // Visible count for acceptance reports.
    console.log(
      `svm-instruction-encoder: ${comparisons} byte comparisons over ${ENTRIES.length} goldens`,
    );
  });

  it("append-only vs HEAD: existing (program,index) names stable; only append after max", () => {
    const prior = loadHeadManifest();
    if (prior == null) {
      console.log(
        "svm-instruction-encoder: append-only baseline empty (manifest new on this commit)",
      );
      return;
    }
    const working = loadWorkingManifest();
    const workingByKey = new Map(
      working.entries.map((e) => [entryKey(e), e] as const),
    );
    const priorMax = new Map<string, number>();
    for (const e of prior.entries) {
      const prev = priorMax.get(e.program) ?? -1;
      if (e.index > prev) priorMax.set(e.program, e.index);
      const cur = workingByKey.get(entryKey(e));
      assert.ok(
        cur,
        `append_only_removed:${e.program}:${e.index}:${e.name}`,
      );
      assert.equal(
        cur!.name,
        e.name,
        `append_only_renamed:${e.program}:${e.index}:was_${e.name}_now_${cur!.name}`,
      );
    }
    for (const e of working.entries) {
      const max = priorMax.get(e.program);
      if (max == null) continue;
      const priorHad = prior.entries.some(
        (p) => p.program === e.program && p.index === e.index,
      );
      if (!priorHad) {
        assert.ok(
          e.index === max + 1 || e.index > max,
          `append_only_gap_insert:${e.program}:${e.index}:prior_max_${max}`,
        );
        // Strict append: new indices must be exactly contiguous after prior max.
        // Allow a contiguous run starting at max+1.
      }
    }
    // New indices for a program must form {max+1, max+2, ...} with no holes below.
    for (const [program, max] of priorMax) {
      const newIndices = working.entries
        .filter((e) => e.program === program && e.index > max)
        .map((e) => e.index)
        .sort((a, b) => a - b);
      for (let i = 0; i < newIndices.length; i++) {
        assert.equal(
          newIndices[i],
          max + 1 + i,
          `append_only_non_contiguous:${program}:want_${max + 1 + i}_got_${newIndices[i]}`,
        );
      }
    }
  });

  it("product graph has no hand-rolled ix tag outside the encoder", () => {
    const violations = scanProductSources(
      handRolledIxPredicate as ProductSourcePredicate,
      { owners: [ENCODER_REL] },
    );
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("catches a planted hand-rolled ix tag (red→green)", () => {
    const dirty = `
      // PassportIx tag
      const data = Buffer.from([0]);
    `;
    assert.equal(
      handRolledIxPredicate("lib/planted-ix.ts", dirty),
      "hand-rolled instruction tag outside encode-instruction (lib/planted-ix.ts)",
    );
    const clean = `export function helper() { return 1; }\n`;
    assert.equal(handRolledIxPredicate("lib/planted-ix.ts", clean), false);
  });

  it("refuses by name for each encoder cause class", () => {
    const causes = new Set<EncodeInstructionCause>();

    const unknownProgram = encodeSvmInstruction({
      program: "not-a-program",
      variant: "Initialize",
      fields: {},
    });
    assert.equal(unknownProgram.ok, false);
    if (!unknownProgram.ok) causes.add(unknownProgram.cause);

    const unknownVariant = encodeSvmInstruction({
      program: "kar-passport",
      variant: "NotAVariant",
      fields: {},
    });
    assert.equal(unknownVariant.ok, false);
    if (!unknownVariant.ok) causes.add(unknownVariant.cause);

    const mint = ENTRIES.find(
      (e) => e.program === "kar-passport" && e.name === "MintPassport",
    )!;
    const missing = encodeSvmInstruction({
      program: mint.program,
      variant: mint.name,
      fields: {},
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) causes.add(missing.cause);

    const unexpected = encodeSvmInstruction({
      program: mint.program,
      variant: mint.name,
      fields: { uri: "ar://x", extra: 1 },
    });
    assert.equal(unexpected.ok, false);
    if (!unexpected.ok) causes.add(unexpected.cause);

    const outOfRange = encodeSvmInstruction({
      program: mint.program,
      variant: mint.name,
      fields: { uri: 99 as unknown as string },
    });
    assert.equal(outOfRange.ok, false);
    if (!outOfRange.ok) causes.add(outOfRange.cause);

    // unsupported_type: plant via encodeField path using a forged decl is internal;
    // exercise by calling encode on a synthetic path — use fixed_bytes wrong length.
    const init = ENTRIES.find(
      (e) => e.program === "kar-passport" && e.name === "SetBridgeGateway",
    )!;
    const badLen = encodeSvmInstruction({
      program: init.program,
      variant: init.name,
      fields: { gateway: "aa" },
    });
    assert.equal(badLen.ok, false);
    if (!badLen.ok) {
      assert.equal(badLen.cause, "value_out_of_range");
      causes.add(badLen.cause);
    }

    assert.ok(causes.has("unknown_program"));
    assert.ok(causes.has("unknown_variant"));
    assert.ok(causes.has("missing_field"));
    assert.ok(causes.has("unexpected_field"));
    assert.ok(causes.has("value_out_of_range"));

    const unsupported = encodeDeclaredFieldForTests(
      { name: "x", type: "not_a_wire_type" },
      0,
    );
    assert.equal(unsupported.ok, false);
    if (!unsupported.ok) {
      assert.equal(unsupported.cause, "unsupported_type");
      causes.add(unsupported.cause);
    }
    assert.ok(causes.has("unsupported_type"));
    assert.equal(causes.size, 6);
  });
});
