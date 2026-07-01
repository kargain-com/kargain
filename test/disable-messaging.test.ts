import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  disableMessagingFull,
  disableMessagingError,
} from "../lib/xmtp/enable-messaging-full.ts";

const ADDRESS = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;

describe("disableMessagingFull", () => {
  it("does not tear down XMTP when Nostr publish fails", async () => {
    let disabled = false;
    const result = await disableMessagingFull({
      address: ADDRESS,
      walletClient: {} as never,
      profile: null,
      publishPreference: async () => false,
      disableMessages: () => {
        disabled = true;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.step, "nostr");
    assert.equal(disabled, false);
  });

  it("disables XMTP only after successful Nostr publish", async () => {
    let disabled = false;
    const result = await disableMessagingFull({
      address: ADDRESS,
      walletClient: {} as never,
      profile: { name: "Test" },
      publishPreference: async () => true,
      disableMessages: () => {
        disabled = true;
      },
    });
    assert.equal(result.ok, true);
    assert.equal(disabled, true);
  });
});

describe("disableMessagingError", () => {
  it("explains messaging stays active on publish failure", () => {
    assert.match(disableMessagingError("nostr"), /still active/i);
  });
});
