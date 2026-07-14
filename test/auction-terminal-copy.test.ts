import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auctionTerminalMessage } from "@/lib/auction/auction-terminal-copy";

describe("auctionTerminalMessage", () => {
  it("CANCELLED — pre-start cancel copy", () => {
    assert.equal(
      auctionTerminalMessage("CANCELLED", ""),
      "The auction was cancelled before any qualifying bid. The vehicle returned to the owner.",
    );
    assert.equal(
      auctionTerminalMessage("CANCELLED", "ignored"),
      "The auction was cancelled before any qualifying bid. The vehicle returned to the owner.",
    );
  });

  it("RETURNED — owner recall copy", () => {
    assert.equal(
      auctionTerminalMessage("RETURNED", ""),
      "The owner recalled this vehicle before any qualifying bid.",
    );
  });

  it("VOIDED — blueprint refund string with reason", () => {
    assert.equal(
      auctionTerminalMessage("VOIDED", "UnverifiedPassport"),
      "Auction voided — UnverifiedPassport. All bids were refunded automatically.",
    );
  });

  it("VOIDED empty reason falls back to ended", () => {
    assert.equal(
      auctionTerminalMessage("VOIDED", ""),
      "Auction voided — ended. All bids were refunded automatically.",
    );
    assert.equal(
      auctionTerminalMessage("VOIDED", "   "),
      "Auction voided — ended. All bids were refunded automatically.",
    );
  });

  it("unknown phase uses voided string", () => {
    assert.equal(
      auctionTerminalMessage("BIDDING", "x"),
      "Auction voided — x. All bids were refunded automatically.",
    );
  });
});
