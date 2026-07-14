import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectEndsAtExtension,
  detectOutbidTransition,
  extensionWindowMinutes,
  formatExtensionFlash,
  formatExtensionHelp,
  formatOutbidToastMessage,
  outbidSessionKey,
} from "@/lib/auction/auction-live-signals";

describe("extensionWindowMinutes", () => {
  it("rounds seconds to minutes", () => {
    assert.equal(extensionWindowMinutes(300n), 5);
    assert.equal(extensionWindowMinutes(60n), 1);
    assert.equal(extensionWindowMinutes(90n), 2);
  });

  it("falls back to 5 for invalid", () => {
    assert.equal(extensionWindowMinutes(0n), 5);
    assert.equal(extensionWindowMinutes(-1n), 5);
  });
});

describe("formatExtensionFlash / help", () => {
  it("uses window minutes in copy", () => {
    assert.equal(formatExtensionFlash(300n), "Extended by 5 minutes");
    assert.equal(
      formatExtensionHelp(300n),
      "Bids in the last 5 minutes extend the auction by 5 minutes.",
    );
  });
});

describe("detectEndsAtExtension", () => {
  it("false on first hydrate / zero prev", () => {
    assert.equal(detectEndsAtExtension(null, 100n), false);
    assert.equal(detectEndsAtExtension(undefined, 100n), false);
    assert.equal(detectEndsAtExtension(0n, 100n), false);
  });

  it("true when endsAt increases", () => {
    assert.equal(detectEndsAtExtension(100n, 400n), true);
  });

  it("false when equal or decreases", () => {
    assert.equal(detectEndsAtExtension(100n, 100n), false);
    assert.equal(detectEndsAtExtension(400n, 100n), false);
  });
});

describe("detectOutbidTransition", () => {
  const me = "0xAaaA000000000000000000000000000000000001";
  const other = "0xBbbb000000000000000000000000000000000002";

  it("fires when we were leader and someone else leads", () => {
    assert.equal(
      detectOutbidTransition({
        wallet: me,
        prevHighestBidder: me,
        prevHighestBid: 1_200_000_000_000_000_000n,
        nextHighestBidder: other,
      }),
      1_200_000_000_000_000_000n,
    );
  });

  it("null when still leading", () => {
    assert.equal(
      detectOutbidTransition({
        wallet: me,
        prevHighestBidder: me,
        prevHighestBid: 1n,
        nextHighestBidder: me,
      }),
      null,
    );
  });

  it("null when we were never leader", () => {
    assert.equal(
      detectOutbidTransition({
        wallet: me,
        prevHighestBidder: other,
        prevHighestBid: 1n,
        nextHighestBidder: other,
      }),
      null,
    );
  });

  it("null without wallet or prior bid", () => {
    assert.equal(
      detectOutbidTransition({
        wallet: null,
        prevHighestBidder: me,
        prevHighestBid: 1n,
        nextHighestBidder: other,
      }),
      null,
    );
    assert.equal(
      detectOutbidTransition({
        wallet: me,
        prevHighestBidder: me,
        prevHighestBid: 0n,
        nextHighestBidder: other,
      }),
      null,
    );
  });
});

describe("outbidSessionKey / toast message", () => {
  it("stable key shape", () => {
    assert.equal(
      outbidSessionKey({
        chainId: 84532,
        tokenId: "1",
        startedAt: 10n,
        lostBid: 99n,
      }),
      "kargain:auction-outbid:84532:1:10:99",
    );
  });

  it("toast message embeds amount label", () => {
    assert.equal(
      formatOutbidToastMessage("1.2 ETH"),
      "You were outbid. Your 1.2 ETH was returned to your wallet automatically.",
    );
  });
});
