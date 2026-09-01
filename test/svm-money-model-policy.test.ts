/**
 * S6 money-layer structural bans — pin the rule, both directions.
 *
 * - No transfer-outcome parameters (`push_ok:` / `transfer_ok:`)
 * - No attempt-then-catch: matching CPI/transfer `Err` to decide claim credit
 * - No program-global pending/locked maps or rescue-excess
 * - Dead PassportChallengeBook / VAULT_SEED stay deleted
 * - Seed constants live only in money crates
 * - Reachability classifier exists; pay_spl takes pre-classified reachability
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVM = path.join(ROOT, "svm");

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

describe("svm-money-model-policy", () => {
  it("bans push_ok / transfer_ok outcome parameters under svm/", () => {
    const hit = rg(String.raw`\b(push_ok|transfer_ok)\s*:`, SVM, ["*.rs"]);
    assert.equal(hit.trim(), "", `outcome-as-parameter still present:\n${hit}`);
  });

  it("bans attempt-then-catch: Err arm that credits a claim after transfer CPI", () => {
    // Pin the rule: no match on transfer/CPI Result::Err that then calls credit_claim
    // or routes to claim. Allowed: classify_* then pay_spl(reachability, ...).
    const claimable = path.join(SVM, "crates/kargain-claimable-payouts/src/lib.rs");
    const src = fs.readFileSync(claimable, "utf8");
    assert.ok(
      src.includes("classify_spl_receive_reachability"),
      "reachability classifier must exist",
    );
    assert.ok(src.includes("fn pay_spl"), "pay_spl sole payout router");
    assert.ok(
      !src.includes("fn pay_spl_or_credit"),
      "attempt-then-catch pay_spl_or_credit must stay deleted",
    );
    // Structural: pay_spl must match on SplReceiveReachability, not on ProgramResult Err
    const payFn = src.slice(src.indexOf("pub fn pay_spl"));
    const payBody = payFn.slice(0, payFn.indexOf("\npub fn withdraw_claim_prepare"));
    assert.ok(
      payBody.includes("SplReceiveReachability::Reachable"),
      "pay_spl must branch on reachability",
    );
    assert.ok(
      !/match\s+\w+\(\)\s*\{[\s\S]*Err\s*\([^)]*\)\s*=>[\s\S]*credit_claim/.test(payBody),
      "pay_spl must not match transfer Err to credit_claim",
    );

    // Reintroduction detector: any svm Rust that does Err => ... credit_claim
    const hit = rg(
      String.raw`Err\s*\([^)]*\)\s*=>[\s\S]{0,200}credit_claim`,
      SVM,
      ["*.rs"],
    );
    // Multiline may not work in default rg — also ban pay_spl_or_credit symbol
    const hit2 = rg(String.raw`pay_spl_or_credit|transfer_to_recipient\(\)`, SVM, ["*.rs"]);
    assert.equal(
      (hit + hit2).trim(),
      "",
      `attempt-then-catch pattern reintroduced:\n${hit}\n${hit2}`,
    );
  });

  it("bans rescue_excess and global pending/locked totals in money crates", () => {
    const crates = path.join(SVM, "crates");
    const hit = rg(
      String.raw`rescue_excess|total_pending_native|total_locked_bonds|ClaimablePayoutsState|BTreeMap`,
      crates,
      ["**/kargain-claimable-payouts/**", "**/kargain-bonded-challenge/**"],
    );
    assert.equal(hit.trim(), "", `global money bookkeeping survives:\n${hit}`);
  });

  it("PassportChallengeBook and VAULT_SEED stay deleted", () => {
    const hit = rg(String.raw`PassportChallengeBook|VAULT_SEED|vault_pda`, SVM, ["*.rs"]);
    assert.equal(hit.trim(), "", `dead money account symbols remain:\n${hit}`);
  });

  it("claim / challenge / escrow seeds owned by money crates", () => {
    const claim = fs.readFileSync(
      path.join(SVM, "crates/kargain-claimable-payouts/src/lib.rs"),
      "utf8",
    );
    const bond = fs.readFileSync(
      path.join(SVM, "crates/kargain-bonded-challenge/src/lib.rs"),
      "utf8",
    );
    assert.ok(claim.includes('pub const CLAIM_SEED: &[u8] = b"claim"'));
    assert.ok(claim.includes('pub const ESCROW_SEED: &[u8] = b"escrow"'));
    assert.ok(claim.includes('pub const CLAIM_ATA_SEED: &[u8] = b"claim-ata"'));
    assert.ok(bond.includes('pub const CHALLENGE_SEED: &[u8] = b"challenge"'));
  });

  it("kar-passport money deps route only through claims + challenge owners", () => {
    const toml = fs.readFileSync(
      path.join(SVM, "programs/kar-passport/Cargo.toml"),
      "utf8",
    );
    assert.ok(toml.includes("kargain-claimable-payouts"));
    assert.ok(toml.includes("kargain-bonded-challenge"));
    const claims = fs.readFileSync(
      path.join(SVM, "programs/kar-passport/src/claims.rs"),
      "utf8",
    );
    const challenge = fs.readFileSync(
      path.join(SVM, "programs/kar-passport/src/challenge.rs"),
      "utf8",
    );
    assert.ok(claims.includes("kargain_claimable_payouts"));
    assert.ok(challenge.includes("kargain_bonded_challenge"));
    const ep = fs.readFileSync(
      path.join(SVM, "programs/kar-passport/src/entrypoint.rs"),
      "utf8",
    );
    assert.ok(!ep.includes("pay_spl("), "passport entrypoint must not call pay_spl directly");
  });

  it("constructed violation: attempt-then-catch fixture would fail the Err→credit ban", () => {
    const dirty = `
      match transfer_to_recipient() {
        Ok(()) => Ok(None),
        Err(_) => credit_claim(claim, amount),
      }
    `;
    assert.ok(
      /Err\s*\([^)]*\)\s*=>[\s\S]{0,200}credit_claim/.test(dirty),
      "detector must catch the forbidden pattern",
    );
  });
});
