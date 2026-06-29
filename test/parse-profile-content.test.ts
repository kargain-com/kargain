import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProfileContent } from "../lib/nostr/parse-profile-content.ts";
import { peerAcceptsMessages, peerReachabilityMessage } from "../lib/xmtp/can-message-peer.ts";

describe("parseProfileContent messagesEnabled", () => {
  it("defaults to accepting messages when field is absent", () => {
    const profile = parseProfileContent(JSON.stringify({ name: "Ada" }));
    assert.equal(profile?.messagesEnabled, undefined);
    assert.equal(peerAcceptsMessages(profile), true);
  });

  it("parses explicit false", () => {
    const profile = parseProfileContent(JSON.stringify({ messagesEnabled: false }));
    assert.equal(profile?.messagesEnabled, false);
    assert.equal(peerAcceptsMessages(profile), false);
  });

  it("parses explicit true", () => {
    const profile = parseProfileContent(JSON.stringify({ messagesEnabled: true }));
    assert.equal(profile?.messagesEnabled, true);
    assert.equal(peerAcceptsMessages(profile), true);
  });
});

describe("peerReachabilityMessage", () => {
  it("maps known reasons to user copy", () => {
    assert.match(peerReachabilityMessage("not_registered") ?? "", /not enabled messages/i);
    assert.match(peerReachabilityMessage("disabled") ?? "", /not accepting messages/i);
    assert.equal(peerReachabilityMessage(null), null);
  });
});
