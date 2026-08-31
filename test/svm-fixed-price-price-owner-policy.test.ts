/**
 * S6 #5 FixedPrice price owner (both directions).
 *
 * - Fiat/oracle decode + gates only via kargain-price
 * - Ascending still bans oracle
 * - Approve still proves mint via money-crate validator
 * - Constructed dual parse offsets outside crate fail scanner
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FP_IX = path.join(ROOT, "svm/programs/kar-fixed-price/src/ix.rs");
const LIVE = path.join(ROOT, "svm/stand/live-fixed-price.ts");
const PRICE = path.join(ROOT, "svm/crates/kargain-price/src/lib.rs");
const MONEY = path.join(ROOT, "svm/crates/kargain-claimable-payouts/src/lib.rs");
const ASC_IX = path.join(ROOT, "svm/programs/kar-ascending/src/ix.rs");
const PROGRAMS = path.join(ROOT, "svm/programs");
const CRATES = path.join(ROOT, "svm/crates");

const OFFSET_PARSE =
  String.raw`FEED_ID_OFFSET|PRICE_I64_OFFSET|CONF_U64_OFFSET|EXPO_I32_OFFSET|PUBLISH_TIME_OFFSET|PriceUpdateV2_msg@41|22f123639d7ef4cd`;

const ASC_ORACLE_BAN =
  String.raw`kargain_price|read_price_update|PriceUpdateV2|pyth|hermes|staleness_tolerance|max_confidence`;

function rg(pattern: string, files: string[]): string {
  try {
    return execFileSync("rg", ["-n", "-i", pattern, ...files], { encoding: "utf8" });
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1) return "";
    throw e;
  }
}

describe("svm-fixed-price-price-owner-policy", () => {
  it("kargain-price is sole offset/decode owner; FixedPrice consumes it", () => {
    const price = fs.readFileSync(PRICE, "utf8");
    assert.ok(price.includes("fn read_price_update"));
    assert.ok(price.includes("FEED_ID_OFFSET"));
    assert.ok(price.includes("ConfidenceTooWide"));
    assert.ok(price.includes("StalePrice"));

    const fp = fs.readFileSync(FP_IX, "utf8");
    assert.ok(fp.includes("kargain_price::") || fp.includes("use kargain_price::"));
    assert.ok(fp.includes("read_price_update"));
    assert.ok(fp.includes("PaymentTokenFeedRequired"));
    assert.ok(!fp.includes("FiatDenominationRefused"), "FixedPrice must not use ascending-only Fiat refuse");

    // Offset constants must not appear under programs/ (only crate)
    const dual = rg(OFFSET_PARSE, [PROGRAMS]);
    const codeHits = dual
      .split("\n")
      .filter((l) => l.trim())
      .filter((l) => !l.includes("//") && !l.includes("*"));
    assert.equal(codeHits.join("\n").trim(), "", `dual price parse under programs:\n${codeHits.join("\n")}`);
  });

  it("Ascending remains oracle-banned", () => {
    const hit = rg(ASC_ORACLE_BAN, [ASC_IX]);
    const codeHits = hit
      .split("\n")
      .filter((l) => l.trim())
      .filter((l) => !l.includes("//") && !l.includes("*"));
    assert.equal(codeHits.join("\n").trim(), "", `Ascending oracle surface:\n${codeHits.join("\n")}`);
    const asc = fs.readFileSync(ASC_IX, "utf8");
    assert.ok(asc.includes("FiatDenominationRefused"));
  });

  it("ApprovePaymentToken proves mint; feed pins in ix (no caller decimals)", () => {
    const src = fs.readFileSync(FP_IX, "utf8");
    const approve = src.slice(src.indexOf("fn approve_payment_token"));
    const body = approve.slice(0, approve.indexOf("\nfn "));
    assert.ok(body.includes("require_admitted_spl_mint_account"));
    assert.ok(body.includes("CannotClearPaymentTokenFeed"));
    assert.ok(body.includes("MIN_FEED_STALENESS") || body.includes("FeedStalenessOutOfBounds"));
    assert.ok(!/ApprovePaymentToken\s*\{[^}]*decimals/.test(src));
    assert.ok(!/ApprovePaymentToken\s*\{[^}]*mint\s*:/.test(src));
    const money = fs.readFileSync(MONEY, "utf8");
    assert.ok(money.includes("fn require_admitted_spl_mint_account"));
  });

  it("buy measures delivery; fiat conversion via price crate; D-27 set_snapshot_floor", () => {
    const src = fs.readFileSync(FP_IX, "utf8");
    const buy = src.slice(src.indexOf("fn buy("));
    const buyBody = buy.slice(0, buy.indexOf("\nfn "));
    assert.ok(buyBody.includes("require_full_delivery"));
    assert.ok(buyBody.includes("read_price_update"));
    assert.ok(buyBody.includes("set_snapshot_floor"));
    assert.ok(buyBody.includes("agented_floor_scale_base"));
    assert.ok(!buyBody.includes("rec.enabled"));
  });

  it("ForceSeedPriceAccount is authority-gated", () => {
    const src = fs.readFileSync(FP_IX, "utf8");
    assert.ok(src.includes("ForceSeedPriceAccount"));
    const fn = src.slice(src.indexOf("fn force_seed_price_account"));
    const body = fn.slice(0, fn.indexOf("\nfn ") === -1 ? fn.length : fn.indexOf("\nfn "));
    assert.ok(body.includes("cfg.authority") || body.includes("authority.key"));
    assert.ok(body.includes("PRICE_LAB_SEED") || body.includes("price-lab"));
  });

  it("constructed dual offset parse outside price crate fails scanner", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-price-"));
    const dirty = path.join(dir, "dirty.rs");
    fs.writeFileSync(
      dirty,
      `const FEED_ID_OFFSET: usize = 41;\nfn f(d: &[u8]) { let _ = &d[FEED_ID_OFFSET..]; }\n`,
    );
    const hit = rg(OFFSET_PARSE, [dirty]);
    assert.ok(hit.trim().length > 0, "scanner must catch dual offset parse");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("LIVE proof module is imported by svm-stand.test.ts", () => {
    const stand = fs.readFileSync(path.join(ROOT, "test/svm-stand.test.ts"), "utf8");
    assert.ok(stand.includes("live-fixed-price"));
    assert.ok(stand.includes("runLiveFixedPrice"));
    const live = fs.readFileSync(LIVE, "utf8");
    assert.ok(live.includes("ForceSeedPriceAccount") || live.includes("ForceSeed"));
    assert.ok(live.includes("lab-fresh_narrow") || live.includes("price-measure"));
  });

  it("price crate lives under svm/crates and is a workspace member", () => {
    assert.ok(fs.existsSync(PRICE));
    const ws = fs.readFileSync(path.join(ROOT, "svm/Cargo.toml"), "utf8");
    assert.ok(ws.includes("kargain-price"));
    // No second read_price_update under crates except owner
    const hits = rg(String.raw`fn read_price_update`, [CRATES]);
    const files = [
      ...new Set(
        hits
          .split("\n")
          .filter((l) => l.includes(":"))
          .map((l) => l.split(":")[0]!),
      ),
    ];
    assert.deepEqual(
      files.map((f) => path.relative(ROOT, f)),
      ["svm/crates/kargain-price/src/lib.rs"],
    );
  });
});
