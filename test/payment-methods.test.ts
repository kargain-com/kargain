import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptedPaymentMethods,
  paymentMethodIdsToArray,
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
