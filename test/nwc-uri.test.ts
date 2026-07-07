import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseNwcUri, redactNwcUri } from "@/lib/nostr/nwc/nwc-uri";

const PUBKEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const SECRET = "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
const RELAY = "wss://relay.example.com";

function buildUri(opts?: { slashes?: boolean; relay?: string; extraRelay?: string }): string {
  const scheme = opts?.slashes ? "nostr+walletconnect://" : "nostr+walletconnect:";
  const relay = opts?.relay ?? RELAY;
  const extra = opts?.extraRelay ? `&relay=${encodeURIComponent(opts.extraRelay)}` : "";
  return `${scheme}${PUBKEY}?relay=${encodeURIComponent(relay)}&secret=${SECRET}${extra}`;
}

describe("parseNwcUri", () => {
  it("accepts scheme with slashes", () => {
    const parsed = parseNwcUri(buildUri({ slashes: true }));
    assert.ok(parsed);
    assert.equal(parsed.walletPubkey, PUBKEY);
    assert.equal(parsed.secretHex, SECRET);
    assert.equal(parsed.relayUrl, `${RELAY}/`);
  });

  it("accepts scheme without slashes", () => {
    const parsed = parseNwcUri(buildUri({ slashes: false }));
    assert.ok(parsed);
    assert.equal(parsed.walletPubkey, PUBKEY);
  });

  it("picks first valid relay when multiple are present", () => {
    const parsed = parseNwcUri(
      buildUri({ extraRelay: "ws://bad.example.com", relay: "wss://first.example.com" }),
    );
    assert.ok(parsed);
    assert.equal(parsed.relayUrl, "wss://first.example.com/");
  });

  it("rejects bad scheme", () => {
    assert.equal(parseNwcUri("nostr://abc"), null);
  });

  it("rejects short pubkey and secret", () => {
    assert.equal(parseNwcUri(`nostr+walletconnect://${PUBKEY.slice(0, 63)}?relay=${RELAY}&secret=${SECRET}`), null);
    assert.equal(parseNwcUri(`nostr+walletconnect://${PUBKEY}?relay=${RELAY}&secret=${SECRET.slice(0, 63)}`), null);
  });

  it("rejects ws relay", () => {
    assert.equal(parseNwcUri(buildUri({ relay: "ws://relay.example.com" })), null);
  });

  it("rejects localhost relay", () => {
    assert.equal(parseNwcUri(buildUri({ relay: "wss://localhost" })), null);
  });

  it("rejects IP relay", () => {
    assert.equal(parseNwcUri(buildUri({ relay: "wss://127.0.0.1" })), null);
  });

  it("allows explicit relay port", () => {
    const parsed = parseNwcUri(buildUri({ relay: "wss://relay.example.com:8080" }));
    assert.ok(parsed);
    assert.equal(parsed.relayUrl, "wss://relay.example.com:8080/");
  });
});

describe("redactNwcUri", () => {
  it("redacts secret query param", () => {
    const uri = buildUri({ slashes: true });
    const redacted = redactNwcUri(uri);
    assert.match(redacted, /secret=%E2%80%A6|secret=…/);
    assert.doesNotMatch(redacted, new RegExp(SECRET));
  });
});
