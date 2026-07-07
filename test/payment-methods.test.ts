import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptedPaymentMethods,
  paymentMethodIdsToArray,
  showLightningChip,
} from "../lib/verifier/payment-methods.ts";

describe("acceptedPaymentMethods", () => {
  it("returns all three when profile is null", () => {
    const set = acceptedPaymentMethods(null);
    assert.equal(set.size, 3);
    assert.equal(set.has("eth"), true);
    assert.equal(set.has("usdc"), true);
    assert.equal(set.has("lightning"), true);
  });

  it("returns all three when field is absent", () => {
    const set = acceptedPaymentMethods({ name: "Ada" });
    assert.equal(set.size, 3);
  });

  it("returns partial set when field is present", () => {
    const set = acceptedPaymentMethods({ verifierPaymentMethods: ["eth", "lightning"] });
    assert.equal(set.size, 2);
    assert.equal(set.has("usdc"), false);
  });
});

describe("paymentMethodIdsToArray", () => {
  it("returns stable order eth usdc lightning", () => {
    const arr = paymentMethodIdsToArray(new Set(["lightning", "eth"]));
    assert.deepEqual(arr, ["eth", "lightning"]);
  });
});

describe("showLightningChip", () => {
  it("shows when methods absent and lud16 valid", () => {
    assert.equal(showLightningChip({ lud16: "pay@example.com" }), true);
  });

  it("shows when lightning explicit and lud16 valid", () => {
    assert.equal(
      showLightningChip({ verifierPaymentMethods: ["lightning"], lud16: "pay@example.com" }),
      true,
    );
  });

  it("hides when lightning not in accepted methods", () => {
    assert.equal(
      showLightningChip({ verifierPaymentMethods: ["eth"], lud16: "pay@example.com" }),
      false,
    );
  });

  it("hides when lud16 missing or invalid", () => {
    assert.equal(showLightningChip({ verifierPaymentMethods: ["lightning"] }), false);
    assert.equal(
      showLightningChip({ verifierPaymentMethods: ["lightning"], lud16: "not-valid" }),
      false,
    );
    assert.equal(showLightningChip(null), false);
  });
});
