import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NostrProfileData } from "../lib/nostr/parse-profile-content.ts";
import type { PublishNostrProfileOpts } from "../lib/nostr/profile.ts";
import {
  enableMessagingFull,
  enableMessagingFullError,
} from "../lib/xmtp/enable-messaging-full.ts";

const ADDRESS = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;

describe("enableMessagingFull", () => {
  it("returns xmtp step when XMTP init fails", async () => {
    const result = await enableMessagingFull({
      enableMessages: async () => false,
      address: ADDRESS,
      walletClient: {} as never,
      profile: null,
      skipVerify: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.step, "xmtp");
  });

  it("returns nostr step when profile publish fails", async () => {
    const result = await enableMessagingFull({
      enableMessages: async () => true,
      address: ADDRESS,
      walletClient: {} as never,
      profile: { name: "Test" },
      skipVerify: true,
      publishProfile: async () => false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.step, "nostr");
  });

  it("skips XMTP when already active and only publishes Nostr", async () => {
    let xmtpCalled = false;
    let publishCalled = false;
    const result = await enableMessagingFull({
      enableMessages: async () => {
        xmtpCalled = true;
        return true;
      },
      address: ADDRESS,
      walletClient: {} as never,
      profile: null,
      xmtpAlreadyActive: true,
      skipVerify: true,
      publishProfile: async () => {
        publishCalled = true;
        return false;
      },
    });
    assert.equal(xmtpCalled, false);
    assert.equal(publishCalled, true);
    assert.equal(result.ok, false);
    assert.equal(result.step, "nostr");
  });

  it("publishes only messagesEnabled with expectExisting from profile read", async () => {
    let capturedPatch: NostrProfileData | undefined;
    let capturedOpts: PublishNostrProfileOpts | undefined;

    await enableMessagingFull({
      enableMessages: async () => true,
      address: ADDRESS,
      walletClient: {} as never,
      profile: { name: "Test" },
      skipVerify: true,
      publishProfile: async (data, _address, _signer, opts) => {
        capturedPatch = data;
        capturedOpts = opts;
        return true;
      },
    });

    assert.deepEqual(capturedPatch, { messagesEnabled: true });
    assert.equal("name" in (capturedPatch ?? {}), false);
    assert.equal("about" in (capturedPatch ?? {}), false);
    assert.equal("picture" in (capturedPatch ?? {}), false);
    assert.equal("website" in (capturedPatch ?? {}), false);
    assert.equal(capturedOpts?.expectExisting, true);

    capturedPatch = undefined;
    capturedOpts = undefined;

    await enableMessagingFull({
      enableMessages: async () => true,
      address: ADDRESS,
      walletClient: {} as never,
      profile: null,
      skipVerify: true,
      publishProfile: async (data, _address, _signer, opts) => {
        capturedPatch = data;
        capturedOpts = opts;
        return true;
      },
    });

    assert.deepEqual(capturedPatch, { messagesEnabled: true });
    assert.equal(capturedOpts?.expectExisting, false);
  });
});

describe("enableMessagingFullError", () => {
  it("maps steps to user-facing copy", () => {
    assert.match(enableMessagingFullError("xmtp"), /enable messages/i);
    assert.match(enableMessagingFullError("nostr"), /preference/i);
    assert.match(enableMessagingFullError("verify", "network"), /network/i);
    assert.match(enableMessagingFullError("verify", "relay"), /profile still shows/i);
  });
});
