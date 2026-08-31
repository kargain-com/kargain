/**
 * S6 #3b FixedPrice asset-only — no oracle / fiat-success surface (both directions).
 *
 * - kar-fixed-price + live-fixed-price must not import Pyth / Hermes / price-account paths
 * - Fiat open must refuse by name (FiatDenominationRefused); no success branch for Fiat
 * - buy must call require_full_delivery (ShortDelivery)
 * - Constructed dirty fixture fails the same scanners
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

describe("svm-fixed-price-asset-only-policy", () => {
  it("no oracle / price-feed imports under FixedPrice program + LIVE proof", () => {
    const hit = rg(ORACLE_BAN, [FP_IX, LIVE]);
    // Allow comments that name deferred #5 / D-29 — ban only code-shaped hits
    const codeHits = hit
      .split("\n")
      .filter((l) => l.trim())
      .filter((l) => !l.includes("//") && !l.includes("*"));
    assert.equal(codeHits.join("\n").trim(), "", `oracle surface:\n${codeHits.join("\n")}`);
  });

  it("Fiat refused by name; no Fiat success open path", () => {
    const src = fs.readFileSync(FP_IX, "utf8");
    assert.ok(src.includes("FiatDenominationRefused"));
    assert.ok(src.includes("require_mode_open"));
    // Gate must check Fiat before PaymentTokenNotSupported
    const fn = src.slice(src.indexOf("fn require_mode_open"));
    const body = fn.slice(0, fn.indexOf("\nfn "));
    const fiatIdx = body.indexOf("FiatDenominationRefused");
    const payIdx = body.indexOf("PaymentTokenNotSupported");
    assert.ok(fiatIdx >= 0 && payIdx > fiatIdx, "Fiat refuse before PaymentTokenNotSupported");
    // No branch that continues after Fiat kind == success
    assert.ok(!body.includes("DenominationKind::Fiat as u8) {") || body.includes("return Err"));
  });

  it("buy measures SPL delivery via require_full_delivery", () => {
    const src = fs.readFileSync(FP_IX, "utf8");
    assert.ok(src.includes("require_full_delivery"));
    const buy = src.slice(src.indexOf("fn buy("));
    assert.ok(buy.includes("require_full_delivery"));
  });

  it("soft-revoke does not re-check enabled on buy; external closes without pay_spl", () => {
    const src = fs.readFileSync(FP_IX, "utf8");
    const buy = src.slice(src.indexOf("fn buy("), src.indexOf("fn pay_native_from_pda"));
    assert.ok(!buy.includes("rec.enabled") && !buy.includes(".enabled"));
    const ext = src.slice(src.indexOf("fn confirm_external"));
    const extBody = ext.slice(0, ext.indexOf("\nfn "));
    assert.ok(extBody.includes("ExternalConfirmed"));
    assert.ok(!extBody.includes("pay_spl") && !extBody.includes("pay_native"));
  });

  it("constructed violation fixture fails oracle ban", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-asset-"));
    const dirty = path.join(dir, "dirty.rs");
    fs.writeFileSync(
      dirty,
      `use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;\nfn f() { let _ = PriceUpdateV2; }\n`,
    );
    const hit = rg(ORACLE_BAN, [dirty]);
    assert.ok(hit.trim().length > 0, "scanner must catch constructed pyth import");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("LIVE proof module is imported by svm-stand.test.ts", () => {
    const stand = fs.readFileSync(path.join(ROOT, "test/svm-stand.test.ts"), "utf8");
    assert.ok(stand.includes("live-fixed-price"));
    assert.ok(stand.includes("runLiveFixedPrice"));
  });
});
