import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveMessagingStatus,
  messagingStatusIsReady,
  messagingStatusNeedsSetup,
} from "../lib/xmtp/messaging-status.ts";

const base = {
  isConnected: true,
  walletKind: "eoa" as const,
  client: null,
  isInitializing: false,
  error: null,
  optedIn: false,
  disabledLocally: false,
};

describe("deriveMessagingStatus", () => {
  it("returns disconnected when wallet is not connected", () => {
    assert.equal(deriveMessagingStatus({ ...base, isConnected: false }), "disconnected");
  });

  it("returns unsupported for contract wallets", () => {
    assert.equal(
      deriveMessagingStatus({ ...base, walletKind: "contract" }),
      "unsupported",
    );
  });

  it("returns disabled when locally opted out", () => {
    assert.equal(
      deriveMessagingStatus({ ...base, disabledLocally: true }),
      "disabled",
    );
  });

  it("returns active when client exists", () => {
    assert.equal(
      deriveMessagingStatus({ ...base, client: {} as never }),
      "active",
    );
  });

  it("returns initializing while setup is in progress", () => {
    assert.equal(
      deriveMessagingStatus({ ...base, isInitializing: true }),
      "initializing",
    );
  });

  it("returns error when last init failed", () => {
    assert.equal(
      deriveMessagingStatus({ ...base, error: "Failed to initialize XMTP." }),
      "error",
    );
  });

  it("returns inactive before first opt-in", () => {
    assert.equal(deriveMessagingStatus(base), "inactive");
  });

  it("returns initializing when opted in but client not restored", () => {
    assert.equal(deriveMessagingStatus({ ...base, optedIn: true }), "initializing");
  });
});

describe("messaging status helpers", () => {
  it("flags setup-needed states", () => {
    assert.equal(messagingStatusNeedsSetup("inactive"), true);
    assert.equal(messagingStatusNeedsSetup("error"), true);
    assert.equal(messagingStatusNeedsSetup("initializing"), false);
    assert.equal(messagingStatusNeedsSetup("active"), false);
  });

  it("flags ready state", () => {
    assert.equal(messagingStatusIsReady("active"), true);
    assert.equal(messagingStatusIsReady("inactive"), false);
  });
});
