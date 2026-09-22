/**
 * S8-E step 4 — Core custody helpers sole owner in kargain-consignment-base.
 *
 * - Binding / freeze / TransferDelegate / TransferV1 live in core_custody.rs
 * - Passport asset address + liveness: sole owner kargain-passport-asset
 * - Modes must not call TransferV1CpiBuilder directly (use core_custody movers)
 * - Passport keeps its own Core CPI door (no custody helper copy)
 * - Harness proves skip-freeze; FixedPrice (step 5) consumes the three movers; Ascending waits for step 6
 * - No public ungated TransferV1 in the shared crate (skip-freeze plant = harness only)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { searchUnder } from "./policy-content-search.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVM = path.join(ROOT, "svm");
const CORE_CUSTODY = path.join(
  SVM,
  "crates/kargain-consignment-base/src/core_custody.rs",
);
const PASSPORT_ASSET = path.join(SVM, "crates/kargain-passport-asset/src/lib.rs");
const PASSPORT_SEEDS = path.join(SVM, "programs/kar-passport/src/seeds.rs");
const PASSPORT_CORE = path.join(SVM, "programs/kar-passport/src/core_asset.rs");
const HARNESS_IX = path.join(SVM, "programs/consignment-harness/src/ix.rs");

/** Public fns in core_custody that reach TransferV1 must call require_not_frozen. */
function publicTransferBodiesMissingFreezeGate(src: string): string[] {
  const violations: string[] = [];
  const re = /pub fn (transfer_\w+)[\s\S]*?\{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1]!;
    const body = m[2]!;
    if (!/transfer_v1\s*\(|TransferV1CpiBuilder/.test(body)) continue;
    if (!body.includes("require_not_frozen")) {
      violations.push(name);
    }
  }
  return violations;
}

