/**
 * S8-E step 3 + 7a — config-authority admission is owned by
 * `kargain-config-authority::admit_config_authority`. Mode (+ harness) handlers
 * reach it via `kargain-consignment-base::require_config_authority` (PDA then
 * admit); passport / gateway / staking via load-then-admit wrappers.
 * Unsigned → MissingRequiredSignature; wrong key → NotOwner. Set derived from
 * Rust handler names (stated floor); empty derivation is red. Plants through
 * the same helpers.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVM = path.join(ROOT, "svm");
const ADMIT = path.join(SVM, "crates/kargain-config-authority/src/lib.rs");
const BASE = path.join(SVM, "crates/kargain-consignment-base/src/lib.rs");
const PASSPORT_ENTRY = path.join(SVM, "programs/kar-passport/src/entrypoint.rs");
const GATEWAY_CONFIG = path.join(SVM, "programs/kar-gateway/src/config.rs");
const STAKING_ENTRY = path.join(SVM, "programs/kar-pro-staking/src/entrypoint.rs");

/**
 * Stated floor — every config-authority / trust-warp binder that must call the owner.
 * Ascending SetMayOpen / SetVerified / SetSelfEnc / ForceAssetOwner are unconditional
 * HarnessInstructionRetired(141) stubs (S8-E step 6) — not in the admit set (mirror
 * FixedPrice retired harness handlers after step 5).
 */
const REQUIRED_HANDLERS: ReadonlyArray<{ program: string; fn: string }> = [
  { program: "kar-fixed-price", fn: "force_recall_at" },
  { program: "kar-fixed-price", fn: "unpause_ix" },
  { program: "kar-fixed-price", fn: "approve_payment_token" },
  { program: "kar-fixed-price", fn: "bind_passport_program" },
  { program: "kar-ascending", fn: "bind_passport_program" },
  { program: "kar-ascending", fn: "unpause_ix" },
  { program: "kar-ascending", fn: "set_challenge_bond" },
  { program: "kar-ascending", fn: "approve_payment_token" },
  { program: "kar-ascending", fn: "force_auction_ends_at" },
  { program: "kar-ascending", fn: "force_hold_clock" },
  { program: "consignment-harness", fn: "set_may_open" },
  { program: "consignment-harness", fn: "set_self_enc" },
  { program: "consignment-harness", fn: "force_recall_at" },
  { program: "consignment-harness", fn: "unpause_ix" },
  { program: "kar-passport", fn: "set_bridge_gateway" },
  { program: "kar-passport", fn: "set_staking_program" },
  { program: "kar-passport", fn: "mint_passport" },
  { program: "kar-passport", fn: "set_dispute_deposit" },
  { program: "kar-gateway", fn: "recover_locked_home" },
  { program: "kar-gateway", fn: "register_oapp" },
  { program: "kar-gateway", fn: "set_peer" },
  { program: "kar-gateway", fn: "init_lz_receive_types_accounts" },
  { program: "kar-pro-staking", fn: "set_min_stake_native" },
];

const HANDLER_FLOOR = 23;

/** Inline authority-key vs config-authority compares (must live only in admit owner). */
const INLINE_AUTHORITY_EQ =
  /cfg\.authority\s*!=\s*authority|authority\.key\.to_bytes\(\)\s*!=\s*cfg\.authority|asc\.authority\s*!=\s*authority|authority\.key\s*!=\s*cfg\.authority|authority_key\s*!=\s*expected_authority/;

function ixPath(program: string): string {
  return path.join(SVM, "programs", program, "src", "ix.rs");
}

export function handlerSourcePath(program: string, fn: string): string {
  if (fn === "init_lz_receive_types_accounts") {
    return path.join(SVM, "programs/kar-gateway/src/lz_receive_v2.rs");
  }
  if (
    program === "kar-passport" ||
    program === "kar-gateway" ||
    program === "kar-pro-staking"
  ) {
    return path.join(SVM, "programs", program, "src", "entrypoint.rs");
  }
  return ixPath(program);
}

/** Extract `fn name` body until the next top-level `fn ` at column 0. */
export function extractFnBody(src: string, fnName: string): string {
  const marker = `\nfn ${fnName}(`;
  let idx = src.indexOf(marker);
  if (idx < 0) {
    idx = src.indexOf(`fn ${fnName}(`);
    if (idx < 0) {
      throw new Error(`handler fn ${fnName} not found`);
    }
  } else {
    idx += 1; // skip leading newline
  }
  const from = src.slice(idx);
  const next = from.search(/\nfn [a-z_]/);
  const body = next < 0 ? from : from.slice(0, next);
  return body;
}

