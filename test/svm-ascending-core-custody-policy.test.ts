/**
 * S8-E step 6 — Ascending must not reference the retired harness custody path.
 * Commercial base must not retain HarnessAsset / take_custody / require_can_open.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASC_SRC = path.join(ROOT, "svm/programs/kar-ascending/src");
const BASE_LIB = path.join(
  ROOT,
  "svm/crates/kargain-consignment-base/src/lib.rs",
);

const BANNED = [
  "HarnessAsset",
  "load_asset",
  "take_custody",
  "release_custody",
  "is_escrow_approved",
  "self_encumbrance_registered",
  "read_may_open",
  "write_may_open",
  "require_can_open",
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
    if (sym === "self_encumbrance_registered") {
      // Layout alias `self_encumbrance_registered_retired` is allowed; live reads are not.
      const scrubbed = src.replaceAll("self_encumbrance_registered_retired", "");
      return scrubbed.includes("self_encumbrance_registered");
    }
    return new RegExp(`\\b${sym}\\b`).test(src);
  });
}

describe("svm-ascending-core-custody-policy", () => {
  it("live Ascending sources contain none of the banned harness symbols", () => {
    const files = walkRs(ASC_SRC);
    assert.ok(files.length > 0, "expected Ascending rust sources");
    const hits: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const sym of findBanned(src)) {
        hits.push(`${path.relative(ROOT, f)}:${sym}`);
      }
    }
    assert.equal(hits.join("\n"), "", `banned harness symbols:\n${hits.join("\n")}`);
  });

  it("plant: in-memory dirty fixture is red then green", () => {
    const dirty = [
      "fn take_custody() {}",
      "use HarnessAsset;",
      "cfg.self_encumbrance_registered",
      "require_can_open(",
    ].join("\n");
    const red = findBanned(dirty);
    assert.ok(red.includes("take_custody"));
    assert.ok(red.includes("HarnessAsset"));
    assert.ok(red.includes("self_encumbrance_registered"));
    assert.ok(red.includes("require_can_open"));

    const clean = [
      "fn transfer_owner_to_custody() {}",
      "self_encumbrance_registered_retired",
      "HarnessInstructionRetired",
      "require_verified_passport_status",
    ].join("\n");
    assert.deepEqual(findBanned(clean), []);
  });

  it("Ascending consumes Core movers, BindPassportProgram, verified status reader", () => {
    const ix = fs.readFileSync(path.join(ASC_SRC, "ix.rs"), "utf8");
    assert.ok(ix.includes("BindPassportProgram"));
    assert.ok(ix.includes("transfer_owner_to_custody"));
    assert.ok(ix.includes("transfer_delegate_to_custody"));
    assert.ok(ix.includes("transfer_custody_to_recipient"));
    assert.ok(ix.includes("transfer_owner_to_recipient"));
    assert.ok(ix.includes("resolve_may_accounts"));
    assert.ok(ix.includes("encumbrance_seed_prefix_for_source"));
    assert.ok(ix.includes("require_verified_passport_status"));
    assert.ok(ix.includes("HarnessInstructionRetired"));
    assert.ok(ix.includes("require_verified_passport_status"));
    const may = fs.readFileSync(
      path.join(ROOT, "svm/programs/kar-passport/src/may.rs"),
      "utf8",
    );
    assert.ok(may.includes("PassportNotVerified"));
    assert.ok(may.includes("fn require_passport_status"));
    assert.ok(may.includes("fn require_verified_passport_status"));
  });

  it("commercial base has no HarnessAsset / take_custody / require_can_open", () => {
    const src = fs.readFileSync(BASE_LIB, "utf8");
    assert.ok(!/\bHarnessAsset\b/.test(src));
    assert.ok(!/\btake_custody\b/.test(src));
    assert.ok(!/\brequire_can_open\b/.test(src));
    assert.ok(!/b"harness-asset"/.test(src));
  });

  it("plant: base dirty fixture is red then green", () => {
    const dirty = 'pub struct HarnessAsset {}\npub fn take_custody() {}\npub fn require_can_open() {}';
    assert.ok(/\bHarnessAsset\b/.test(dirty));
    const clean = "pub fn transfer_owner_to_custody() {}";
    assert.ok(!/\bHarnessAsset\b/.test(clean));
  });
});
