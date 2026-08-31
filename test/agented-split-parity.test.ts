/**
 * Agented-split parity — shared vectors vs `lib/commerce/agented-split.ts`.
 * Rust corpus: `svm/crates/kargain-agented-split` (`pnpm test:svm`).
 * Solidity: ConsignmentBase harness loads the same fixture in Hardhat.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMPENSATION_FORM,
  type CompensationForm,
} from "@/lib/commerce/denomination";
import { computeAgentedSplit } from "@/lib/commerce/agented-split";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../svm/crates/kargain-agented-split/fixtures/vectors.json",
);

type Vector = {
  id: string;
  settled: string;
  floor: string;
  form: "margin" | "commission";
  commissionBps: number;
  platformFeeBps: string;
  ok: boolean;
  platform: string;
  ownerAmount: string;
  agentAmount: string;
};

function formOf(f: Vector["form"]): CompensationForm {
  return f === "margin"
    ? COMPENSATION_FORM.Margin
    : COMPENSATION_FORM.Commission;
}

describe("agented-split parity corpus", () => {
  const vectors: Vector[] = JSON.parse(readFileSync(FIXTURE, "utf8"));

  it("loads boundary and truncation vectors", () => {
    assert.ok(vectors.length >= 10);
    assert.ok(vectors.some((v) => v.id === "margin-zero-agent"));
    assert.ok(vectors.some((v) => v.id.includes("truncation")));
    assert.ok(vectors.some((v) => v.ok === false));
    assert.ok(
      vectors.some((v) => v.id === "u64-product-boundary-former-overflow"),
      "corpus must cover former u64 product overflow boundary",
    );
    assert.ok(
      vectors.some((v) => v.id === "u64-max-settled-fee-1bps"),
      "corpus must cover u64::MAX settled",
    );
  });

  for (const v of vectors) {
    it(`TS bit-exact: ${v.id}`, () => {
      const got = computeAgentedSplit({
        settled: BigInt(v.settled),
        floor: BigInt(v.floor),
        compensationForm: formOf(v.form),
        commissionBps: v.commissionBps,
        platformFeeBps: BigInt(v.platformFeeBps),
      });
      assert.equal(got.ok, v.ok);
      assert.equal(got.platform, BigInt(v.platform));
      assert.equal(got.ownerAmount, BigInt(v.ownerAmount));
      assert.equal(got.agentAmount, BigInt(v.agentAmount));
    });
  }
});
