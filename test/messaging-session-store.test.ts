import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  advanceAndSettle,
  createControlledClock,
  openSession,
} from "./messaging-contract-harness.ts";

describe("messaging session-store snapshot cache", () => {
  it("returns the same snapshot reference across consecutive getSnapshot calls", () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      wallet: { address: "0x1111111111111111111111111111111111111111", kind: "eoa" },
    });

    const first = session.getSnapshot();
    const second = session.getSnapshot();
    assert.equal(first, second);
  });

  it("returns stable snapshot reference when wallet address is absent", () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      wallet: { address: null, kind: null },
    });

    const first = session.getSnapshot();
    const second = session.getSnapshot();
    assert.equal(first, second);
  });

  it("updates snapshot reference only after machine onChange", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: {
        readIntent: async () => true,
      },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async () => ({ ok: true, client: { __brand: "XmtpLocalClient" } }),
      },
      wallet: { address: "0x1111111111111111111111111111111111111111", kind: "eoa" },
    });

    const before = session.getSnapshot();
    const mid = session.getSnapshot();
    assert.equal(before, mid);

    await advanceAndSettle(clock, 20_000);
    const after = session.getSnapshot();

    assert.notEqual(before, after);
    assert.notEqual(before.state, after.state);
  });

  it("getXmtpClient does not mutate snapshot reference", () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      wallet: { address: "0x1111111111111111111111111111111111111111", kind: "eoa" },
    });

    const before = session.getSnapshot();
    assert.equal(session.getXmtpClient(), null);
    const after = session.getSnapshot();
    assert.equal(before, after);
  });
});

/**
 * Bundle boundary: ESLint no-restricted-imports blocks @xmtp/client everywhere
 * except lib/messaging/adapters/xmtp-adapter.ts (dynamic import only).
 * No React test rig in repo — store-level snapshot identity tests above.
 */
