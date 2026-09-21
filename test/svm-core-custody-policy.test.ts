/**
 * S8-E step 4 — Core custody helpers sole owner in kargain-consignment-base.
 *
 * - Binding / freeze / TransferDelegate / TransferV1 live in core_custody.rs
 * - Modes must not call TransferV1CpiBuilder (migration is steps 5–6)
 * - Passport keeps its own Core door (no copy of custody helpers)
 * - Harness is the only validator proof consumer of the shared moves
 */
import assert from "node:assert/strict";
import fs from "node:fs";
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
const PASSPORT_CORE = path.join(SVM, "programs/kar-passport/src/core_asset.rs");

describe("svm-core-custody-policy", () => {
  it("sole owner exports binding, freeze gate, delegate read, and three TransferV1 moves", () => {
    const src = fs.readFileSync(CORE_CUSTODY, "utf8");
    assert.ok(src.includes("pub const PASSPORT_ASSET_SEED"));
    assert.ok(src.includes('b"asset"'));
    assert.ok(src.includes("pub fn require_passport_core_asset"));
    assert.ok(src.includes("pub fn require_not_frozen"));
    assert.ok(src.includes("KargainError::AssetFrozen"));
    assert.ok(src.includes("pub fn require_transfer_delegate"));
    assert.ok(src.includes("pub fn transfer_owner_to_custody"));
    assert.ok(src.includes("pub fn transfer_delegate_to_custody"));
    assert.ok(src.includes("pub fn transfer_custody_to_recipient"));
    assert.ok(src.includes("TransferV1CpiBuilder"));
    assert.ok(
      src.includes("transfer_owner_to_custody_skip_freeze_gate"),
      "fact (b) plant path must exist",
    );
  });

  it("plant messages name AssetFrozen / NotTransferDelegate / NotLiveCoreAsset", () => {
    const src = fs.readFileSync(CORE_CUSTODY, "utf8");
    assert.ok(src.includes('"AssetFrozen"'));
    assert.ok(src.includes('"NotTransferDelegate"'));
    assert.ok(src.includes('"NotLiveCoreAsset"'));
  });

  it("modes do not call TransferV1CpiBuilder (shared owner unused until steps 5–6)", () => {
    for (const prog of ["kar-fixed-price", "kar-ascending"]) {
      const hit = searchUnder("TransferV1CpiBuilder", path.join(SVM, "programs", prog), [
        "*.rs",
      ]);
      assert.equal(hit.trim(), "", `${prog} must not CPI TransferV1 yet:\n${hit}`);
    }
  });

  it("passport Core door stays passport-only — no custody helper copy", () => {
    const src = fs.readFileSync(PASSPORT_CORE, "utf8");
    assert.ok(src.includes("TransferV1CpiBuilder"), "passport keeps TransferV1 for its own door");
    assert.ok(!src.includes("require_not_frozen"), "no freeze-gate copy");
    assert.ok(!src.includes("transfer_owner_to_custody"), "no custody move copy");
    assert.ok(!src.includes("PASSPORT_ASSET_SEED"), "passport uses its own ASSET_SEED");
  });

  it("bidirectional: harness consumes shared moves; no third TransferV1 move owner", () => {
    const harness = fs.readFileSync(
      path.join(SVM, "programs/consignment-harness/src/ix.rs"),
      "utf8",
    );
    assert.ok(harness.includes("transfer_owner_to_custody"));
    assert.ok(harness.includes("transfer_delegate_to_custody"));
    assert.ok(harness.includes("transfer_custody_to_recipient"));
    assert.ok(harness.includes("CoreTransferOwnerSkipFreeze"));

    const moveHits = searchUnder(
      String.raw`transfer_owner_to_custody|transfer_delegate_to_custody|transfer_custody_to_recipient`,
      path.join(SVM, "programs"),
      ["*.rs"],
    );
    const allowed = ["consignment-harness"];
    const lines = moveHits
      .split("\n")
      .filter((l) => l.trim() && !allowed.some((a) => l.includes(a)));
    assert.equal(
      lines.join("\n").trim(),
      "",
      `shared custody moves outside harness proof surface:\n${lines.join("\n")}`,
    );
  });
});
