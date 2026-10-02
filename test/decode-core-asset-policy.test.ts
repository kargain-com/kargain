/**
 * Unit O — Core AssetV1 owner decoder + SVM account owner wire.
 * Plants: three named refusals; fixture owner round-trip; wrong program owner.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  decodeCoreAssetOwner,
  MPL_CORE_ASSET_V1_KEY,
  MPL_CORE_ASSET_V1_OWNER_MIN_LEN,
} from "@/lib/svm/decode-core-asset";
import { mplCoreProgramId } from "@/lib/svm/foreign-programs";
import { encodeSvmPubkeyBytes } from "@/lib/web3/protocol-address";
import {
  MPL_CORE_FIXTURE_ACCOUNT_DATA,
  MPL_CORE_FIXTURE_OWNER_BYTES,
  mplCoreFixtureAccountOwner,
} from "./fixtures/mpl-core-asset-v1.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVM_NS = 2000040168;

describe("decodeCoreAssetOwner (Unit O)", () => {
  it("decodes stand-shaped fixture owner; cites mpl-core 0.11.2 layout", () => {
    const cargo = readFileSync(path.join(ROOT, "svm/Cargo.toml"), "utf8");
    assert.match(
      cargo,
      /mpl-core\s*=\s*\{\s*version\s*=\s*"=0\.11\.2"/,
      "workspace must pin mpl-core =0.11.2 as layout authority",
    );

    const expectedOwner = encodeSvmPubkeyBytes(MPL_CORE_FIXTURE_OWNER_BYTES);
    const decoded = decodeCoreAssetOwner({
      data: MPL_CORE_FIXTURE_ACCOUNT_DATA,
      accountOwner: mplCoreFixtureAccountOwner(),
      namespace: SVM_NS,
    });
    assert.equal(decoded.ok, true);
    if (!decoded.ok) throw new Error("expected ok");
    assert.equal(decoded.owner, expectedOwner);
    assert.deepEqual(
      [...decoded.ownerBytes],
      [...MPL_CORE_FIXTURE_OWNER_BYTES],
    );
    assert.equal(MPL_CORE_ASSET_V1_KEY, 1);
    assert.equal(MPL_CORE_ASSET_V1_OWNER_MIN_LEN, 33);
  });

  it("refuses not_core_program when account owner ≠ mpl_core", () => {
    const decoded = decodeCoreAssetOwner({
      data: MPL_CORE_FIXTURE_ACCOUNT_DATA,
      accountOwner: "11111111111111111111111111111111",
      namespace: SVM_NS,
    });
    assert.equal(decoded.ok, false);
    if (decoded.ok) throw new Error("expected refuse");
    assert.equal(decoded.cause, "not_core_program");
    assert.notEqual(
      "11111111111111111111111111111111",
      mplCoreProgramId(),
    );
  });

  it("refuses not_asset_v1 when key byte ≠ AssetV1", () => {
    const data = Uint8Array.from(MPL_CORE_FIXTURE_ACCOUNT_DATA);
    data[0] = 0; // Uninitialized
    const decoded = decodeCoreAssetOwner({
      data,
      accountOwner: mplCoreProgramId(),
      namespace: SVM_NS,
    });
    assert.equal(decoded.ok, false);
    if (decoded.ok) throw new Error("expected refuse");
    assert.equal(decoded.cause, "not_asset_v1");
  });

  it("refuses truncated when data shorter than key+owner", () => {
    const decoded = decodeCoreAssetOwner({
      data: MPL_CORE_FIXTURE_ACCOUNT_DATA.subarray(0, 32),
      accountOwner: mplCoreProgramId(),
      namespace: SVM_NS,
    });
    assert.equal(decoded.ok, false);
    if (decoded.ok) throw new Error("expected refuse");
    assert.equal(decoded.cause, "truncated");
  });
});
