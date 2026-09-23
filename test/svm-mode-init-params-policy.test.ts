/**
 * Mode InitConfig parameter owner — named refusals + constant pins.
 * Plants are in-memory only (never write under scripts/).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ModeInitParamsRefusal,
  SVM_ASCENDING_CHALLENGE_BOND_LAMPORTS,
  platformEqualsForfeitAckLine,
  resolveModeInitParams,
} from "../scripts/lib/svm-mode-init-params.ts";
import { ASCENDING_CHALLENGE_WINDOW } from "../scripts/lib/verify-constructor-args.ts";
import { POLICY_SCAN_ROOT } from "./policy-scan-helpers.ts";

const ROOT = POLICY_SCAN_ROOT;
const OWNER_REL = "scripts/lib/svm-mode-init-params.ts";
const DOOR_REL = "scripts/svm-devnet-init-modes.ts";

const AUTH = "Auth111111111111111111111111111111111111111";
const PLATFORM = "Plat111111111111111111111111111111111111111";
const FORFEIT = "Forf111111111111111111111111111111111111111";
const GUARDIAN = "Guar111111111111111111111111111111111111111";

function envWith(roles: {
  platform?: string;
  forfeit?: string;
  guardian?: string;
}): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  delete e.SOLANA_PLATFORM_RECIPIENT;
  delete e.SOLANA_FORFEIT_RECIPIENT;
  delete e.SOLANA_GUARDIAN;
  if (roles.platform != null) e.SOLANA_PLATFORM_RECIPIENT = roles.platform;
  if (roles.forfeit != null) e.SOLANA_FORFEIT_RECIPIENT = roles.forfeit;
  if (roles.guardian != null) e.SOLANA_GUARDIAN = roles.guardian;
  return e;
}

describe("svm mode init params policy", () => {
  it("refuses missing platform recipient", () => {
    assert.throws(
      () =>
        resolveModeInitParams({
          authority: AUTH,
          allowPlatformEqualsForfeit: false,
          env: envWith({ forfeit: FORFEIT, guardian: GUARDIAN }),
        }),
      (e: unknown) =>
        e instanceof ModeInitParamsRefusal && e.cause === "missing_platform_recipient",
    );
  });

  it("refuses guardian equals authority", () => {
    assert.throws(
      () =>
        resolveModeInitParams({
          authority: AUTH,
          allowPlatformEqualsForfeit: false,
          env: envWith({
            platform: PLATFORM,
            forfeit: FORFEIT,
            guardian: AUTH,
          }),
        }),
      (e: unknown) =>
        e instanceof ModeInitParamsRefusal && e.cause === "guardian_equals_authority",
    );
  });

  it("refuses platform equals forfeit without ack; with flag green + ack line", () => {
    assert.throws(
      () =>
        resolveModeInitParams({
          authority: AUTH,
          allowPlatformEqualsForfeit: false,
          env: envWith({
            platform: PLATFORM,
            forfeit: PLATFORM,
            guardian: GUARDIAN,
          }),
        }),
      (e: unknown) =>
        e instanceof ModeInitParamsRefusal &&
        e.cause === "platform_equals_forfeit_without_ack",
    );

    const ok = resolveModeInitParams({
      authority: AUTH,
      allowPlatformEqualsForfeit: true,
      env: envWith({
        platform: PLATFORM,
        forfeit: PLATFORM,
        guardian: GUARDIAN,
      }),
    });
    assert.equal(ok.platformEqualsForfeitAcknowledged, true);
    assert.equal(
      platformEqualsForfeitAckLine(ok),
      `platform_equals_forfeit acknowledged ${PLATFORM}`,
    );
  });

  it("bond and window come from named exports; door consumes owner only", () => {
    const ok = resolveModeInitParams({
      authority: AUTH,
      allowPlatformEqualsForfeit: false,
      env: envWith({
        platform: PLATFORM,
        forfeit: FORFEIT,
        guardian: GUARDIAN,
      }),
    });
    assert.equal(ok.challengeBondLamports, SVM_ASCENDING_CHALLENGE_BOND_LAMPORTS);
    assert.equal(ok.challengeWindowSeconds, ASCENDING_CHALLENGE_WINDOW);
    assert.equal(SVM_ASCENDING_CHALLENGE_BOND_LAMPORTS, 1_000_000n);

    const door = readFileSync(join(ROOT, DOOR_REL), "utf8");
    assert.match(door, /resolveModeInitParams/);
    assert.match(door, /from ["'].*svm-mode-init-params/);
    assert.doesNotMatch(door, /challengeBond\s*=\s*1_000_000n/);
    assert.doesNotMatch(door, /stack\.forfeitRecipient/);
    assert.doesNotMatch(door, /guardian\s*=\s*authority\.publicKey/);

    const owner = readFileSync(join(ROOT, OWNER_REL), "utf8");
    assert.match(owner, /SVM_ASCENDING_CHALLENGE_BOND_LAMPORTS/);
    assert.match(owner, /guardian_equals_authority/);
  });
});
