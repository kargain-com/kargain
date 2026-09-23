/**
 * Commercial instruction wire — TS encoder vs committed Rust goldens.
 *
 * Append-only authority: published trunk tip this change is measured against
 * (CI push `before` / PR base; local `merge-base HEAD origin/master`) via
 * `lib/architecture/ix-append-only-baseline` — not `git show HEAD`.
 * Actions never uses merge-base (would be identity on master checkout).
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
  assertAppendOnlyVsPrior,
  loadManifestAtBaseline,
  resolveAppendOnlyBaseline,
  type AppendOnlyGitHubEvent,
} from "@/lib/architecture/ix-append-only-baseline";
import {
  bytesEqual,
  encodeDeclaredFieldForTests,
  encodeSvmInstruction,
  hexToBytes,
  ixManifestEntries,
  sampleFieldsFromManifest,
  type EncodeInstructionCause,
  type IxManifest,
} from "@/lib/svm/encode-instruction";
import {
  assertCleanProductScan,
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

function gitOk(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function commitExists(sha: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function readGitHubEvent(): AppendOnlyGitHubEvent | null {
  const p = process.env.GITHUB_EVENT_PATH;
  if (p == null || p.length === 0) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as AppendOnlyGitHubEvent;
  } catch {
    return null;
  }
}

function loadPublishedTrunkManifest(): IxManifest {
  const resolved = resolveAppendOnlyBaseline({
    eventName: process.env.GITHUB_EVENT_NAME,
    event: readGitHubEvent(),
    inActions: process.env.GITHUB_ACTIONS === "true",
    headSha: () => gitOk(["rev-parse", "HEAD"]),
    mergeBaseWithOriginMaster: () =>
      gitOk(["merge-base", "HEAD", "origin/master"]),
    commitExists,
  });
  if (!resolved.ok) {
    assert.fail(resolved.cause);
  }
  const loaded = loadManifestAtBaseline(
    resolved.commit,
    MANIFEST_REL,
    {
      commitExists,
      showPath: (commit, relPath) => gitOk(["show", `${commit}:${relPath}`]),
    },
    (text) => JSON.parse(text) as IxManifest,
  );
  if (!loaded.ok) {
    assert.fail(loaded.cause);
  }
  console.log(
    `svm-instruction-encoder: append-only baseline ${resolved.source}=${resolved.commit.slice(0, 12)}`,
  );
  return loaded.manifest;
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
  it("wire census entry count equals the acknowledged total (104)", () => {
    assert.equal(ENTRIES.length, 104);
    const working = loadWorkingManifest();
    assert.equal(working.entries.length, 104);
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

  it("append-only vs published trunk: existing (program,index) names stable; only append after max", () => {
    const prior = loadPublishedTrunkManifest();
    const working = loadWorkingManifest();
    assertAppendOnlyVsPrior(prior, working);
  });

  it("append-only: in-memory removal of one entry is red; intact copy is green", () => {
    const prior = loadWorkingManifest();
    assert.ok(prior.entries.length > 0, "manifest must have entries");
    // Green: identical prior/working.
    assertAppendOnlyVsPrior(prior, {
      version: prior.version,
      entries: prior.entries.map((e) => ({ ...e })),
    });
    // Red: drop one entry (in-memory only — no file plant).
    const removed = prior.entries[prior.entries.length - 1]!;
    const dirty: IxManifest = {
      version: prior.version,
      entries: prior.entries.slice(0, -1).map((e) => ({ ...e })),
    };
    assert.throws(
      () => assertAppendOnlyVsPrior(prior, dirty),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        return msg.includes(
          `append_only_removed:${removed.program}:${removed.index}:${removed.name}`,
        );
      },
    );
  });

  it("product graph has no hand-rolled ix tag outside the encoder", () => {
    const scan = scanProductSources(
      handRolledIxPredicate as ProductSourcePredicate,
      { owners: [ENCODER_REL] },
    );
    assertCleanProductScan(scan, { owners: [ENCODER_REL] });
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
