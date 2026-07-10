import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveSetupChecklist } from "../lib/kar-pro/setup-checklist.ts";

const completeBase = {
  name: "Acme Motors",
  slug: "acme-motors",
  feeWei: 1n,
  hasExplicitPaymentMethods: true,
  messagingReady: true,
};

describe("deriveSetupChecklist profile", () => {
  it("pending when name or slug empty after trim", () => {
    assert.equal(deriveSetupChecklist({ ...completeBase, name: "" }).profile, "pending");
    assert.equal(deriveSetupChecklist({ ...completeBase, slug: "" }).profile, "pending");
    assert.equal(deriveSetupChecklist({ ...completeBase, name: "  " }).profile, "pending");
    assert.equal(deriveSetupChecklist({ ...completeBase, slug: "  " }).profile, "pending");
  });

  it("complete when name and slug are non-empty after trim", () => {
    assert.equal(
      deriveSetupChecklist({ ...completeBase, name: " Acme ", slug: " acme " }).profile,
      "complete",
    );
  });
});

describe("deriveSetupChecklist payments", () => {
  it("pending without explicit verifierPaymentMethods", () => {
    assert.equal(
      deriveSetupChecklist({ ...completeBase, hasExplicitPaymentMethods: false }).payments,
      "pending",
    );
  });

  it("complete with explicit verifierPaymentMethods", () => {
    assert.equal(
      deriveSetupChecklist({ ...completeBase, hasExplicitPaymentMethods: true }).payments,
      "complete",
    );
  });
});

describe("deriveSetupChecklist fee", () => {
  it("quote when fee is zero or unset", () => {
    assert.equal(deriveSetupChecklist({ ...completeBase, feeWei: 0n }).fee, "quote");
    assert.equal(deriveSetupChecklist({ ...completeBase, feeWei: undefined }).fee, "quote");
  });

  it("set when fee is greater than zero", () => {
    assert.equal(deriveSetupChecklist({ ...completeBase, feeWei: 1n }).fee, "set");
  });
});

describe("deriveSetupChecklist messages", () => {
  it("pending when messaging not ready", () => {
    assert.equal(
      deriveSetupChecklist({ ...completeBase, messagingReady: false }).messages,
      "pending",
    );
  });

  it("complete when messaging ready", () => {
    assert.equal(
      deriveSetupChecklist({ ...completeBase, messagingReady: true }).messages,
      "complete",
    );
  });
});

describe("deriveSetupChecklist allRequiredComplete", () => {
  it("false when any required row is pending", () => {
    assert.equal(
      deriveSetupChecklist({ ...completeBase, name: "" }).allRequiredComplete,
      false,
    );
    assert.equal(
      deriveSetupChecklist({ ...completeBase, hasExplicitPaymentMethods: false }).allRequiredComplete,
      false,
    );
    assert.equal(
      deriveSetupChecklist({ ...completeBase, messagingReady: false }).allRequiredComplete,
      false,
    );
  });

  it("true when profile, payments, and messages complete regardless of fee", () => {
    const result = deriveSetupChecklist({
      ...completeBase,
      feeWei: 0n,
    });
    assert.equal(result.allRequiredComplete, true);
    assert.equal(result.fee, "quote");
  });
});