describe("svm-core-custody-policy", () => {
  it("sole owner exports binding, freeze gate, delegate read, and three TransferV1 moves", () => {
    const src = fs.readFileSync(CORE_CUSTODY, "utf8");
    assert.ok(src.includes("pub fn require_passport_core_asset"));
    assert.ok(src.includes("pub fn require_not_frozen"));
    assert.ok(src.includes("KargainError::AssetFrozen"));
    assert.ok(src.includes("pub fn require_transfer_delegate"));
    assert.ok(src.includes("pub fn transfer_owner_to_custody"));
    assert.ok(src.includes("pub fn transfer_delegate_to_custody"));
    assert.ok(src.includes("pub fn transfer_custody_to_recipient"));
    assert.ok(src.includes("TransferV1CpiBuilder"));
    assert.ok(
      !src.includes("transfer_owner_to_custody_skip_freeze_gate"),
      "skip-freeze must not live in the shared crate",
    );
  });

  it("every public TransferV1 path in consignment-base calls require_not_frozen", () => {
    const src = fs.readFileSync(CORE_CUSTODY, "utf8");
    assert.deepEqual(
      publicTransferBodiesMissingFreezeGate(src),
      [],
      "public TransferV1 without require_not_frozen",
    );
  });

  it("plant: public TransferV1 without freeze gate is red then green", () => {
    const live = fs.readFileSync(CORE_CUSTODY, "utf8");
    assert.deepEqual(publicTransferBodiesMissingFreezeGate(live), []);

    const plant = `${live}

pub fn transfer_owner_to_custody_skip_freeze_gate() {
    transfer_v1(asset, payer, owner, custody, core, system, None)
}
`;
    const tmp = path.join(os.tmpdir(), `core-custody-plant-${process.pid}.rs`);
    fs.writeFileSync(tmp, plant);
    try {
      const bad = publicTransferBodiesMissingFreezeGate(fs.readFileSync(tmp, "utf8"));
      assert.ok(
        bad.includes("transfer_owner_to_custody_skip_freeze_gate"),
        `expected plant red, got ${JSON.stringify(bad)}`,
      );
    } finally {
      fs.unlinkSync(tmp);
    }
    assert.deepEqual(
      publicTransferBodiesMissingFreezeGate(live),
      [],
      "live tree must stay green after plant",
    );
  });

  it("passport asset address law has one owner crate", () => {
    const leaf = fs.readFileSync(PASSPORT_ASSET, "utf8");
    assert.ok(leaf.includes('pub const ASSET_SEED: &[u8] = b"asset"'));
    assert.ok(leaf.includes("pub fn asset_pda"));
    assert.ok(leaf.includes("pub fn is_live_core_asset"));

    const seeds = fs.readFileSync(PASSPORT_SEEDS, "utf8");
    assert.ok(seeds.includes("kargain_passport_asset"));
    assert.ok(!seeds.includes('b"asset"'), "passport seeds must not restate seed bytes");

    const core = fs.readFileSync(PASSPORT_CORE, "utf8");
    assert.ok(core.includes("kargain_passport_asset::is_live_core_asset"));
    assert.ok(
      !/fn is_live_core_asset\s*\(/.test(core),
      "passport must not define is_live_core_asset body",
    );

    const custody = fs.readFileSync(CORE_CUSTODY, "utf8");
    assert.ok(custody.includes("kargain_passport_asset"));
    assert.ok(!custody.includes("must match"), "no comment-only sync");
    assert.ok(!/pub const PASSPORT_ASSET_SEED: &\[u8\] = b"asset"/.test(custody));
  });

  it("plant messages name AssetFrozen / NotTransferDelegate / NotLiveCoreAsset", () => {
    const src = fs.readFileSync(CORE_CUSTODY, "utf8");
    assert.ok(src.includes('"AssetFrozen"'));
    assert.ok(src.includes('"NotTransferDelegate"'));
    assert.ok(src.includes('"NotLiveCoreAsset"'));
  });

  it("modes do not call TransferV1CpiBuilder (consume shared movers only)", () => {
    for (const prog of ["kar-fixed-price", "kar-ascending"]) {
      const hit = searchUnder("TransferV1CpiBuilder", path.join(SVM, "programs", prog), [
        "*.rs",
      ]);
      assert.equal(hit.trim(), "", `${prog} must not CPI TransferV1 directly:\n${hit}`);
    }
  });

  it("FixedPrice and Ascending consume the three shared movers", () => {
    const fp = searchUnder(
      String.raw`transfer_owner_to_custody|transfer_delegate_to_custody|transfer_custody_to_recipient`,
      path.join(SVM, "programs/kar-fixed-price"),
      ["*.rs"],
    );
    assert.ok(fp.includes("transfer_owner_to_custody"), "FixedPrice must owner→custody");
    assert.ok(fp.includes("transfer_delegate_to_custody"), "FixedPrice must delegate→custody");
    assert.ok(fp.includes("transfer_custody_to_recipient"), "FixedPrice must custody→recipient");

    const asc = searchUnder(
      String.raw`transfer_owner_to_custody|transfer_delegate_to_custody|transfer_custody_to_recipient`,
      path.join(SVM, "programs/kar-ascending"),
      ["*.rs"],
    );
    assert.ok(asc.includes("transfer_owner_to_custody"), "Ascending must owner→custody");
    assert.ok(asc.includes("transfer_delegate_to_custody"), "Ascending must delegate→custody");
    assert.ok(asc.includes("transfer_custody_to_recipient"), "Ascending must custody→recipient");
  });

  it("passport Core door stays passport-only — no custody helper copy", () => {
    const src = fs.readFileSync(PASSPORT_CORE, "utf8");
    assert.ok(src.includes("TransferV1CpiBuilder"), "passport keeps TransferV1 for its own door");
    assert.ok(!src.includes("require_not_frozen"), "no freeze-gate copy");
    assert.ok(!src.includes("transfer_owner_to_custody"), "no custody move copy");
  });

  it("bidirectional: harness + FixedPrice + Ascending consume shared moves; skip-freeze plant is harness-local", () => {
    const harness = fs.readFileSync(HARNESS_IX, "utf8");
    assert.ok(harness.includes("transfer_owner_to_custody"));
    assert.ok(harness.includes("transfer_delegate_to_custody"));
    assert.ok(harness.includes("transfer_custody_to_recipient"));
    assert.ok(harness.includes("CoreTransferOwnerSkipFreeze"));
    assert.ok(
      harness.includes("TransferV1CpiBuilder"),
      "skip-freeze plant must CPI TransferV1 in harness",
    );
    assert.ok(!harness.includes("transfer_owner_to_custody_skip_freeze_gate"));

    const moveHits = searchUnder(
      String.raw`transfer_owner_to_custody|transfer_delegate_to_custody|transfer_custody_to_recipient`,
      path.join(SVM, "programs"),
      ["*.rs"],
    );
    const allowed = ["consignment-harness", "kar-fixed-price", "kar-ascending"];
    const lines = moveHits
      .split("\n")
      .filter((l) => l.trim() && !allowed.some((a) => l.includes(a)));
    assert.equal(
      lines.join("\n").trim(),
      "",
      `shared custody moves outside allowed programs:\n${lines.join("\n")}`,
    );
  });
});
