/**
 * S6 #2 consignment automaton — sole-owner structural bans (both directions).
 *
 * - Phase / mandate / recall transitions live only in kargain-consignment-base
 * - Split arithmetic only via kargain-agented-split (no second formula in consignment crate)
 * - Payout / claim only via kargain-claimable-payouts (no parallel credit path)
 * - No attempt-then-catch for transfer CPI
 * - Harness is the only program that instantiates the automaton for validator proof
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVM = path.join(ROOT, "svm");
const BASE = path.join(SVM, "crates/kargain-consignment-base/src/lib.rs");
const HARNESS = path.join(SVM, "programs/consignment-harness/src");

function rg(pattern: string, cwd: string, globs: string[]): string {
  try {
    return execFileSync(
      "rg",
      ["-n", "--glob", "!**/target/**", ...globs.flatMap((g) => ["--glob", g]), pattern, cwd],
      { encoding: "utf8" },
    );
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1) return "";
    throw e;
  }
}

describe("svm-consignment-automaton-policy", () => {
  it("sole crate owns phase / mandate / recall seeds and require_can_open order", () => {
    const src = fs.readFileSync(BASE, "utf8");
    assert.ok(src.includes('pub const CONSIGNMENT_SEED'), "consignment seed owner");
    assert.ok(src.includes('pub const MANDATE_SEED'), "mandate seed owner");
    assert.ok(src.includes('pub const RECALL_SEED'), "recall seed owner");
    assert.ok(src.includes("pub fn require_can_open"), "shared open gate");
    // Check order pinned in source comments + successive returns
    const fn = src.slice(src.indexOf("pub fn require_can_open"));
    const body = fn.slice(0, fn.indexOf("\npub fn "));
    const modeIdx = body.indexOf("ModeNotEncumbranceSource");
    const openIdx = body.indexOf("OpenConsignmentRefused");
    const liveIdx = body.indexOf("LiveConsignment");
    const escIdx = body.indexOf("EscrowNotApproved");
    assert.ok(modeIdx >= 0 && openIdx > modeIdx && liveIdx > openIdx && escIdx > liveIdx);
  });

  it("consignment crate consumes agented-split; does not reimplement platform*settled/B", () => {
    const src = fs.readFileSync(BASE, "utf8");
    assert.ok(src.includes("kargain_agented_split"), "imports split owner");
    assert.ok(src.includes("compute_agented_split") || src.includes("compute_direct_split"));
    // Ban a second BPS mul formula that looks like platform = settled * fee / 10000 in this crate
    const hit = rg(String.raw`settled\s*\*\s*.*fee|fee_bps\s*\*\s*settled`, path.dirname(BASE), [
      "*.rs",
    ]);
    // allow imports / comments only — raw arithmetic for platform share must not appear outside agented-split
    assert.equal(hit.trim(), "", `second split arithmetic in consignment-base:\n${hit}`);
  });

  it("bidirectional: harness imports consignment-base; no second automaton under programs/", () => {
    const harnessLib = fs.readFileSync(path.join(HARNESS, "ix.rs"), "utf8");
    assert.ok(harnessLib.includes("kargain_consignment_base"), "harness consumes owner");
    const other = rg(
      String.raw`require_can_open|RECALL_COOLDOWN_SECS|write_open\s*\(`,
      path.join(SVM, "programs"),
      ["*.rs"],
    );
    const lines = other
      .split("\n")
      .filter((l) => l.trim() && !l.includes("consignment-harness"));
    assert.equal(
      lines.join("\n").trim(),
      "",
      `automaton symbols outside consignment-harness:\n${lines.join("\n")}`,
    );
  });

  it("harness pay path uses classify + pay_spl; no attempt-then-catch", () => {
    const ix = fs.readFileSync(path.join(HARNESS, "ix.rs"), "utf8");
    assert.ok(ix.includes("classify_spl_receive_reachability"));
    assert.ok(ix.includes("pay_spl"));
    assert.ok(!ix.includes("pay_spl_or_credit"));
    const hit = rg(String.raw`pay_spl_or_credit`, HARNESS, ["*.rs"]);
    assert.equal(hit.trim(), "", hit);
  });

  it("custody is owner move (take_custody / release_custody), not delegate-as-custody", () => {
    const src = fs.readFileSync(BASE, "utf8");
    assert.ok(src.includes("pub fn take_custody"));
    assert.ok(src.includes("pub fn release_custody"));
    assert.ok(src.includes("pub fn is_escrow_approved"));
    // take_custody must assign asset.owner
    const take = src.slice(src.indexOf("pub fn take_custody"));
    assert.ok(take.includes("asset.owner = *custody"));
  });

  it("phase / CloseReason ordinals match EVM", () => {
    const src = fs.readFileSync(BASE, "utf8");
    assert.match(src, /Offered\s*=\s*1/);
    assert.match(src, /Closed\s*=\s*2/);
    assert.match(src, /Returned\s*=\s*3/);
    assert.match(src, /Recalled\s*=\s*4/);
    assert.match(src, /ReversalAbandoned\s*=\s*6/);
  });
});
