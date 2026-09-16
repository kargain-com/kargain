/**
 * SVM account-state decode — TS cursor decoder vs committed Rust goldens
 * (U7 / U6.5 / U6.7.3).
 *
 * Goldens are authored solely by Rust BorshSerialize (`kargain-ix-wire` state
 * manifest). This suite never repairs or regenerates them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { encodeSvmPubkeyBytes } from "@/lib/web3/protocol-address";
import {
  bytesEqual,
  challengeAccountLayout,
  decodeChallengeAccount,
  decodeChallengeAccountStrictFullyConsumedForTests,
  decodePassportConfig,
  decodePassportConfigWithFieldsForTests,
  decodePassportState,
  decodePassportStateStrictFullyConsumedForTests,
  decodePastRemainderMarkerForTests,
  decodeStakeAccount,
  decodeStakeAccountStrictFullyConsumedForTests,
  hexToBytes,
  passportConfigLayout,
  passportStateLayout,
  stakeAccountLayout,
  stateManifestLayouts,
  type StateFieldDecl,
  type StateManifest,
} from "@/lib/svm/decode-account-state";
import {
  assertCleanProductScan,
  scanProductSources,
  type ProductSourcePredicate,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_REL = "svm/crates/kargain-ix-wire/state.manifest.json";
const DECODER_REL = "lib/svm/decode-account-state.ts";

/** Running count of product decode calls in this suite. */
let DECODE_EXERCISED = 0;

function decodePassportCounted(data: Uint8Array) {
  DECODE_EXERCISED += 1;
  return decodePassportState(data);
}

function decodeStakeCounted(data: Uint8Array) {
  DECODE_EXERCISED += 1;
  return decodeStakeAccount(data);
}

function decodeChallengeCounted(data: Uint8Array) {
  DECODE_EXERCISED += 1;
  return decodeChallengeAccount(data);
}

function decodeConfigCounted(data: Uint8Array) {
  DECODE_EXERCISED += 1;
  return decodePassportConfig(data);
}

function loadManifest(): StateManifest {
  return JSON.parse(
    readFileSync(path.join(ROOT, MANIFEST_REL), "utf8"),
  ) as StateManifest;
}

const base58Expected = (hex: string) => encodeSvmPubkeyBytes(hexToBytes(hex));

