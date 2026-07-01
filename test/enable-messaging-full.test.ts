import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
    });
    assert.equal(result.ok, false);
    assert.equal(result.step, "xmtp");
  });

  it("returns nostr step when profile publish fails", async () => {
    const result = await enableMessagingFull({
      enableMessages: async () => true,
      address: ADDRESS,
      walletClient: {
        signMessage: async () => {
          throw new Error("rejected");
        },
      } as never,
      profile: { name: "Test" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.step, "nostr");
  });

  it("skips XMTP when already active and only publishes Nostr", async () => {
    let xmtpCalled = false;
    const result = await enableMessagingFull({
      enableMessages: async () => {
        xmtpCalled = true;
        return true;
      },
      address: ADDRESS,
      walletClient: {
        signMessage: async () => {
          throw new Error("rejected");
        },
      } as never,
      profile: null,
      xmtpAlreadyActive: true,
    });
    assert.equal(xmtpCalled, false);
    assert.equal(result.ok, false);
    assert.equal(result.step, "nostr");
  });
});

describe("enableMessagingFullError", () => {
  it("maps steps to user-facing copy", () => {
    assert.match(enableMessagingFullError("xmtp"), /enable messages/i);
    assert.match(enableMessagingFullError("nostr"), /preference/i);
  });
});
