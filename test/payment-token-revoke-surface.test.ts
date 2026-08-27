import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  RESTORE_PAYMENT_TOKEN_HINT,
  deriveGuardianRevokeControl,
  revokeBlockCauseCopy,
  revokePaymentTokenConfirmCopy,
} from "../lib/commerce/payment-token-revoke-surface.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPS_PAGE = path.join(ROOT, "app/(identity)/ops/commerce-pause/page.tsx");
const REVOKE_SECTION = path.join(
  ROOT,
  "components/commerce/commerce-revoke-ops-section.tsx",
);
const REVOKE_ROW = path.join(
  ROOT,
  "components/commerce/commerce-revoke-token-row.tsx",
);

const GUARDIAN = "0x1111111111111111111111111111111111111111" as const;
const OWNER = "0x2222222222222222222222222222222222222222" as const;
const STRANGER = "0x3333333333333333333333333333333333333333" as const;

describe("deriveGuardianRevokeControl", () => {
  it("guardian + enabled → available", () => {
    const control = deriveGuardianRevokeControl({
      connected: GUARDIAN,
      guardian: GUARDIAN,
      owner: OWNER,
      enabled: true,
    });
    assert.deepEqual(control, {
      role: "guardian",
      revoke: { status: "available" },
      showRestoreHint: false,
    });
  });

  it("owner-address match → no wallet CTA (Timelock ≠ MetaMask)", () => {
    const control = deriveGuardianRevokeControl({
      connected: OWNER,
      guardian: GUARDIAN,
      owner: OWNER,
      enabled: true,
    });
    assert.equal(control.role, "owner");
    assert.deepEqual(control.revoke, {
      status: "blocked",
      cause: "not_guardian",
    });
  });

  it("stranger refused with not_guardian", () => {
    const control = deriveGuardianRevokeControl({
      connected: STRANGER,
      guardian: GUARDIAN,
      owner: OWNER,
      enabled: true,
    });
    assert.equal(control.role, "other");
    assert.deepEqual(control.revoke, {
      status: "blocked",
      cause: "not_guardian",
    });
  });

  it("disconnected refused with disconnected", () => {
    const control = deriveGuardianRevokeControl({
      connected: null,
      guardian: GUARDIAN,
      owner: OWNER,
      enabled: true,
    });
    assert.equal(control.role, "disconnected");
    assert.deepEqual(control.revoke, {
      status: "blocked",
      cause: "disconnected",
    });
  });

  it("already revoked → token_not_enabled + restore hint", () => {
    const control = deriveGuardianRevokeControl({
      connected: GUARDIAN,
      guardian: GUARDIAN,
      owner: OWNER,
      enabled: false,
    });
    assert.deepEqual(control.revoke, {
      status: "blocked",
      cause: "token_not_enabled",
    });
    assert.equal(control.showRestoreHint, true);
  });

  it("unread enabled → reads_unresolved", () => {
    const control = deriveGuardianRevokeControl({
      connected: GUARDIAN,
      guardian: GUARDIAN,
      owner: OWNER,
      enabled: undefined,
    });
    assert.deepEqual(control.revoke, {
      status: "blocked",
      cause: "reads_unresolved",
    });
  });

  it("matches guardian case-insensitively", () => {
    const control = deriveGuardianRevokeControl({
      connected: GUARDIAN.toLowerCase(),
      guardian: GUARDIAN,
      owner: OWNER,
      enabled: true,
    });
    assert.equal(control.revoke.status, "available");
  });
});

describe("revoke confirmation and restore hint", () => {
  it("confirm copy states stop vs continue and no approve", () => {
    const copy = revokePaymentTokenConfirmCopy({
      mode: "fixedPrice",
      chainLabel: "Base Sepolia",
      tokenLabel: "0xUsd…c001",
    });
    assert.match(copy.title, /Revoke/);
    assert.match(copy.body, /can no longer open/i);
    assert.match(copy.body, /still settle/i);
    assert.match(copy.body, /timelock/i);
    assert.match(copy.body, /no approve/i);
  });

  it("named cause copy for strangers and owner", () => {
    assert.match(revokeBlockCauseCopy("not_guardian"), /guardian/i);
    assert.match(revokeBlockCauseCopy("not_guardian"), /timelock/i);
    assert.match(revokeBlockCauseCopy("disconnected"), /Connect/i);
  });

  it("RESTORE_PAYMENT_TOKEN_HINT forbids approve on this page", () => {
    assert.match(RESTORE_PAYMENT_TOKEN_HINT, /timelock owner/);
    assert.match(RESTORE_PAYMENT_TOKEN_HINT, /no approve/i);
  });
});

describe("ops revoke consume policy — no approval path", () => {
  it("ops page and revoke UI never mention approvePaymentToken", () => {
    for (const file of [OPS_PAGE, REVOKE_SECTION, REVOKE_ROW]) {
      const text = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(
        text,
        /approvePaymentToken/,
        `${path.relative(ROOT, file)} must not offer approve`,
      );
    }
  });

  it("ops page mounts revoke section and keeps route", () => {
    const text = fs.readFileSync(OPS_PAGE, "utf8");
    assert.match(text, /CommerceRevokeOpsSection/);
    assert.match(text, /CommercePauseOpsClient/);
    assert.match(text, /Commerce ops/);
  });

  it("revoke row writes revokePaymentToken only", () => {
    const text = fs.readFileSync(REVOKE_ROW, "utf8");
    assert.match(text, /revokePaymentToken/);
    assert.match(text, /REVOKE_PAYMENT_TOKEN_HINT|RESTORE_PAYMENT_TOKEN_HINT/);
  });
});