describe("svm account-state decode policy", () => {
  it("manifest has four layouts including ChallengeAccount + partial PassportConfig", () => {
    const committed = loadManifest();
    assert.equal(committed.layouts.length, 4);
    assert.equal(committed.layouts[0]!.id, "kar-passport/PassportState");
    assert.equal(committed.layouts[0]!.accountSpace, 256);
    assert.ok(committed.layouts[0]!.payloadLen < 256);
    assert.equal(committed.layouts[1]!.id, "kar-pro-staking/StakeAccount");
    assert.equal(committed.layouts[1]!.accountSpace, 128);
    assert.ok(committed.layouts[1]!.payloadLen < 128);

    assert.equal(
      committed.layouts[2]!.id,
      "kargain-bonded-challenge/ChallengeAccount",
    );
    assert.equal(committed.layouts[2]!.accountSpace, 97);
    assert.equal(committed.layouts[2]!.payloadLen, 97);

    assert.equal(committed.layouts[3]!.id, "kar-passport/PassportConfig");
    assert.ok(
      committed.layouts[3]!.fields.some(
        (f) => f.name === "namespace" && f.type === "u128",
      ),
    );
    assert.equal(
      committed.layouts[3]!.fields.at(-1)?.type,
      "remainder_unmodelled",
    );
    assert.ok(
      committed.layouts[3]!.payloadLen < committed.layouts[3]!.accountSpace,
      "PassportConfig accountSpace is variable-sample golden length; payload is modelled prefix",
    );

    const layouts = stateManifestLayouts();
    assert.equal(layouts.length, 4);
    assert.deepEqual(layouts[0], passportStateLayout());
    assert.deepEqual(layouts[1], stakeAccountLayout());
    assert.deepEqual(layouts[2], challengeAccountLayout());
    assert.deepEqual(layouts[3], passportConfigLayout());
  });

  it("padded golden PassportState decodes; record_count matches sample", () => {
    const layout = passportStateLayout();
    const golden = hexToBytes(layout.goldenHex);
    assert.equal(golden.length, layout.accountSpace);

    const decoded = decodePassportCounted(golden);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.bytesRead, layout.payloadLen);
    assert.ok(decoded.bytesRead < golden.length, "padding remains unread");
    assert.equal(decoded.value.recordCount, 7);
    assert.equal(decoded.value.status, 1);
    assert.equal(decoded.value.bump, 255);
    assert.equal(decoded.value.verifiedAt, 1_700_000_000n);
    assert.equal(decoded.value.custodyLocked, false);
    assert.equal(decoded.value.burned, false);
    assert.ok(
      bytesEqual(decoded.value.discriminator, hexToBytes(layout.discriminatorHex)),
    );
    assert.ok(
      bytesEqual(
        decoded.value.tokenId,
        hexToBytes(String(layout.sample.token_id)),
      ),
    );
  });

  it("padded golden StakeAccount decodes; product value is active only", () => {
    const layout = stakeAccountLayout();
    const golden = hexToBytes(layout.goldenHex);
    assert.equal(golden.length, layout.accountSpace);

    const decoded = decodeStakeCounted(golden);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.bytesRead, layout.payloadLen);
    assert.ok(decoded.bytesRead < golden.length, "padding remains unread");
    assert.equal(decoded.value.active, true);
    assert.equal(
      Object.keys(decoded.value).sort().join(","),
      "active",
      "StakeAccountDecoded must expose only active",
    );
    assert.equal("amount" in decoded.value, false);
    assert.equal("unlock_at" in decoded.value, false);
    assert.equal("verification_fee" in decoded.value, false);
  });

  it("exact golden ChallengeAccount decodes; challenger is base58; fully-consumed green", () => {
    const layout = challengeAccountLayout();
    const golden = hexToBytes(layout.goldenHex);
    assert.equal(golden.length, 97);
    assert.equal(golden.length, layout.accountSpace);
    assert.equal(layout.payloadLen, layout.accountSpace);

    const decoded = decodeChallengeCounted(golden);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.bytesRead, 97);
    assert.equal(
      Object.keys(decoded.value).sort().join(","),
      "challenger",
    );
    const expected = base58Expected(String(layout.sample.challenger));
    assert.equal(decoded.value.challenger, expected);

    const strict = decodeChallengeAccountStrictFullyConsumedForTests(golden);
    assert.equal(strict.ok, true, "exact SPACE golden must fully consume");

    const withTrailing = new Uint8Array(golden.length + 1);
    withTrailing.set(golden);
    withTrailing[golden.length] = 0xff;
    const trailing = decodeChallengeAccountStrictFullyConsumedForTests(
      withTrailing,
    );
    assert.equal(trailing.ok, false, "trailing byte must refuse fully-consumed");
    if (trailing.ok) return;
    assert.equal(trailing.cause, "malformed_field");
    assert.match(trailing.detail, /trailing_bytes:1/);
  });

  it("partial PassportConfig golden decodes deposit + forfeit; stops at marker", () => {
    const layout = passportConfigLayout();
    const golden = hexToBytes(layout.goldenHex);
    assert.equal(golden.length, layout.accountSpace);
    assert.ok(layout.payloadLen < golden.length);

    const decoded = decodeConfigCounted(golden);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.bytesRead, layout.payloadLen);
    assert.ok(
      decoded.bytesRead < golden.length,
      "unmodelled structured remainder stays unread",
    );
    assert.equal(decoded.value.disputeDeposit, 10_000_000n);
    const expectedForfeit = base58Expected(
      String(layout.sample.forfeit_recipient),
    );
    assert.equal(decoded.value.forfeitRecipient, expectedForfeit);
    assert.equal(
      Object.keys(decoded.value).sort().join(","),
      "disputeDeposit,forfeitRecipient",
    );
    assert.equal("authority" in decoded.value, false);
    assert.equal("namespace" in decoded.value, false);
    assert.equal("bump" in decoded.value, false);
  });

  it("planted field after remainder_unmodelled refuses (marker must be terminal)", () => {
    const layout = passportConfigLayout();
    const golden = hexToBytes(layout.goldenHex);
    const planted: StateFieldDecl[] = [
      ...layout.fields,
      { name: "bump", type: "u8" },
    ];
    const decoded = decodePassportConfigWithFieldsForTests(golden, planted);
    assert.equal(decoded.ok, false);
    if (decoded.ok) return;
    assert.equal(decoded.cause, "unsupported_type");
    assert.match(decoded.detail, /remainder_unmodelled_not_terminal/);
  });

  it("planted decode-past-marker walks unmodelled bytes (RED control)", () => {
    const layout = passportConfigLayout();
    const golden = hexToBytes(layout.goldenHex);
    const plantedFields: StateFieldDecl[] = [
      ...layout.fields.filter((f) => f.type !== "remainder_unmodelled"),
      { name: "remainder", type: "remainder_unmodelled" },
      { name: "next_token_id", type: "fixed_bytes", len: 32 },
    ];
    const plantedLayout = { ...layout, fields: plantedFields };
    const past = decodePastRemainderMarkerForTests(golden, plantedLayout);
    assert.equal(past.ok, true, "plant keeps reading after marker");
    if (!past.ok) return;
    assert.ok(
      past.bytesRead > layout.payloadLen,
      "past-marker plant must consume beyond modelled prefix",
    );
    // Honest product decode must not match the planted bytesRead.
    const honest = decodeConfigCounted(golden);
    assert.equal(honest.ok, true);
    if (!honest.ok) return;
    assert.equal(honest.bytesRead, layout.payloadLen);
    assert.notEqual(past.bytesRead, honest.bytesRead);
  });

  it("omitted-u128 for namespace fails later field offsets (not merely unsupported_type)", () => {
    const layout = passportConfigLayout();
    const golden = hexToBytes(layout.goldenHex);
    const honest = decodeConfigCounted(golden);
    assert.equal(honest.ok, true);
    if (!honest.ok) return;

    // Plant: drop namespace from the field list so the cursor never advances 16 bytes.
    const omitted = layout.fields.filter((f) => f.name !== "namespace");
    const planted = decodePassportConfigWithFieldsForTests(golden, omitted);
    assert.equal(planted.ok, true, "plant still 'decodes' with wrong offsets");
    if (!planted.ok) return;

    assert.notEqual(
      planted.value.disputeDeposit,
      honest.value.disputeDeposit,
      `omitted-u128 must shift dispute_deposit offset (honest=${honest.value.disputeDeposit} planted=${planted.value.disputeDeposit})`,
    );
    assert.notEqual(
      planted.value.forfeitRecipient,
      honest.value.forfeitRecipient,
      `omitted-u128 must shift forfeit_recipient offset (honest=${honest.value.forfeitRecipient} planted=${planted.value.forfeitRecipient})`,
    );
  });

  it("planted missing u128 type case refuses namespace as unsupported_type", () => {
    const layout = passportConfigLayout();
    const golden = hexToBytes(layout.goldenHex);
    const plantedFields = layout.fields.map((f) =>
      f.name === "namespace" ? { ...f, type: "u128_missing_plant" } : f,
    );
    const planted = decodePassportConfigWithFieldsForTests(golden, plantedFields);
    assert.equal(planted.ok, false);
    if (planted.ok) return;
    assert.equal(planted.cause, "unsupported_type");
    assert.match(planted.detail, /namespace/);
  });

  it("truncated PassportConfig refuses by name", () => {
    const layout = passportConfigLayout();
    const golden = hexToBytes(layout.goldenHex);
    const short = golden.subarray(0, 40);
    const decoded = decodeConfigCounted(short);
    assert.equal(decoded.ok, false);
    if (decoded.ok) return;
    assert.equal(decoded.cause, "truncated");
  });

  it("PassportConfig discriminator mismatch refuses by name", () => {
    const layout = passportConfigLayout();
    const golden = hexToBytes(layout.goldenHex);
    const flipped = new Uint8Array(golden);
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    const decoded = decodeConfigCounted(flipped);
    assert.equal(decoded.ok, false);
    if (decoded.ok) return;
    assert.equal(decoded.cause, "discriminator_mismatch");
  });

  it("planted strict fully-consumed decoder refuses the padded PassportState golden (RED control)", () => {
    const layout = passportStateLayout();
    const golden = hexToBytes(layout.goldenHex);
    const cursor = decodePassportCounted(golden);
    assert.equal(cursor.ok, true, "cursor decode must accept padded account");

    const strict = decodePassportStateStrictFullyConsumedForTests(golden);
    assert.equal(strict.ok, false, "strict decoder must refuse trailing padding");
    if (strict.ok) return;
    assert.equal(strict.cause, "malformed_field");
    assert.match(strict.detail, /trailing_bytes:/);

    const payloadOnly = golden.subarray(0, layout.payloadLen);
    const strictPayload = decodePassportStateStrictFullyConsumedForTests(payloadOnly);
    assert.equal(strictPayload.ok, true);
  });

  it("planted strict fully-consumed decoder refuses the padded StakeAccount golden (RED control)", () => {
    const layout = stakeAccountLayout();
    const golden = hexToBytes(layout.goldenHex);
    const cursor = decodeStakeCounted(golden);
    assert.equal(cursor.ok, true, "cursor decode must accept padded stake");

    const strict = decodeStakeAccountStrictFullyConsumedForTests(golden);
    assert.equal(strict.ok, false, "strict decoder must refuse trailing padding");
    if (strict.ok) return;
    assert.equal(strict.cause, "malformed_field");
    assert.match(strict.detail, /trailing_bytes:/);

    const payloadOnly = golden.subarray(0, layout.payloadLen);
    const strictPayload = decodeStakeAccountStrictFullyConsumedForTests(payloadOnly);
    assert.equal(strictPayload.ok, true);
  });

  it("discriminator mismatch refuses by name", () => {
    const layout = passportStateLayout();
    const golden = hexToBytes(layout.goldenHex);
    const flipped = new Uint8Array(golden);
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    const decoded = decodePassportCounted(flipped);
    assert.equal(decoded.ok, false);
    if (decoded.ok) return;
    assert.equal(decoded.cause, "discriminator_mismatch");
  });

  it("truncated account refuses by name", () => {
    const layout = passportStateLayout();
    const golden = hexToBytes(layout.goldenHex);
    const short = golden.subarray(0, 8);
    const decoded = decodePassportCounted(short);
    assert.equal(decoded.ok, false);
    if (decoded.ok) return;
    assert.equal(decoded.cause, "truncated");
  });

  it("product sources never hand-decode account bytes or invent offsets", () => {
    const predicate: ProductSourcePredicate = (rel, text) => {
      if (rel === DECODER_REL) return false;
      if (
        /data\s*(?:\.\s*subarray|\.\s*slice)\s*\(\s*80\s*,\s*84\s*\)/.test(
          text,
        )
      ) {
        return `hand_account_offset (${rel})`;
      }
      if (
        rel.startsWith("app/") ||
        rel.startsWith("components/") ||
        rel.startsWith("hooks/")
      ) {
        if (
          /decodePassportState|decodeStakeAccount|decodeChallengeAccount|decodePassportConfig|decode-account-state|getAccountInfo|fetchProductSvmAccountData/.test(
            text,
          )
        ) {
          return `panel_account_read_or_decode (${rel})`;
        }
      }
      return false;
    };

    assertCleanProductScan(scanProductSources(predicate));
  });

  it("reports decode exercise count for the ship report", () => {
    assert.ok(
      DECODE_EXERCISED >= 10,
      `expected ≥10 decode exercises, got ${DECODE_EXERCISED}`,
    );
    console.log(`U7_DECODE_EXERCISED=${DECODE_EXERCISED}`);
  });
});
