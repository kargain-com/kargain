/**
 * SVM account-state decode — TS cursor decoder vs committed Rust goldens (U7).
 *
 * Goldens are authored solely by Rust BorshSerialize (`kargain-ix-wire` state
 * manifest). This suite never repairs or regenerates them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  bytesEqual,
  decodePassportState,
  decodePassportStateStrictFullyConsumedForTests,
  hexToBytes,
  passportStateLayout,
  stateManifestLayouts,
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

/** Running count of decodePassportState calls in this suite (report). */
let DECODE_EXERCISED = 0;

function decodeCounted(data: Uint8Array) {
  DECODE_EXERCISED += 1;
  return decodePassportState(data);
}

function loadManifest(): StateManifest {
  return JSON.parse(
    readFileSync(path.join(ROOT, MANIFEST_REL), "utf8"),
  ) as StateManifest;
}

describe("svm account-state decode policy", () => {
  it("manifest has PassportState only and matches module layout reader", () => {
    const committed = loadManifest();
    assert.equal(committed.layouts.length, 1);
    assert.equal(committed.layouts[0]!.id, "kar-passport/PassportState");
    assert.equal(committed.layouts[0]!.accountSpace, 256);
    assert.ok(committed.layouts[0]!.payloadLen < 256);

    const layouts = stateManifestLayouts();
    assert.equal(layouts.length, 1);
    assert.deepEqual(layouts[0], passportStateLayout());
    assert.equal(layouts[0]!.goldenHex.length, 512);
  });

  it("padded golden PassportState decodes; record_count matches sample", () => {
    const layout = passportStateLayout();
    const golden = hexToBytes(layout.goldenHex);
    assert.equal(golden.length, layout.accountSpace);

    const decoded = decodeCounted(golden);
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

  it("planted strict fully-consumed decoder refuses the padded golden (RED control)", () => {
    const layout = passportStateLayout();
    const golden = hexToBytes(layout.goldenHex);
    const cursor = decodeCounted(golden);
    assert.equal(cursor.ok, true, "cursor decode must accept padded account");

    const strict = decodePassportStateStrictFullyConsumedForTests(golden);
    assert.equal(strict.ok, false, "strict decoder must refuse trailing padding");
    if (strict.ok) return;
    assert.equal(strict.cause, "malformed_field");
    assert.match(strict.detail, /trailing_bytes:/);

    // Unpadded payload alone: strict succeeds (proves the plant targets padding).
    const payloadOnly = golden.subarray(0, layout.payloadLen);
    const strictPayload = decodePassportStateStrictFullyConsumedForTests(payloadOnly);
    assert.equal(strictPayload.ok, true);
  });

  it("discriminator mismatch refuses by name", () => {
    const layout = passportStateLayout();
    const golden = hexToBytes(layout.goldenHex);
    const flipped = new Uint8Array(golden);
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    const decoded = decodeCounted(flipped);
    assert.equal(decoded.ok, false);
    if (decoded.ok) return;
    assert.equal(decoded.cause, "discriminator_mismatch");
  });

  it("truncated account refuses by name", () => {
    const layout = passportStateLayout();
    const golden = hexToBytes(layout.goldenHex);
    const short = golden.subarray(0, 8);
    const decoded = decodeCounted(short);
    assert.equal(decoded.ok, false);
    if (decoded.ok) return;
    assert.equal(decoded.cause, "truncated");
  });

  it("product sources never hand-decode account bytes or invent offsets", () => {
    const predicate: ProductSourcePredicate = (rel, text) => {
      if (rel === DECODER_REL) return false;
      // Ban hard-coded PassportState field offsets outside the decoder owner.
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
          /decodePassportState|decode-account-state|getAccountInfo|fetchProductSvmAccountData/.test(
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
      DECODE_EXERCISED >= 4,
      `expected ≥4 decodePassportState exercises, got ${DECODE_EXERCISED}`,
    );
    // Visible in test output for the U7 report.
    console.log(`U7_DECODE_EXERCISED=${DECODE_EXERCISED}`);
  });
});
