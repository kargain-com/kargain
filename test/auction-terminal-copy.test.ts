import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auctionTerminalMessage } from "@/lib/auction/auction-terminal-copy";

describe("auctionTerminalMessage", () => {
  it("CANCELLED — pre-start cancel copy", () => {
    assert.equal(
      auctionTerminalMessage("CANCELLED"),
      "The auction was cancelled before any qualifying bid. The vehicle returned to the owner.",
    );
  });

  it("RETURNED — owner recall copy", () => {
    assert.equal(
      auctionTerminalMessage("RETURNED"),
      "The owner recalled this vehicle before any qualifying bid.",
    );
  });

  it("unknown phase uses closed string", () => {
    assert.equal(auctionTerminalMessage("BIDDING"), "This auction is closed.");
    assert.equal(auctionTerminalMessage("SETTLED"), "This auction is closed.");
  });
});
