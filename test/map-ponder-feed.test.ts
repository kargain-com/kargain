import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPonderFeedItems } from "../lib/notifications/map-ponder-feed.ts";

const OWNER = "0x1111111111111111111111111111111111111111";

describe("mapPonderFeedItems delegation grants", () => {
  it("maps a mandate grant as a high-priority passport notification", () => {
    const [item] = mapPonderFeedItems(
      [
        {
          id: "mandate.granted:1:101",
          type: "mandate.granted",
          tokenId: "1",
          timestamp: "101",
          actor: OWNER,
        },
      ],
      100,
    );

    assert.deepEqual(item, {
      id: "mandate.granted:1:101",
      type: "mandate.granted",
      source: "ponder",
      timestamp: 101,
      read: false,
      href: "/marketplace/1",
      subject: {
        kind: "passport",
        tokenId: "1",
        title: "Passport #1",
      },
      actor: { address: OWNER },
      body: "A vehicle was delegated to you for sale",
      groupKey: "passport:1",
      priority: "high",
    });
  });

  it("respects the read watermark", () => {
    const [item] = mapPonderFeedItems(
      [
        {
          id: "mandate.granted:2:200",
          type: "mandate.granted",
          tokenId: "2",
          timestamp: "200",
          actor: OWNER,
        },
      ],
      200,
    );

    assert.equal(item.type, "mandate.granted");
    assert.equal(item.priority, "high");
    assert.equal(item.href, "/marketplace/2");
    assert.deepEqual(item.actor, { address: OWNER });
    assert.equal(item.read, true);
  });

  it("maps claim.recorded to profile claims tab with credit amount and reason", () => {
    const [item] = mapPonderFeedItems(
      [
        {
          id: "claim.recorded:0xabc-1",
          type: "claim.recorded",
          tokenId: "0",
          timestamp: "300",
          meta: {
            account: OWNER,
            asset: "0x0000000000000000000000000000000000000000",
            amount: "50000000000000000",
            reasonCode: "staking.stake_refund",
          },
        },
      ],
      100,
      OWNER,
    );

    assert.equal(item.type, "claim.recorded");
    assert.equal(item.subject.kind, "claim");
    assert.equal(item.href, `/profile/${OWNER}?tab=claims`);
    assert.match(item.body, /0\.05 ETH/);
    assert.match(item.body, /KarPro stake refund/i);
    assert.equal(item.priority, "high");
    assert.equal(item.read, false);
  });

  it("maps passport.dispute_expired with lapse copy", () => {
    const [item] = mapPonderFeedItems(
      [
        {
          id: "passport.dispute_expired:9:400",
          type: "passport.dispute_expired",
          tokenId: "9",
          timestamp: "400",
        },
      ],
      100,
    );

    assert.equal(item.type, "passport.dispute_expired");
    assert.match(item.body, /lapsed/i);
    assert.match(item.body, /fresh inspection/i);
    assert.equal(item.priority, "high");
    assert.equal(item.href, "/marketplace/9");
  });

  it("maps commerce approaching + settled kinds with meta.href override", () => {
    const [closing] = mapPonderFeedItems(
      [
        {
          id: "commerce.protection_closing:42:1700000000",
          type: "commerce.protection_closing",
          tokenId: "42",
          timestamp: "500",
          meta: { href: "/auctions/42", body: "Custom closing body" },
        },
      ],
      100,
    );
    assert.equal(closing.type, "commerce.protection_closing");
    assert.equal(closing.href, "/auctions/42");
    assert.equal(closing.body, "Custom closing body");
    assert.equal(closing.priority, "high");

    const [settled] = mapPonderFeedItems(
      [
        {
          id: "commerce.settled:7:600",
          type: "commerce.settled",
          tokenId: "7",
          timestamp: "600",
        },
      ],
      100,
    );
    assert.equal(settled.type, "commerce.settled");
    assert.match(settled.body, /protection window/i);
    assert.equal(settled.href, "/marketplace/7");
  });
});
