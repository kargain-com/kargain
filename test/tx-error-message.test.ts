import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { txErrorMessage } from "../lib/marketplace/tx-error-message.ts";

describe("txErrorMessage", () => {
  it("maps InsufficientDeposit", () => {
    assert.equal(
      txErrorMessage(new Error("ContractFunctionRevertedError: InsufficientDeposit()")),
      "The required deposit has changed. Please retry.",
    );
  });

  it("maps NotDisputeOpener", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NotDisputeOpener()")),
      "Only the dispute opener can withdraw this dispute.",
    );
  });

  it("maps NoActiveDispute", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NoActiveDispute()")),
      "This passport is not in an active dispute.",
    );
  });

  it("maps CannotResolveSelfDispute", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error CannotResolveSelfDispute()")),
      "You cannot resolve a dispute you opened yourself.",
    );
  });
});
