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

  it("maps NotOwner", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NotOwner()")),
      "Only the passport owner can do this.",
    );
  });

  it("maps NotSeller", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NotSeller()")),
      "Only the seller of this sale can do this.",
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

  it("maps NoAgent", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NoAgent()")),
      "This sale has no agent. Use the direct seller action instead.",
    );
  });

  it("maps ListingHasAgent", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error ListingHasAgent()")),
      "This sale has an agent. Use the agent cancel or delist path instead.",
    );
  });

  it("maps AuctionHasAgent", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error AuctionHasAgent()")),
      "This auction has an agent. Use the agent cancel path instead.",
    );
  });

  it("maps NoClaim", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NoClaim()")),
      "There is no pending claim to withdraw for this asset.",
    );
  });

  it("NotSellerOrAgent is not confused with NotSeller", () => {
    assert.equal(
      txErrorMessage(new Error("Custom error: NotSellerOrAgent()")),
      "Only the seller or listing agent can confirm this payment.",
    );
  });

  it("maps RefundPending", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error RefundPending()")),
      "A failed-sale refund is pending for this vehicle.",
    );
  });

  it("maps RefundNotPending", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error RefundNotPending()")),
      "No failed-sale refund is pending for this vehicle.",
    );
  });

  it("maps NotActive", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NotActive()")),
      "This listing is not active.",
    );
  });

  it("maps EscrowNotApproved", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error EscrowNotApproved()")),
      "Approve the escrow on your passport first.",
    );
  });

  it("maps HoldReleased", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error HoldReleased()")),
      "The payment hold has already been released.",
    );
  });
});
