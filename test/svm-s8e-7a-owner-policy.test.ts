/**
 * S8-E 7a — one admission law, one [b"config"] PDA recipe, one Core liveness body.
 *
 * In-memory plants only (no write into scanned roots).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { searchUnder } from "./policy-content-search.ts";
import { assertCleanProductScan, scanProductSources } from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVM = path.join(ROOT, "svm");
const CONFIG_PDA = path.join(SVM, "crates/kargain-config-pda/src/lib.rs");
const CORE_LIVE = path.join(SVM, "crates/kargain-core-liveness/src/lib.rs");
const STAND = path.join(SVM, "stand");

const ILLEGAL_OWNER = /ProgramError::IllegalOwner/;
const CONFIG_PDA_LITERAL = /find_program_address\(\s*&\[\s*b"config"/;
const LIVE_FN = /(?:pub\s+)?fn is_live_core_asset\s*\(/;

function countLiveFnBodies(text: string): number {
  return (text.match(new RegExp(LIVE_FN.source, "g")) ?? []).length;
}

function collectRs(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "target" || ent.name === "node_modules") continue;
        walk(p);
      } else if (ent.name.endsWith(".rs")) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}

describe("svm-s8e-7a-owner-policy", () => {
  it("no ProgramError::IllegalOwner under svm/programs", () => {
    const hits = searchUnder("ProgramError::IllegalOwner", path.join(SVM, "programs"), [
      "*.rs",
    ]);
    assert.equal(hits, "", hits);
  });

  it("plant: IllegalOwner in a program handler is red then green", () => {
    const dirty = `fn set_peer() { return Err(ProgramError::IllegalOwner); }`;
    const clean = `fn set_peer() { require_config_authority(program_id, config, authority)?; }`;
    assert.equal(ILLEGAL_OWNER.test(dirty), true, "planted IllegalOwner must be red");
    assert.equal(ILLEGAL_OWNER.test(clean), false, "admit path is green");
    const live = searchUnder("ProgramError::IllegalOwner", path.join(SVM, "programs"), [
      "*.rs",
    ]);
    assert.equal(live, "", "live programs stay green after plant");
  });

  it("find_program_address(&[b\"config\"] lives only in kargain-config-pda", () => {
    const hits = searchUnder('find_program_address\\(\\s*&\\[\\s*b"config"', SVM, [
      "*.rs",
    ]);
    const lines = hits === "" ? [] : hits.split("\n").filter(Boolean);
    assert.ok(
      lines.every((h) => h.includes(`${path.sep}kargain-config-pda${path.sep}`)),
      `config PDA literal leaked:\n${hits}`,
    );
    const owner = fs.readFileSync(CONFIG_PDA, "utf8");
    assert.ok(owner.includes('pub const CONFIG_SEED: &[u8] = b"config"'));
    assert.ok(owner.includes("pub fn config_pda"));
  });

  it("plant: extra [b\"config\"] find_program_address is red then green", () => {
    const dirty = `let (k, _) = Pubkey::find_program_address(&[b"config"], program_id);`;
    const clean = `let (k, _) = kargain_config_pda::config_pda(program_id);`;
    assert.equal(CONFIG_PDA_LITERAL.test(dirty), true, "planted literal must be red");
    assert.equal(CONFIG_PDA_LITERAL.test(clean), false, "owner call is green");
  });

  it("exactly one fn is_live_core_asset body in the svm tree", () => {
    let total = 0;
    let ownerHits = 0;
    for (const file of collectRs(SVM)) {
      const text = fs.readFileSync(file, "utf8");
      const n = countLiveFnBodies(text);
      total += n;
      if (file === CORE_LIVE) ownerHits += n;
    }
    assert.equal(ownerHits, 1, "owner crate must define the body once");
    assert.equal(total, 1, `exactly one liveness body; found ${total}`);
    const owner = fs.readFileSync(CORE_LIVE, "utf8");
    assert.ok(owner.includes("mpl_core::ID"));
    assert.ok(owner.includes("data_len() > 1"));
  });

  it("plant: second is_live_core_asset body is red then green", () => {
    const live = fs.readFileSync(CORE_LIVE, "utf8");
    assert.equal(countLiveFnBodies(live), 1);
    const planted = `${live}\nfn is_live_core_asset(asset: &AccountInfo) -> bool { true }\n`;
    assert.equal(countLiveFnBodies(planted), 2, "planted second body must be red");
    assert.equal(countLiveFnBodies(live), 1, "live owner stays one body");
  });

  it("product TS and stand have zero IllegalOwner strings", () => {
    assertCleanProductScan(
      scanProductSources((_rel, source) =>
        source.includes("IllegalOwner") ? "IllegalOwner string" : false,
      ),
    );
    const standHits = searchUnder("IllegalOwner", STAND, ["*.ts"]);
    assert.equal(standHits, "", standHits);
  });
});
