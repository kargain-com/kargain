import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ContractFunctionRevertedError,
  encodeErrorResult,
} from "viem";

import { KarPassportAbi } from "../lib/contracts/abis.generated.ts";
import {
  formatDecodedRevert,
  txErrorMessage,
} from "../lib/marketplace/tx-error-message.ts";
import {
  encumbrancePermissionCopy,
  sourceUnanswerableCopy,
} from "../lib/passport/encumbrance-permission.ts";
import { shortAddress } from "../lib/web3/wallet-display.ts";

const SOURCE = "0x1111111111111111111111111111111111111111" as const;

function sourceUnanswerableError(): ContractFunctionRevertedError {
  const raw = encodeErrorResult({
    abi: KarPassportAbi,
    errorName: "SourceUnanswerable",
    args: [SOURCE],
  });
  return new ContractFunctionRevertedError({
    abi: KarPassportAbi,
    data: raw,
    functionName: "open",
  });
}

describe("txErrorMessage", () => {
  it("names the SourceUnanswerable source on the write path", () => {
    const message = txErrorMessage(sourceUnanswerableError());
    assert.equal(message, sourceUnanswerableCopy(SOURCE));
    assert.ok(message.includes(shortAddress(SOURCE)));
    assert.equal(
      message,
      encumbrancePermissionCopy(
        { status: "blocked", cause: "source_unanswerable", source: SOURCE },
        "leaveChain",
      ),
    );
  });

  it("names EmptyField when the field string is present", () => {
    const raw = encodeErrorResult({
      abi: KarPassportAbi,
      errorName: "EmptyField",
      args: ["mileage"],
    });
    const err = new ContractFunctionRevertedError({
      abi: KarPassportAbi,
      data: raw,
      functionName: "setTokenURI",
    });
    assert.equal(
      txErrorMessage(err),
      "A required field is empty (mileage).",
    );
  });

  for (const [index, status] of [
    [0, "UNVERIFIED"],
    [1, "VERIFIED"],
    [2, "DISPUTED"],
  ] as const) {
    it(`names InvalidStatus as ${status}`, () => {
      const raw = encodeErrorResult({
        abi: KarPassportAbi,
        errorName: "InvalidStatus",
        args: [index],
      });
      const err = new ContractFunctionRevertedError({
        abi: KarPassportAbi,
        data: raw,
        functionName: "verify",
      });
      assert.equal(
        txErrorMessage(err),
        `Not allowed in the current passport status (${status}).`,
      );
      assert.equal(
        formatDecodedRevert({ name: "InvalidStatus", args: [index] }),
        `Not allowed in the current passport status (${status}).`,
      );
    });
  }

  it("leaves InvalidStatus static when the ordinal is unknown", () => {
    assert.equal(
      formatDecodedRevert({ name: "InvalidStatus", args: [9] }),
      null,
    );
  });

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
      "Approve the selling mode contract to hold your passport first.",
    );
  });

  it("maps NotOffered to bidding-or-withdrawal cause", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error NotOffered()")),
      "This lot is not open for bidding or withdrawal.",
    );
  });

  it("maps DisputeActive as settlement challenge", () => {
    assert.equal(
      txErrorMessage(new Error("reverted with custom error DisputeActive()")),
      "A settlement challenge is still open. Wait for resolution or the challenge window to end.",
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
