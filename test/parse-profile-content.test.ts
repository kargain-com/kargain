import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProfileContent } from "../lib/nostr/parse-profile-content.ts";
import { peerAcceptsMessages, peerReachabilityMessage } from "../lib/messaging/can-message-peer.ts";

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

  it("parses lud16 when present", () => {
    const profile = parseProfileContent(
      JSON.stringify({ lud16: "  pay@example.com  " }),
    );
    assert.equal(profile?.lud16, "pay@example.com");
  });

  it("omits empty lud16", () => {
    const profile = parseProfileContent(JSON.stringify({ lud16: "   " }));
    assert.equal(profile?.lud16, undefined);
  });

  it("parses valid attestation", () => {
    const profile = parseProfileContent(
      JSON.stringify({
        attestation: { v: 1, sig: "0xabcdef" },
      }),
    );
    assert.deepEqual(profile?.attestation, { v: 1, sig: "0xabcdef" });
  });

  it("omits invalid attestation", () => {
    const profile = parseProfileContent(
      JSON.stringify({
        attestation: { v: 2, sig: "0xabcdef" },
      }),
    );
    assert.equal(profile?.attestation, undefined);
  });
});

describe("parseProfileContent location", () => {
  it("parses complete place object", () => {
    const profile = parseProfileContent(
      JSON.stringify({
        location: {
          placeId: "osm:R123",
          countryCode: "de",
          label: "Berlin, Germany",
          city: "Berlin",
        },
      }),
    );
    assert.deepEqual(profile?.location, {
      placeId: "osm:R123",
      countryCode: "DE",
      label: "Berlin, Germany",
      city: "Berlin",
    });
  });

  it("omits free-text location string", () => {
    const profile = parseProfileContent(JSON.stringify({ location: "Berlin" }));
    assert.equal(profile?.location, undefined);
  });

  it("omits incomplete location object", () => {
    const profile = parseProfileContent(
      JSON.stringify({ location: { label: "Berlin" } }),
    );
    assert.equal(profile?.location, undefined);
  });
});


describe("parseProfileContent verifierPaymentMethods", () => {
  it("parses valid methods and dedupes", () => {
    const profile = parseProfileContent(
      JSON.stringify({ verifierPaymentMethods: ["eth", "usdc", "eth"] }),
    );
    assert.deepEqual(profile?.verifierPaymentMethods, ["eth", "usdc"]);
  });

  it("omits empty or invalid arrays", () => {
    assert.equal(
      parseProfileContent(JSON.stringify({ verifierPaymentMethods: [] }))
        ?.verifierPaymentMethods,
      undefined,
    );
    assert.equal(
      parseProfileContent(JSON.stringify({ verifierPaymentMethods: ["bitcoin"] }))
        ?.verifierPaymentMethods,
      undefined,
    );
    assert.equal(
      parseProfileContent(JSON.stringify({ verifierPaymentMethods: "eth" }))
        ?.verifierPaymentMethods,
      undefined,
    );
  });
});

describe("peerReachabilityMessage", () => {
  it("maps known reasons to user copy", () => {
    assert.match(peerReachabilityMessage("not_registered") ?? "", /not enabled messages/i);
    assert.match(peerReachabilityMessage("disabled") ?? "", /not accepting messages/i);
    assert.equal(peerReachabilityMessage(null), null);
  });
});
