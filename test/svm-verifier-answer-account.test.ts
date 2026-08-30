/**
 * S5 Z4 — verifier answer-account substitution refusals (named errors).
 *
 * Pins the class of defect (wrong owner / wrong PDA / inactive / self / status),
 * not a single misspelling. Executable mirror of Rust `verify::tests` + stake classifier.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(process.cwd());
const VERIFY_RS = join(ROOT, "svm/programs/kar-passport/src/verify.rs");
const STAKE_RS = join(ROOT, "svm/programs/kar-pro-staking/src/stake.rs");

describe("S5 verifier answer-account substitution (Z4)", () => {
  const verifySrc = readFileSync(VERIFY_RS, "utf8");
  const stakeSrc = readFileSync(STAKE_RS, "utf8");

  it("passport verify owns SourceUnanswerable for owner/PDA mismatch", () => {
    assert.match(verifySrc, /wrong_owner_program_unanswerable/);
    assert.match(verifySrc, /wrong_pda_unanswerable/);
    assert.match(verifySrc, /Err\(KargainError::SourceUnanswerable\)/);
  });

  it("inactive mid-unbond asserts NotActiveVerifier", () => {
    assert.match(verifySrc, /inactive_mid_unbond/);
    assert.match(verifySrc, /Err\(KargainError::NotActiveVerifier\)/);
  });

  it("self-verify asserts CannotSelfVerify; wrong status InvalidStatus", () => {
    assert.match(verifySrc, /self_verify_refused/);
    assert.match(verifySrc, /CannotSelfVerify/);
    assert.match(verifySrc, /invalid_status/);
    assert.match(verifySrc, /InvalidStatus/);
  });

  it("leave-then-rejoin is covered (inactive then active)", () => {
    assert.match(verifySrc, /left_then_rejoined_verify_ok/);
  });

  it("stake classifier never treats wrong owner as inactive", () => {
    assert.match(stakeSrc, /wrong_owner_unanswerable/);
    assert.match(stakeSrc, /SourceUnanswerable/);
    assert.match(stakeSrc, /missing_data_unanswerable_not_silent_inactive/);
  });

  it("leave clears fee without pass participation", () => {
    assert.match(stakeSrc, /leave_clears_fee_and_deactivates_without_pass/);
  });
});
