import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveMessagingActivation } from "../lib/xmtp/messaging-activation-state.ts";

describe("deriveMessagingActivation", () => {
  it("switch on requires local XMTP, network registration, and nostr accepting", () => {
    const on = deriveMessagingActivation({
      xmtpLocalReady: true,
      xmtpNetworkRegistered: true,
      nostrProfile: { messagesEnabled: true },
      nostrLoaded: true,
      hasLocalOptIn: true,
    });
    assert.equal(on.switchOn, true);
    assert.equal(on.publiclyReachable, true);
    assert.equal(on.drift, "none");
  });

  it("switch off when relay explicitly opts out even if local XMTP ready", () => {
    const snap = deriveMessagingActivation({
      xmtpLocalReady: true,
      xmtpNetworkRegistered: true,
      nostrProfile: { messagesEnabled: false },
      nostrLoaded: true,
      hasLocalOptIn: true,
    });
    assert.equal(snap.switchOn, false);
    assert.equal(snap.drift, "relay_opt_out");
    assert.equal(snap.explicitlyOptedOut, true);
  });

  it("switch off while nostr is still loading", () => {
    const snap = deriveMessagingActivation({
      xmtpLocalReady: true,
      xmtpNetworkRegistered: true,
      nostrProfile: null,
      nostrLoaded: false,
      hasLocalOptIn: true,
    });
    assert.equal(snap.switchOn, false);
  });

  it("detects network unregistered drift", () => {
    const snap = deriveMessagingActivation({
      xmtpLocalReady: true,
      xmtpNetworkRegistered: false,
      nostrProfile: { messagesEnabled: true },
      nostrLoaded: true,
      hasLocalOptIn: true,
    });
    assert.equal(snap.switchOn, false);
    assert.equal(snap.drift, "network_unregistered");
  });

  it("defaults to accepting when messagesEnabled is absent", () => {
    const snap = deriveMessagingActivation({
      xmtpLocalReady: true,
      xmtpNetworkRegistered: true,
      nostrProfile: { name: "Test" },
      nostrLoaded: true,
      hasLocalOptIn: true,
    });
    assert.equal(snap.nostrAccepting, true);
    assert.equal(snap.switchOn, true);
  });
});
