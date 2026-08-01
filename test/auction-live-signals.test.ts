import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  detectEndsAtExtension,
  detectOutbidTransition,
  extensionWindowMinutes,
  formatExtensionFlash,
  formatExtensionHelp,
  formatOutbidToastMessage,
  outbidSessionKey,
} from "@/lib/auction/auction-live-signals";
import {
  ASCENDING_BID_HELD,
  ASCENDING_CANCEL_BEFORE_FIRST_BID,
  ASCENDING_NO_CANCEL_AFTER_BID,
  ASCENDING_PROTECTION_TRADE,
  ASCENDING_RESERVE_HELP,
  ASCENDING_RESERVE_INTRO,
  ASCENDING_S1_HELP,
} from "@/lib/auction/ascending-public-claims";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CREATE_PANEL = path.join(
  ROOT,
  "components/auction/create-auction-panel.tsx",
);
const AGENT_CREATE_PANEL = path.join(
  ROOT,
  "components/auction/agent-create-auction-panel.tsx",
);

describe("extensionWindowMinutes", () => {
  it("rounds seconds to minutes", () => {
    assert.equal(extensionWindowMinutes(300n), 5);
    assert.equal(extensionWindowMinutes(900n), 15);
    assert.equal(extensionWindowMinutes(60n), 1);
    assert.equal(extensionWindowMinutes(90n), 2);
  });

  it("returns null when unread or invalid — never invents minutes", () => {
    assert.equal(extensionWindowMinutes(null), null);
    assert.equal(extensionWindowMinutes(undefined), null);
    assert.equal(extensionWindowMinutes(0n), null);
    assert.equal(extensionWindowMinutes(-1n), null);
  });
});

describe("formatExtensionFlash / help", () => {
  it("uses window minutes in copy", () => {
    assert.equal(formatExtensionFlash(300n), "Extended by 5 minutes");
    assert.equal(
      formatExtensionHelp(300n),
      "Bids in the last 5 minutes extend the auction by 5 minutes.",
    );
    assert.equal(
      formatExtensionHelp(900n),
      "Bids in the last 15 minutes extend the auction by 15 minutes.",
    );
  });

  it("returns null when window unread", () => {
    assert.equal(formatExtensionHelp(null), null);
    assert.equal(formatExtensionFlash(undefined), null);
  });
});

describe("ascending public claims", () => {
  it("states public reserve, no-cancel-after-bid, bid held, and cancel guard", () => {
    assert.match(ASCENDING_RESERVE_INTRO, /reserve is public/i);
    assert.match(ASCENDING_RESERVE_HELP, /Shown to everyone/);
    assert.match(ASCENDING_NO_CANCEL_AFTER_BID, /cannot cancel, withdraw, or recall/i);
    assert.match(ASCENDING_CANCEL_BEFORE_FIRST_BID, /before the first qualifying bid/i);
    assert.match(ASCENDING_S1_HELP, /seller can cancel or withdraw/i);
    assert.match(ASCENDING_BID_HELD, /held in full by the contract/i);
    assert.match(ASCENDING_BID_HELD, /Claims/);
  });

  it("protection_trade_unstated: names longer-hold vs faster-settle at the opener picker", () => {
    assert.match(ASCENDING_PROTECTION_TRADE, /longer hold/i);
    assert.match(ASCENDING_PROTECTION_TRADE, /buyer more time/i);
    assert.match(ASCENDING_PROTECTION_TRADE, /shorter hold/i);
    assert.match(ASCENDING_PROTECTION_TRADE, /settles your payment sooner/i);

    for (const [label, file] of [
      ["create-auction-panel", CREATE_PANEL],
      ["agent-create-auction-panel", AGENT_CREATE_PANEL],
    ] as const) {
      const text = fs.readFileSync(file, "utf8");
      assert.match(
        text,
        /ASCENDING_PROTECTION_TRADE/,
        `${label} must render ASCENDING_PROTECTION_TRADE`,
      );
      assert.match(
        text,
        /from\s+["']@\/lib\/auction\/ascending-public-claims["']/,
        `${label} must import from ascending-public-claims`,
      );
    }
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

  it("null when we were not the previous leader", () => {
    assert.equal(
      detectOutbidTransition({
        wallet: me,
        prevHighestBidder: other,
        prevHighestBid: 1n,
        nextHighestBidder: me,
      }),
      null,
    );
  });
});

describe("formatOutbidToastMessage", () => {
  it("points to Claims when release fails", () => {
    assert.equal(
      formatOutbidToastMessage("1.2 ETH"),
      "You were outbid. Your 1.2 ETH was released. If it did not arrive in your wallet, check Claims.",
    );
  });
});

describe("outbidSessionKey", () => {
  it("includes chain, token, start, and lost bid", () => {
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
});
