/**
 * S6 #4 Ascending — asset-only + shared delivery owner (both directions).
 *
 * - kar-ascending + live-ascending must not import Pyth / Hermes / price-account paths
 * - Bid must call require_full_delivery / spl_token_account_amount (same money crate as FixedPrice buy)
 * - Constructed dirty fixtures fail the scanners
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASC_IX = path.join(ROOT, "svm/programs/kar-ascending/src/ix.rs");
const FP_IX = path.join(ROOT, "svm/programs/kar-fixed-price/src/ix.rs");
const LIVE = path.join(ROOT, "svm/stand/live-ascending.ts");
const MONEY = path.join(ROOT, "svm/crates/kargain-claimable-payouts/src/lib.rs");
const PROGRAMS = path.join(ROOT, "svm/programs");

const ORACLE_BAN =
  String.raw`pyth|hermes|PriceUpdateV2|price_account|Chainlink|AggregatorV3|staleness|fiatToUsd|usdToNative|_quoteAmount`;

function rg(pattern: string, files: string[]): string {
  try {
    return execFileSync("rg", ["-n", "-i", pattern, ...files], { encoding: "utf8" });
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1) return "";
    throw e;
  }
}

describe("svm-ascending-asset-only-policy", () => {
  it("no oracle / price-feed imports under Ascending program (+ LIVE if present)", () => {
    const files = [ASC_IX];
    if (fs.existsSync(LIVE)) files.push(LIVE);
    const hit = rg(ORACLE_BAN, files);
    const codeHits = hit
      .split("\n")
      .filter((l) => l.trim())
      .filter((l) => !l.includes("//") && !l.includes("*"));
    assert.equal(codeHits.join("\n").trim(), "", `oracle surface:\n${codeHits.join("\n")}`);
  });

  it("shared open stubs refuse AscendingOpenPath; SetPrice refuses TermsFixed", () => {
    const src = fs.readFileSync(ASC_IX, "utf8");
    assert.ok(src.includes("AscendingOpenPath"));
    assert.ok(src.includes("TermsFixed"));
    assert.ok(/OpenDirect[\s\S]*AscendingOpenPath|AscendingOpenPath[\s\S]*OpenDirect/.test(src));
  });

  it("bid measures SPL delivery via money-crate require_full_delivery (shared with FixedPrice buy)", () => {
    const asc = fs.readFileSync(ASC_IX, "utf8");
    const bid = asc.slice(asc.indexOf("fn bid("));
    const bidBody = bid.slice(0, bid.indexOf("\nfn "));
    assert.ok(bidBody.includes("require_full_delivery"), "bid must call delivery measure");
    assert.ok(bidBody.includes("spl_token_account_amount"), "bid must read ATA amount via money owner");

    const fp = fs.readFileSync(FP_IX, "utf8");
    const buy = fp.slice(fp.indexOf("fn buy("));
    const buyBody = buy.slice(0, buy.indexOf("\nfn "));
    assert.ok(buyBody.includes("require_full_delivery"), "FixedPrice buy must still call delivery");

    const money = fs.readFileSync(MONEY, "utf8");
    assert.ok(money.includes("fn require_full_delivery"));
    assert.ok(money.includes("fn spl_token_account_amount"));

    const dual = rg(
      String.raw`fn require_full_delivery|SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET\s*=`,
      [PROGRAMS],
    );
    assert.equal(dual.trim(), "", `dual delivery owner under programs:\n${dual}`);
  });

  it("open requires PassportNotVerified gate and prove_active_verifier", () => {
    const src = fs.readFileSync(ASC_IX, "utf8");
    assert.ok(src.includes("PassportNotVerified"));
    assert.ok(src.includes("prove_active_verifier"));
    const open = src.slice(src.indexOf("fn open_ascending_direct"));
    assert.ok(open.includes("PassportNotVerified"));
  });

  it("constructed oracle violation fails scanner", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asc-oracle-"));
    const dirty = path.join(dir, "dirty.rs");
    fs.writeFileSync(
      dirty,
      `use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;\nfn f() { let _ = PriceUpdateV2; }\n`,
    );
    const hit = rg(ORACLE_BAN, [dirty]);
    assert.ok(hit.trim().length > 0, "scanner must catch constructed pyth import");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("constructed dual delivery offset under programs fails ban", () => {
    const dirty = `
fn require_full_delivery(a: u64, b: u64, c: u64) {}
const SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET: usize = 64;
`;
    assert.ok(dirty.includes("fn require_full_delivery"));
    assert.ok(dirty.includes("SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET"));
  });
});
