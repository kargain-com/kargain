/**
 * S8-4 — parseEther/formatEther/literal 18 confined to native-amount owner;
 * settlement disclosure names the formatted unit; Irys plan refuses by name.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { askingSettlementDisclosure } from "../lib/commerce/listing-price-display.ts";
import { resolveSettlementAssetMeta } from "../lib/commerce/settlement-asset-meta.ts";
import {
  COMMERCIAL_ACTIVE,
  nativeUnitOf,
} from "../lib/web3/commercial-active.ts";
import {
  formatNativeAmountLabeled,
} from "../lib/web3/native-amount.ts";
import { planIrysUpload } from "../lib/storage/irys-upload-plan.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";
import { scanProductSources } from "./policy-scan-helpers.ts";

const NATIVE_AMOUNT_OWNER = "lib/web3/native-amount.ts";

/** Product sites that may mention 18 only inside comments about the ban. */
const EIGHTEEN_ASSUMPTION =
  /\bparseEther\b|\bformatEther\b|decimals\s*:\s*18|\?\?\s*18/;

function eighteenPredicate(rel: string, source: string): string | false {
  // Strip block and line comments so docstrings naming the ban do not trip.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  if (!EIGHTEEN_ASSUMPTION.test(stripped)) return false;
  return `eighteen-decimal native assumption outside owner (${rel})`;
}

describe("native amount ownership policy", () => {
  it("allows parseEther/formatEther/decimals:18/??18 only in the formatting owner", () => {
    const violations = scanProductSources(eighteenPredicate, {
      owners: [NATIVE_AMOUNT_OWNER],
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("catches planted parseEther outside the owner (red→green)", () => {
    const dirty = `import { parseEther } from "viem";\nexport const x = parseEther("1");\n`;
    assert.equal(
      eighteenPredicate("components/planted.tsx", dirty),
      "eighteen-decimal native assumption outside owner (components/planted.tsx)",
    );
    const clean = `import { formatNativeAmount } from "@/lib/web3/native-amount";\n`;
    assert.equal(eighteenPredicate("components/planted.tsx", clean), false);
  });

  it("catches planted decimals: 18 outside the owner (red→green)", () => {
    const dirty = `const native = { label: "ETH", decimals: 18 };\n`;
    assert.equal(
      eighteenPredicate("hooks/planted.ts", dirty),
      "eighteen-decimal native assumption outside owner (hooks/planted.ts)",
    );
  });

  it("same amount formats differently under fixture 9 vs live 18", () => {
    const amount = 1_500_000_000n;
    const underNine = formatNativeAmountLabeled(
      amount,
      nativeUnitOf(FIXTURE_SVM_STACK),
    );
    const underEighteen = formatNativeAmountLabeled(
      amount,
      nativeUnitOf(COMMERCIAL_ACTIVE[84532]!),
    );
    assert.equal(underNine, "1.5 SOL");
    assert.equal(underEighteen, "0.0000000015 ETH");
    assert.notEqual(underNine, underEighteen);
  });

  it("settlement disclosure names the same unit resolveSettlementAssetMeta formats", () => {
    const meta = resolveSettlementAssetMeta({
      chainId: 84532,
      asset: "0x0000000000000000000000000000000000000000",
    });
    assert.equal(meta.identity, "native");
    assert.equal(meta.label, "ETH");
    const disclosure = askingSettlementDisclosure(meta.label);
    assert.equal(disclosure, "Checkout settles in ETH.");

    const mismatched = askingSettlementDisclosure("SOL");
    assert.notEqual(mismatched, disclosure);
    assert.equal(mismatched, "Checkout settles in SOL.");
  });

  it("planIrysUpload refuses SVM with wrong_vm without throwing", () => {
    assert.doesNotThrow(() => {
      const result = planIrysUpload(FIXTURE_SVM_STACK);
      assert.deepEqual(result, { ok: false, cause: "wrong_vm" });
    });
  });
});