export function handlerCallsOwner(body: string): boolean {
  return body.includes("require_config_authority(");
}

export function handlerHasInlineAuthorityEq(body: string): boolean {
  return INLINE_AUTHORITY_EQ.test(body);
}

/** Signer-only gate without config authority equality (plant class). */
export function handlerSignerOnlyWithoutAuthority(body: string): boolean {
  const hasSigner = /authority\.is_signer|!authority\.is_signer/.test(body);
  const hasOwner = handlerCallsOwner(body);
  const hasInlineEq = handlerHasInlineAuthorityEq(body);
  return hasSigner && !hasOwner && !hasInlineEq;
}

export function deriveRequiredHandlers(
  catalog: ReadonlyArray<{ program: string; fn: string }>,
): ReadonlyArray<{ program: string; fn: string }> {
  return catalog.filter((row) => {
    const src = fs.readFileSync(handlerSourcePath(row.program, row.fn), "utf8");
    return src.includes(`fn ${row.fn}(`);
  });
}

export function findAuthorityOwnerViolations(
  rows: ReadonlyArray<{ program: string; fn: string }>,
  readSrc: (program: string, fn: string) => string = (p, fn) =>
    fs.readFileSync(handlerSourcePath(p, fn), "utf8"),
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const body = extractFnBody(readSrc(row.program, row.fn), row.fn);
    if (!handlerCallsOwner(body)) {
      out.push(`${row.program}::${row.fn} binds authority-class and skips require_config_authority`);
    }
  }
  return out;
}

export function findInlineAuthorityEqViolations(
  rows: ReadonlyArray<{ program: string; fn: string }>,
  readSrc: (program: string, fn: string) => string = (p, fn) =>
    fs.readFileSync(handlerSourcePath(p, fn), "utf8"),
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const body = extractFnBody(readSrc(row.program, row.fn), row.fn);
    if (handlerHasInlineAuthorityEq(body)) {
      out.push(
        `${row.program}::${row.fn} compares authority key outside kargain-config-authority admit`,
      );
    }
  }
  return out;
}

