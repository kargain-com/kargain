/**
 * S6 #3b-fix FixedPrice asset-only + mint admission proof (both directions).
 *
 * - kar-fixed-price + live-fixed-price must not import Pyth / Hermes / price-account paths
 * - Fiat open must refuse by name (FiatDenominationRefused); no success branch for Fiat
 * - ApprovePaymentToken must prove mint via money-crate validator (no caller decimals)
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

  it("ApprovePaymentToken proves mint via money-crate validator; no ix decimals", () => {
    const src = fs.readFileSync(FP_IX, "utf8");
    assert.ok(src.includes("require_admitted_spl_mint_account"));
    const approve = src.slice(src.indexOf("fn approve_payment_token"));
    const body = approve.slice(0, approve.indexOf("\nfn "));
    assert.ok(
      body.includes("require_admitted_spl_mint_account"),
      "admit must call money-crate account validator",
    );
    assert.ok(body.includes("mint.owner") || body.includes("mint.owner,"), "must read mint owner");
    assert.ok(
      body.includes("try_borrow_data") || body.includes("mint.data"),
      "must read mint account data",
    );
    // Unit variant — no mint/decimals in ix data fields after ApprovePaymentToken,
    assert.ok(
      /ApprovePaymentToken\s*,/.test(src) || /ApprovePaymentToken\s*\}/.test(src),
      "ApprovePaymentToken must be unit (no mint/decimals args)",
    );
    assert.ok(!/ApprovePaymentToken\s*\{[^}]*decimals/.test(src));
    assert.ok(!/ApprovePaymentToken\s*\{[^}]*mint\s*:/.test(src));

    const money = fs.readFileSync(MONEY, "utf8");
    assert.ok(money.includes("fn require_admitted_spl_mint_account"));
    assert.ok(money.includes("TransferFeeExtensionForbidden"));

    // Money crate remains sole TransferFee refuse site under programs/
    const feeHits = rg(String.raw`TransferFeeExtensionForbidden`, [PROGRAMS]);
    const dual = feeHits
      .split("\n")
      .filter((l) => l.trim())
      .filter((l) => !l.includes("kargain_claimable_payouts") && !l.includes("into_pe"));
    // Mode may map error via into_pe / name only — ban a second layout/fee check implementation
    const impl = dual.filter(
      (l) =>
        l.includes("fn ") ||
        l.includes("transfer_fee") ||
        l.includes("ExtensionType") ||
        l.includes("tlv"),
    );
    assert.equal(impl.join("\n").trim(), "", `dual TransferFee check:\n${impl.join("\n")}`);
  });

  it("buy does not call require_full_delivery (FoT closed at admit)", () => {
    const src = fs.readFileSync(FP_IX, "utf8");
    const buy = src.slice(src.indexOf("fn buy("));
    const buyBody = buy.slice(0, buy.indexOf("\nfn "));
    assert.ok(!buyBody.includes("require_full_delivery"));
    assert.ok(!buyBody.includes("transfer_fee"));
    assert.ok(!buyBody.includes("spl_transfer_checked_with_fee"));
    // Primitive retained in money crate
    const money = fs.readFileSync(MONEY, "utf8");
    assert.ok(money.includes("fn require_full_delivery"));
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

  it("constructed dirty admit (caller decimals / no mint validator) fails scanner", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-admit-"));
    const dirty = path.join(dir, "dirty-admit.rs");
    fs.writeFileSync(
      dirty,
      `fn approve_payment_token() {
  let decimals: u8 = ix_data_decimals;
  let rec = PaymentTokenRecord { mint: claimed_mint, enabled: true, decimals, bump: 0 };
}
`,
    );
    const body = fs.readFileSync(dirty, "utf8");
    const passes =
      body.includes("require_admitted_spl_mint_account") &&
      !/decimals\s*[:=]\s*ix_data_decimals/.test(body) &&
      (body.includes("try_borrow_data") || body.includes("mint.data"));
    assert.equal(passes, false, "scanner must reject caller-decimals admit without mint validator");
    fs.rmSync(dir, { recursive: true, force: true });
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
