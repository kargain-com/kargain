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
  decodeEncumbranceAnswer,
  decodeEncumbranceAnswerStrictFullyConsumedForTests,
  decodeEncumbranceAnswerWithFieldsForTests,
  decodePassportBinding,
  decodePassportBindingStrictFullyConsumedForTests,
  decodePassportBindingWithFieldsForTests,
  decodePassportConfig,
  decodePassportConfigWithFieldsForTests,
  decodePassportState,
  decodePassportStateStrictFullyConsumedForTests,
  decodePastRemainderMarkerForTests,
  decodeStakeAccount,
  decodeStakeAccountStrictFullyConsumedForTests,
  commerceConfigLayout,
  ascendingConfigLayout,
  decodeCommerceConfig,
  decodeAscendingConfig,
  encodePassportConfigAccount,
  encodePassportConfigWithSources,
  encumbranceAnswerLayout,
  hexToBytes,
  passportBindingLayout,
  passportConfigLayout,
  passportStateLayout,
  refuseRetiredStateLengthNames,
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

function decodeAnswerCounted(data: Uint8Array) {
  DECODE_EXERCISED += 1;
  return decodeEncumbranceAnswer(data);
}

function decodeBindingCounted(data: Uint8Array) {
  DECODE_EXERCISED += 1;
  return decodePassportBinding(data);
}

function decodeCommerceCounted(data: Uint8Array) {
  DECODE_EXERCISED += 1;
  return decodeCommerceConfig(data);
}

function decodeAscendingCounted(data: Uint8Array) {
  DECODE_EXERCISED += 1;
  return decodeAscendingConfig(data);
}

function loadManifest(): StateManifest {
  return JSON.parse(
    readFileSync(path.join(ROOT, MANIFEST_REL), "utf8"),
  ) as StateManifest;
}

const base58Expected = (hex: string) => encodeSvmPubkeyBytes(hexToBytes(hex));

