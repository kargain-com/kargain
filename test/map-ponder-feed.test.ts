import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPonderFeedItems } from "../lib/notifications/map-ponder-feed.ts";

const OWNER = "0x1111111111111111111111111111111111111111";

describe("mapPonderFeedItems delegation grants", () => {
  it("maps marketplace delegation as a high-priority passport notification", () => {
    const [item] = mapPonderFeedItems(
      [
        {
          id: "agent.authorized:1:101",
          type: "agent.authorized",
          tokenId: "1",
          timestamp: "101",
          actor: OWNER,
        },
      ],
      100,
    );

    assert.deepEqual(item, {
      id: "agent.authorized:1:101",
      type: "agent.authorized",
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

  it("maps auction authorization and respects the read watermark", () => {
    const [item] = mapPonderFeedItems(
      [
        {
          id: "auction_agent.authorized:2:200",
          type: "auction_agent.authorized",
          tokenId: "2",
          timestamp: "200",
          actor: OWNER,
        },
      ],
      200,
    );

    assert.equal(item.type, "auction_agent.authorized");
    assert.equal(item.body, "You were authorized to run a reserve auction");
    assert.equal(item.priority, "high");
    assert.equal(item.href, "/marketplace/2");
    assert.deepEqual(item.actor, { address: OWNER });
    assert.equal(item.read, true);
  });
});