describe("svm-mode-config-authority-policy", () => {
  it("kargain-config-authority owns admit with named refusals", () => {
    const src = fs.readFileSync(ADMIT, "utf8");
    assert.ok(src.includes("pub fn admit_config_authority("), "pure admit");
    assert.ok(
      src.includes("MissingRequiredSignature"),
      "unsigned → MissingRequiredSignature",
    );
    assert.ok(
      /KargainError::NotOwner|NotOwner/.test(src),
      "wrong key → NotOwner",
    );
    assert.ok(
      !src.includes("InvalidSeeds"),
      "PDA stays outside pure admit",
    );
  });

  it("consignment-base wraps PDA then calls admit; no local admit body", () => {
    const src = fs.readFileSync(BASE, "utf8");
    assert.ok(src.includes("pub fn require_config_authority("), "AccountInfo wrapper");
    assert.ok(
      src.includes("admit_config_authority("),
      "wrapper calls pure admit",
    );
    assert.ok(
      !src.includes("pub fn admit_config_authority("),
      "pure admit must not live in consignment-base",
    );
    assert.ok(src.includes("InvalidSeeds"), "mode config PDA stays here");
  });

  it("passport require_config_authority calls admit; no local key compare", () => {
    const src = fs.readFileSync(PASSPORT_ENTRY, "utf8");
    const body = extractFnBody(src, "require_config_authority");
    assert.ok(
      body.includes("admit_config_authority("),
      "passport consumes admit owner",
    );
    assert.ok(
      !handlerHasInlineAuthorityEq(body),
      "passport must not inline authority equality",
    );
  });

  it("gateway require_config_authority calls admit; no local key compare", () => {
    const src = fs.readFileSync(GATEWAY_CONFIG, "utf8");
    const body = extractFnBody(src, "require_config_authority");
    assert.ok(body.includes("admit_config_authority("), "gateway consumes admit");
    assert.ok(!handlerHasInlineAuthorityEq(body), "gateway wrapper has no inline eq");
  });

  it("staking require_config_authority calls admit; no local key compare", () => {
    const src = fs.readFileSync(STAKING_ENTRY, "utf8");
    const body = extractFnBody(src, "require_config_authority");
    assert.ok(body.includes("admit_config_authority("), "staking consumes admit");
    assert.ok(!handlerHasInlineAuthorityEq(body), "staking wrapper has no inline eq");
  });

  it("derives the handler set from Rust with a non-empty floor", () => {
    const derived = deriveRequiredHandlers(REQUIRED_HANDLERS);
    assert.ok(
      derived.length >= HANDLER_FLOOR,
      `empty or short derivation: got ${derived.length}, floor ${HANDLER_FLOOR}`,
    );
    assert.equal(
      derived.length,
      REQUIRED_HANDLERS.length,
      "catalog entry missing from programs",
    );
  });

  it("empty derivation is red", () => {
    const empty = deriveRequiredHandlers([]);
    assert.equal(empty.length, 0);
    assert.throws(
      () => {
        assert.ok(
          empty.length >= HANDLER_FLOOR,
          `empty derivation: got ${empty.length}, floor ${HANDLER_FLOOR}`,
        );
      },
      (err: unknown) => /empty derivation/.test(String(err)),
    );
  });

  it("every derived handler calls require_config_authority", () => {
    const derived = deriveRequiredHandlers(REQUIRED_HANDLERS);
    const violations = findAuthorityOwnerViolations(derived);
    assert.equal(violations.join("\n"), "", violations.join("\n"));
  });

  it("no derived handler inlines authority-key equality", () => {
    const derived = deriveRequiredHandlers(REQUIRED_HANDLERS);
    const violations = findInlineAuthorityEqViolations(derived);
    assert.equal(violations.join("\n"), "", violations.join("\n"));
  });

  it("ascending no longer defines a private require_config_authority", () => {
    const src = fs.readFileSync(ixPath("kar-ascending"), "utf8");
    assert.ok(
      !src.includes("\nfn require_config_authority("),
      "local twin must stay deleted",
    );
    assert.ok(src.includes("require_config_authority("), "shared owner consumed");
  });

  it("plant: handler binds authority and skips the owner (red then green)", () => {
    const dirty = `
fn bind_passport_program(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let _ = authority;
    Ok(())
}
`;
    const clean = `
fn bind_passport_program(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let cfg = load_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    Ok(())
}
`;
    assert.equal(handlerCallsOwner(dirty), false, "planted skip must be red");
    assert.equal(handlerCallsOwner(clean), true, "owner call is green");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mode-auth-"));
    const plantedPath = path.join(dir, "ix.rs");
    fs.writeFileSync(plantedPath, dirty);
    const plantedSrc = fs.readFileSync(plantedPath, "utf8");
    const plantedBody = extractFnBody(plantedSrc, "bind_passport_program");
    const msg =
      "kar-fixed-price::bind_passport_program binds authority-class and skips require_config_authority";
    const violations = findAuthorityOwnerViolations(
      [{ program: "kar-fixed-price", fn: "bind_passport_program" }],
      () => plantedSrc,
    );
    assert.ok(violations.some((v) => v.includes("skips require_config_authority")), msg);
    assert.equal(handlerCallsOwner(plantedBody), false);
    fs.rmSync(dir, { recursive: true, force: true });

    assert.equal(
      findAuthorityOwnerViolations([
        { program: "kar-fixed-price", fn: "bind_passport_program" },
      ]).length,
      0,
      "live bind_passport_program is green",
    );
  });

  it("plant: handler checks is_signer but not config authority (red then green)", () => {
    const dirty = `
fn force_recall_at(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}
`;
    const clean = `
fn force_recall_at(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    let cfg = load_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    Ok(())
}
`;
    assert.equal(
      handlerSignerOnlyWithoutAuthority(dirty),
      true,
      "planted signer-only must be red",
    );
    assert.equal(
      handlerSignerOnlyWithoutAuthority(clean),
      false,
      "owner call clears signer-only plant",
    );
    assert.equal(handlerCallsOwner(clean), true);
  });

  it("plant: inline authority.key != cfg.authority in handler (red then green)", () => {
    const dirty = `
fn bind_passport_program(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let cfg = load_config(config)?;
    if authority.key.to_bytes() != cfg.authority {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}
`;
    const clean = `
fn bind_passport_program(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let cfg = load_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    Ok(())
}
`;
    assert.equal(
      handlerHasInlineAuthorityEq(dirty),
      true,
      "planted inline equality must be red",
    );
    assert.equal(
      handlerHasInlineAuthorityEq(clean),
      false,
      "owner call clears inline equality plant",
    );
    const violations = findInlineAuthorityEqViolations(
      [{ program: "kar-fixed-price", fn: "bind_passport_program" }],
      () => dirty,
    );
    assert.ok(
      violations.some((v) => v.includes("compares authority key outside")),
      "violation message names the class",
    );
    assert.equal(
      findInlineAuthorityEqViolations([
        { program: "kar-fixed-price", fn: "bind_passport_program" },
      ]).length,
      0,
      "live bind_passport_program has no inline equality",
    );
  });
});