describe("svm account-state decode policy", () => {
  it("manifest has eight layouts including mode configs + full PassportConfig", () => {
    const committed = loadManifest();
    assert.equal(committed.layouts.length, 8);
    assert.equal(committed.layouts[0]!.id, "kar-passport/PassportState");
    assert.equal(committed.layouts[0]!.goldenByteLength, 256);
    assert.ok(committed.layouts[0]!.modelledByteLength < 256);
    assert.equal(committed.layouts[1]!.id, "kar-pro-staking/StakeAccount");
    assert.equal(committed.layouts[1]!.goldenByteLength, 128);
    assert.ok(committed.layouts[1]!.modelledByteLength < 128);

    assert.equal(
      committed.layouts[2]!.id,
      "kargain-bonded-challenge/ChallengeAccount",
    );
    assert.equal(committed.layouts[2]!.goldenByteLength, 97);
    assert.equal(committed.layouts[2]!.modelledByteLength, 97);

    assert.equal(committed.layouts[3]!.id, "kar-passport/PassportConfig");
    assert.ok(
      committed.layouts[3]!.fields.some(
        (f) => f.name === "namespace" && f.type === "u128",
      ),
    );
    assert.ok(
      committed.layouts[3]!.fields.some(
        (f) => f.name === "encumbrance_sources" && f.type === "vec_encumbrance_source",
      ),
    );
    assert.equal(committed.layouts[3]!.fields.at(-1)?.name, "bump");
    assert.equal(
      committed.layouts[3]!.modelledByteLength,
      committed.layouts[3]!.goldenByteLength,
    );

    assert.equal(
      committed.layouts[4]!.id,
      "kargain-encumbrance/EncumbranceAnswer",
    );
    assert.equal(committed.layouts[4]!.goldenByteLength, 74);
    assert.equal(committed.layouts[4]!.modelledByteLength, 74);
    assert.equal(
      committed.layouts[5]!.id,
      "kargain-consignment-base/PassportBinding",
    );
    assert.equal(committed.layouts[5]!.goldenByteLength, 41);
    assert.equal(committed.layouts[5]!.modelledByteLength, 41);

    assert.equal(
      committed.layouts[6]!.id,
      "kargain-consignment-base/CommerceConfig",
    );
    assert.equal(
      committed.layouts[6]!.goldenByteLength,
      committed.layouts[6]!.modelledByteLength,
    );
    assert.equal(committed.layouts[7]!.id, "kar-ascending/AscendingConfig");
    assert.equal(
      committed.layouts[7]!.goldenByteLength,
      committed.layouts[7]!.modelledByteLength,
    );

    const layouts = stateManifestLayouts();
    assert.equal(layouts.length, 8);
    assert.deepEqual(layouts[0], passportStateLayout());
    assert.deepEqual(layouts[1], stakeAccountLayout());
    assert.deepEqual(layouts[2], challengeAccountLayout());
    assert.deepEqual(layouts[3], passportConfigLayout());
    assert.deepEqual(layouts[4], encumbranceAnswerLayout());
    assert.deepEqual(layouts[5], passportBindingLayout());
    assert.deepEqual(layouts[6], commerceConfigLayout());
    assert.deepEqual(layouts[7], ascendingConfigLayout());

    const raw = readFileSync(path.join(ROOT, MANIFEST_REL), "utf8");
    assert.doesNotMatch(raw, /"accountSpace"/);
    assert.doesNotMatch(raw, /"payloadLen"/);
    assert.match(raw, /"goldenByteLength"/);
    assert.match(raw, /"modelledByteLength"/);
  });

  it("padded golden PassportState decodes; record_count matches sample", () => {
    const layout = passportStateLayout();
    const golden = hexToBytes(layout.goldenHex);
    assert.equal(golden.length, layout.goldenByteLength);

    const decoded = decodePassportCounted(golden);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.bytesRead, layout.modelledByteLength);
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
    assert.equal(golden.length, layout.goldenByteLength);

    const decoded = decodeStakeCounted(golden);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.bytesRead, layout.modelledByteLength);
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
    assert.equal(golden.length, layout.goldenByteLength);
    assert.equal(layout.modelledByteLength, layout.goldenByteLength);

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

  it("full PassportConfig golden decodes authority, namespace, sources, bump", () => {
    const layout = passportConfigLayout();
    const golden = hexToBytes(layout.goldenHex);
    assert.equal(golden.length, layout.goldenByteLength);
    assert.equal(layout.modelledByteLength, golden.length);

    const decoded = decodeConfigCounted(golden);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.bytesRead, layout.modelledByteLength);
    assert.equal(decoded.value.disputeDeposit, 10_000_000n);
    assert.equal(decoded.value.namespace, 2_000_040_168n);
    assert.equal(decoded.value.bump, 252);
    assert.equal(decoded.value.encumbranceSources.length, 1);
    assert.equal(decoded.value.encumbranceSources[0]!.seedPrefix, "ans");
    const expectedForfeit = base58Expected(
      String(layout.sample.forfeit_recipient),
    );
    assert.equal(decoded.value.forfeitRecipient, expectedForfeit);
    const expectedAuth = base58Expected(String(layout.sample.authority));
    assert.equal(decoded.value.authority, expectedAuth);
    const roundTrip = encodePassportConfigAccount(decoded.value);
    assert.ok(bytesEqual(roundTrip, golden), "encodePassportConfigAccount ≡ golden");
  });

  it("planted field after remainder_unmodelled refuses (marker must be terminal)", () => {
    const layout = passportConfigLayout();
    const golden = hexToBytes(layout.goldenHex);
    const planted: StateFieldDecl[] = [
      { name: "discriminator", type: "fixed_bytes", len: 8 },
      { name: "remainder", type: "remainder_unmodelled" },
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
    // Synthetic partial: stop at forfeit, then marker, then next_token_id plant.
    const plantedFields: StateFieldDecl[] = [
      { name: "discriminator", type: "fixed_bytes", len: 8 },
      { name: "authority", type: "fixed_bytes", len: 32 },
      { name: "namespace", type: "u128" },
      { name: "local_eid", type: "u32" },
      { name: "endpoint_program", type: "fixed_bytes", len: 32 },
      { name: "dispute_deposit", type: "u64" },
      { name: "staking_program", type: "fixed_bytes", len: 32 },
      { name: "bridge_gateway", type: "fixed_bytes", len: 32 },
      { name: "forfeit_recipient", type: "fixed_bytes", len: 32 },
      { name: "remainder", type: "remainder_unmodelled" },
      { name: "next_token_id", type: "fixed_bytes", len: 32 },
    ];
    const plantedLayout = { ...layout, fields: plantedFields };
    const past = decodePastRemainderMarkerForTests(golden, plantedLayout);
    assert.equal(past.ok, true, "plant keeps reading after marker");
    if (!past.ok) return;
    const honestPrefix = 196;
    assert.ok(
      past.bytesRead > honestPrefix,
      "past-marker plant must consume beyond forfeit prefix",
    );
    const honest = decodeConfigCounted(golden);
    assert.equal(honest.ok, true);
    if (!honest.ok) return;
    assert.equal(honest.bytesRead, layout.modelledByteLength);
    assert.notEqual(past.bytesRead, honest.bytesRead);
  });

  it("omitted-u128 for namespace fails later field offsets (not merely unsupported_type)", () => {
    const layout = passportConfigLayout();
    const golden = hexToBytes(layout.goldenHex);
    const honest = decodeConfigCounted(golden);
    assert.equal(honest.ok, true);
    if (!honest.ok) return;

    // Plant: drop namespace so the cursor never advances 16 bytes — truncates
    // before bump when the live layout is fully modelled.
    const omitted = layout.fields.filter((f) => f.name !== "namespace");
    const planted = decodePassportConfigWithFieldsForTests(golden, omitted);
    assert.equal(planted.ok, false, "omitted-u128 must truncate before bump");
    if (planted.ok) return;
    assert.equal(planted.cause, "truncated");
  });

  it("CommerceConfig + AscendingConfig goldens decode full surfaces", () => {
    const commerce = commerceConfigLayout();
    const commerceDecoded = decodeCommerceCounted(hexToBytes(commerce.goldenHex));
    assert.equal(commerceDecoded.ok, true);
    if (!commerceDecoded.ok) return;
    assert.equal(commerceDecoded.value.platformFeeBps, 10);
    assert.equal(commerceDecoded.value.paused, false);
    assert.equal(commerceDecoded.value.selfEncumbranceRegisteredRetired, true);
    assert.equal(commerceDecoded.value.bump, 250);

    const ascending = ascendingConfigLayout();
    const ascDecoded = decodeAscendingCounted(hexToBytes(ascending.goldenHex));
    assert.equal(ascDecoded.ok, true);
    if (!ascDecoded.ok) return;
    assert.equal(ascDecoded.value.challengeBond, 1_000_000n);
    assert.equal(ascDecoded.value.challengeWindow, 1_209_600n);
    assert.equal(ascDecoded.value.challengeConfigured, true);
    assert.equal(ascDecoded.value.bump, 249);
  });

  it("encodePassportConfigWithSources round-trips via decoder (no offset dual path)", () => {
    const layout = passportConfigLayout();
    const golden = hexToBytes(layout.goldenHex);
    const decoded = decodePassportConfig(golden);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    const rebuilt = encodePassportConfigWithSources(golden, [
      {
        programIdBytes: decoded.value.encumbranceSources[0]!.programIdBytes,
        seedPrefixBytes: new TextEncoder().encode("fp-ans"),
      },
    ]);
    const again = decodePassportConfig(rebuilt);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.value.encumbranceSources.length, 1);
    assert.equal(again.value.encumbranceSources[0]!.seedPrefix, "fp-ans");
    assert.equal(again.value.disputeDeposit, decoded.value.disputeDeposit);
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

    const payloadOnly = golden.subarray(0, layout.modelledByteLength);
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

    const payloadOnly = golden.subarray(0, layout.modelledByteLength);
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

  it("exact golden EncumbranceAnswer decodes funder base58; fully-consumed green", () => {
    const layout = encumbranceAnswerLayout();
    const golden = hexToBytes(layout.goldenHex);
    assert.equal(golden.length, 74);
    assert.equal(golden.length, layout.goldenByteLength);
    assert.equal(layout.modelledByteLength, layout.goldenByteLength);

    const decoded = decodeAnswerCounted(golden);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.bytesRead, 74);
    assert.equal(decoded.value.intent, 0);
    assert.equal(decoded.value.allowed, false);
    assert.equal(decoded.value.funder, base58Expected(String(layout.sample.funder)));
    assert.ok(
      bytesEqual(decoded.value.tokenId, hexToBytes(String(layout.sample.token_id))),
    );

    const strict = decodeEncumbranceAnswerStrictFullyConsumedForTests(golden);
    assert.equal(strict.ok, true, "exact SPACE golden must fully consume");

    const withTrailing = new Uint8Array(golden.length + 1);
    withTrailing.set(golden);
    withTrailing[golden.length] = 0xff;
    const trailing = decodeEncumbranceAnswerStrictFullyConsumedForTests(
      withTrailing,
    );
    assert.equal(trailing.ok, false, "trailing byte must refuse fully-consumed");
    if (trailing.ok) return;
    assert.equal(trailing.cause, "malformed_field");
    assert.match(trailing.detail, /trailing_bytes:1/);
  });

  it("exact golden PassportBinding decodes program + bump; fully-consumed green", () => {
    const layout = passportBindingLayout();
    const golden = hexToBytes(layout.goldenHex);
    assert.equal(golden.length, 41);
    assert.equal(golden.length, layout.goldenByteLength);
    assert.equal(layout.modelledByteLength, layout.goldenByteLength);

    const decoded = decodeBindingCounted(golden);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.bytesRead, 41);
    assert.equal(decoded.value.bump, 255);
    assert.equal(
      decoded.value.passportProgram,
      base58Expected(String(layout.sample.passport_program)),
    );

    const strict = decodePassportBindingStrictFullyConsumedForTests(golden);
    assert.equal(strict.ok, true, "exact SPACE golden must fully consume");

    const withTrailing = new Uint8Array(golden.length + 1);
    withTrailing.set(golden);
    withTrailing[golden.length] = 0xff;
    const trailing = decodePassportBindingStrictFullyConsumedForTests(withTrailing);
    assert.equal(trailing.ok, false);
    if (trailing.ok) return;
    assert.equal(trailing.cause, "malformed_field");
    assert.match(trailing.detail, /trailing_bytes:1/);
  });

  it("planted swapped field order / truncated / wrong disc refuse EncumbranceAnswer", () => {
    const layout = encumbranceAnswerLayout();
    const golden = hexToBytes(layout.goldenHex);
    const honest = decodeAnswerCounted(golden);
    assert.equal(honest.ok, true);
    if (!honest.ok) return;

    const swapped: StateFieldDecl[] = [
      layout.fields[0]!,
      layout.fields[2]!,
      layout.fields[1]!,
      layout.fields[3]!,
      layout.fields[4]!,
    ];
    const planted = decodeEncumbranceAnswerWithFieldsForTests(golden, swapped);
    if (planted.ok) {
      assert.notEqual(
        planted.value.intent,
        honest.value.intent,
        "swapped field order must not reproduce honest intent",
      );
    } else {
      assert.ok(
        planted.cause === "truncated" ||
          planted.cause === "malformed_field" ||
          planted.cause === "discriminator_mismatch",
      );
    }

    const short = golden.subarray(0, 20);
    const truncated = decodeAnswerCounted(short);
    assert.equal(truncated.ok, false);
    if (!truncated.ok) {
      assert.equal(truncated.cause, "truncated");
    }

    const flipped = new Uint8Array(golden);
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    const wrongDisc = decodeAnswerCounted(flipped);
    assert.equal(wrongDisc.ok, false);
    if (!wrongDisc.ok) {
      assert.equal(wrongDisc.cause, "discriminator_mismatch");
    }
  });

  it("planted swapped field order / truncated / wrong disc refuse PassportBinding", () => {
    const layout = passportBindingLayout();
    const golden = hexToBytes(layout.goldenHex);
    const honest = decodeBindingCounted(golden);
    assert.equal(honest.ok, true);
    if (!honest.ok) return;

    const swapped: StateFieldDecl[] = [
      layout.fields[0]!,
      layout.fields[2]!,
      layout.fields[1]!,
    ];
    const planted = decodePassportBindingWithFieldsForTests(golden, swapped);
    if (planted.ok) {
      assert.notEqual(
        planted.value.bump,
        honest.value.bump,
        "swapped field order must not reproduce honest bump",
      );
    } else {
      assert.ok(
        planted.cause === "truncated" ||
          planted.cause === "malformed_field" ||
          planted.cause === "discriminator_mismatch",
      );
    }

    const short = golden.subarray(0, 10);
    const truncated = decodeBindingCounted(short);
    assert.equal(truncated.ok, false);
    if (!truncated.ok) {
      assert.equal(truncated.cause, "truncated");
    }

    const flipped = new Uint8Array(golden);
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    const wrongDisc = decodeBindingCounted(flipped);
    assert.equal(wrongDisc.ok, false);
    if (!wrongDisc.ok) {
      assert.equal(wrongDisc.cause, "discriminator_mismatch");
    }
  });

  it("planted accountSpace / payloadLen layout refuses retired_length_name", () => {
    const live = passportStateLayout();
    const liveOk = refuseRetiredStateLengthNames({ ...live });
    assert.equal(liveOk.ok, true);

    const plantedSpace = {
      ...live,
      accountSpace: live.goldenByteLength,
    };
    const space = refuseRetiredStateLengthNames(plantedSpace);
    assert.equal(space.ok, false);
    if (!space.ok) {
      assert.equal(space.cause, "retired_length_name");
      assert.match(space.detail, /accountSpace/);
    }

    const plantedPayload = {
      ...live,
      payloadLen: live.modelledByteLength,
    };
    const payload = refuseRetiredStateLengthNames(plantedPayload);
    assert.equal(payload.ok, false);
    if (!payload.ok) {
      assert.equal(payload.cause, "retired_length_name");
      assert.match(payload.detail, /payloadLen/);
    }
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
          /decodePassportState|decodeStakeAccount|decodeChallengeAccount|decodePassportConfig|decodeEncumbranceAnswer|decodePassportBinding|decode-account-state|getAccountInfo|fetchProductSvmAccountData/.test(
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
