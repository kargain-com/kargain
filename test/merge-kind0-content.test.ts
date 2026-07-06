import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeKind0Content } from "../lib/nostr/merge-kind0-content.ts";

describe("mergeKind0Content verifierPaymentMethods", () => {
  it("writes deduped array when patch has valid methods", () => {
    const merged = mergeKind0Content(
      { nip05: "user@example.com" },
      { verifierPaymentMethods: ["eth", "usdc", "eth"] },
    );
    assert.deepEqual(merged.verifierPaymentMethods, ["eth", "usdc"]);
    assert.equal(merged.nip05, "user@example.com");
  });

  it("clears methods when patch has empty array", () => {
    const merged = mergeKind0Content(
      { verifierPaymentMethods: ["eth"] },
      { verifierPaymentMethods: [] },
    );
    assert.equal(merged.verifierPaymentMethods, undefined);
  });

  it("clears methods when patch has only unknown values", () => {
    const merged = mergeKind0Content(
      { verifierPaymentMethods: ["eth"] },
      { verifierPaymentMethods: ["bitcoin" as "eth"] },
    );
    assert.equal(merged.verifierPaymentMethods, undefined);
  });

  it("preserves methods when omitted from patch", () => {
    const merged = mergeKind0Content(
      { verifierPaymentMethods: ["lightning"], name: "Old" },
      { name: "New" },
    );
    assert.deepEqual(merged.verifierPaymentMethods, ["lightning"]);
    assert.equal(merged.name, "New");
  });

  it("drops unknown values and keeps known", () => {
    const merged = mergeKind0Content(
      {},
      { verifierPaymentMethods: ["bitcoin" as "eth", "usdc"] },
    );
    assert.deepEqual(merged.verifierPaymentMethods, ["usdc"]);
  });
});
