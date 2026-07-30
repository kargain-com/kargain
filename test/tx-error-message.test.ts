import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { txErrorMessage } from "../lib/marketplace/tx-error-message.ts";

describe("txErrorMessage", () => {
  it("maps WrongValue", () => {
    assert.equal(
      txErrorMessage(new Error("ContractFunctionRevertedError: WrongValue()")),
      "Native amount does not match. Refresh and try again.",
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

  it("maps CannotResolveOwnDispute", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error CannotResolveOwnDispute()")),
      "You cannot resolve this dispute — you opened it, own the passport, or are the challenged verifier.",
    );
  });

  it("maps NotOwner", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NotOwner()")),
      "Only the passport owner can do this.",
    );
  });

  it("maps NotSellerOrAgent", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NotSellerOrAgent()")),
      "Only the seller or listing agent can confirm this payment.",
    );
  });

  it("maps NotAgent", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NotAgent()")),
      "Only the authorized agent can do this.",
    );
  });

  it("maps NoClaim", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NoClaim()")),
      "There is no pending claim to withdraw for this asset.",
    );
  });

  it("maps EscrowNotApproved", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error EscrowNotApproved()")),
      "Approve the escrow on your passport first.",
    );
  });

  it("maps MandateExpired", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error MandateExpired()")),
      "This mandate has expired. Grant a new one to open a consignment.",
    );
  });

  it("maps LiveConsignment", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error LiveConsignment()")),
      "Finish or return the live consignment before changing the mandate.",
    );
  });

  it("maps LeaveChainRefused", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error LeaveChainRefused()")),
      "This passport cannot leave the chain right now (encumbrance refused).",
    );
  });
});
