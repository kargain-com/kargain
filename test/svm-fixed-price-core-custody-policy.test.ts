/**
 * S8-E step 5 — FixedPrice must not reference the retired harness custody path.
 *
 * Banned symbols in kar-fixed-price sources (retired with Core migration):
 * HarnessAsset, load_asset, take_custody, release_custody, is_escrow_approved,
 * self_encumbrance_registered, read_may_open, write_may_open.
 *
 * SetMayOpen / set_may_open remain as refuse stubs (enum index preserved).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FP_SRC = path.join(ROOT, "svm/programs/kar-fixed-price/src");

const BANNED = [
  "HarnessAsset",
  "load_asset",
  "take_custody",
  "release_custody",
  "is_escrow_approved",
  "self_encumbrance_registered",
  "read_may_open",
  "write_may_open",
] as const;

function walkRs(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkRs(p));
    else if (ent.name.endsWith(".rs")) out.push(p);
  }
  return out;
}

function findBanned(src: string): string[] {
  return BANNED.filter((sym) => {
    if (sym === "load_asset") {
      // refuse stub must not be named load_asset; allow unrelated words
      return /\bload_asset\b/.test(src);
    }
    if (sym === "take_custody" || sym === "release_custody") {
      return new RegExp(`\\b${sym}\\b`).test(src);
    }
    return src.includes(sym);
  });
}

describe("svm-fixed-price-core-custody-policy", () => {
  it("live FixedPrice sources contain none of the banned harness symbols", () => {
    const files = walkRs(FP_SRC);
    assert.ok(files.length > 0, "expected FixedPrice rust sources");
    const hits: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const sym of findBanned(src)) {
        hits.push(`${path.relative(ROOT, f)}:${sym}`);
      }
    }
    assert.equal(hits.join("\n"), "", `banned harness symbols:\n${hits.join("\n")}`);
  });

  it("plant: in-memory dirty fixture is red then green (never writes scanned roots)", () => {
    const dirty = [
      "fn take_custody() {}",
      "use HarnessAsset;",
      "cfg.self_encumbrance_registered",
      "read_may_open(asset)",
    ].join("\n");
    const red = findBanned(dirty);
    assert.ok(red.includes("take_custody"));
    assert.ok(red.includes("HarnessAsset"));
    assert.ok(red.includes("self_encumbrance_registered"));
    assert.ok(red.includes("read_may_open"));

    const clean = [
      "fn transfer_owner_to_custody() {}",
      "require_bound_passport_program",
      "HarnessInstructionRetired",
      "set_may_open", // refuse stub name — not banned
    ].join("\n");
    assert.deepEqual(findBanned(clean), []);
  });

  it("FixedPrice consumes Core movers and BindPassportProgram", () => {
    const ix = fs.readFileSync(path.join(FP_SRC, "ix.rs"), "utf8");
    assert.ok(ix.includes("BindPassportProgram"));
    assert.ok(ix.includes("transfer_owner_to_custody"));
    assert.ok(ix.includes("transfer_delegate_to_custody"));
    assert.ok(ix.includes("transfer_custody_to_recipient"));
    assert.ok(ix.includes("resolve_may_accounts"));
    assert.ok(ix.includes("encumbrance_seed_prefix_for_source"));
    assert.ok(ix.includes("HarnessInstructionRetired"));
  });
});
