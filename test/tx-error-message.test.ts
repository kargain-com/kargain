import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ContractFunctionRevertedError,
  encodeErrorResult,
  type Abi,
} from "viem";

import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
  KarPassportAbi,
  KarPassportBridgeGatewayAbi,
} from "../lib/contracts/abis.generated.ts";
import {
  formatDecodedRevert,
  REVERT_COPY,
  txErrorMessage,
} from "../lib/marketplace/tx-error-message.ts";
import {
  encumbrancePermissionCopy,
  sourceUnanswerableCopy,
} from "../lib/passport/encumbrance-permission.ts";
import { writeConfirmFailedCopy } from "../lib/web3/write-confirm-copy.ts";
import { shortAddress } from "../lib/web3/wallet-display.ts";
import { mintProtocolOwner } from "../lib/web3/protocol-address.ts";

const SOURCE_HEX = "0x1111111111111111111111111111111111111111" as const;
const SOURCE = mintProtocolOwner(84_532, SOURCE_HEX)!;
const KNOWN_SOURCE = { presence: "known" as const, address: SOURCE };

function reverted(
  abi: Abi,
  errorName: string,
  args: readonly unknown[] = [],
  functionName = "call",
): ContractFunctionRevertedError {
  const raw = encodeErrorResult({
    abi,
    errorName,
    args: args as never,
  });
  return new ContractFunctionRevertedError({
    abi,
    data: raw,
    functionName,
  });
}

describe("txErrorMessage", () => {
  it("names the SourceUnanswerable source on the write path", () => {
    const message = txErrorMessage(
      reverted(KarPassportAbi, "SourceUnanswerable", [SOURCE_HEX], "open"),
    );
    assert.equal(message, sourceUnanswerableCopy(KNOWN_SOURCE));
    assert.ok(message.includes(shortAddress(SOURCE)));
    assert.equal(
      message,
      encumbrancePermissionCopy(
        {
          status: "blocked",
          cause: "source_unanswerable",
          source: KNOWN_SOURCE,
        },
        "leaveChain",
      ),
    );
  });

  it("names EmptyField when the field string is present", () => {
    assert.equal(
      txErrorMessage(
        reverted(KarPassportAbi, "EmptyField", ["mileage"], "setTokenURI"),
      ),
      "A required field is empty (mileage).",
    );
  });

  for (const [index, status] of [
    [0, "UNVERIFIED"],
    [1, "VERIFIED"],
    [2, "DISPUTED"],
  ] as const) {
    it(`names InvalidStatus as ${status}`, () => {
      const err = reverted(KarPassportAbi, "InvalidStatus", [index], "verify");
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

  it("maps WrongValue via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(KarPassportAbi, "WrongValue")),
      REVERT_COPY.WrongValue,
    );
  });

  it("maps NotDisputeOpener via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(KarPassportAbi, "NotDisputeOpener")),
      REVERT_COPY.NotDisputeOpener,
    );
  });

  it("maps NoActiveDispute via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(KarPassportAbi, "NoActiveDispute")),
      REVERT_COPY.NoActiveDispute,
    );
  });

  it("maps CannotResolveOwnDispute via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(KarPassportAbi, "CannotResolveOwnDispute")),
      REVERT_COPY.CannotResolveOwnDispute,
    );
  });

  it("maps NotOwner via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(KarPassportAbi, "NotOwner")),
      REVERT_COPY.NotOwner,
    );
  });

  it("maps NotSellerOrAgent via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(FixedPriceConsignmentAbi, "NotSellerOrAgent")),
      REVERT_COPY.NotSellerOrAgent,
    );
  });

  it("NotAgent stays in REVERT_COPY for harness / static fallback", () => {
    assert.equal(
      REVERT_COPY.NotAgent,
      "Only the authorized agent can do this.",
    );
  });

  it("maps NoClaim via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(KarPassportAbi, "NoClaim")),
      REVERT_COPY.NoClaim,
    );
  });

  it("maps EscrowNotApproved via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(FixedPriceConsignmentAbi, "EscrowNotApproved")),
      REVERT_COPY.EscrowNotApproved,
    );
  });

  it("maps NotOffered to bidding-or-withdrawal cause via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(AscendingConsignmentAbi, "NotOffered")),
      REVERT_COPY.NotOffered,
    );
  });

  it("maps DisputeActive as settlement challenge via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(KarPassportAbi, "DisputeActive")),
      REVERT_COPY.DisputeActive,
    );
  });

  it("maps MandateExpired via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(FixedPriceConsignmentAbi, "MandateExpired")),
      REVERT_COPY.MandateExpired,
    );
  });

  it("maps LiveConsignment via ABI decode", () => {
    assert.equal(
      txErrorMessage(reverted(FixedPriceConsignmentAbi, "LiveConsignment")),
      REVERT_COPY.LiveConsignment,
    );
  });

  it("maps LeaveChainRefused via ABI decode", () => {
    assert.equal(
      txErrorMessage(
        reverted(KarPassportBridgeGatewayAbi, "LeaveChainRefused"),
      ),
      REVERT_COPY.LeaveChainRefused,
    );
  });

  it("plain Error never leaks raw text — generic writeConfirmFailedCopy", () => {
    assert.equal(
      txErrorMessage(new Error("boom internal detail")),
      writeConfirmFailedCopy(),
    );
  });

  it("message-only Custom(1) / hex ordinal never invents NotOwner", () => {
    assert.equal(
      txErrorMessage(new Error("Custom(1)")),
      writeConfirmFailedCopy(),
    );
    assert.equal(
      txErrorMessage(new Error("custom program error: 0x1")),
      writeConfirmFailedCopy(),
    );
  });
});
