import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSnapshot } from "../lib/messaging/ports.ts";
import {
  needsMessagingSetupCard,
  needsSellerUnreachableDisclosure,
  primaryActionFromSnapshot,
} from "../lib/messaging/snapshot-ui.ts";

describe("primaryActionFromSnapshot", () => {
  it("maps every next value to the matching command", () => {
    const cases: Array<{ snapshot: SessionSnapshot; type: string; label: string }> = [
      {
        snapshot: { state: "disabled", intent: "absent", next: "enable" },
        type: "enable",
        label: "Enable messages",
      },
      {
        snapshot: { state: "disabled", intent: "explicit", next: "enable" },
        type: "enable",
        label: "Enable messages",
      },
      {
        snapshot: {
          state: "needs_signature",
          reason: "not_registered",
          next: "enable",
        },
        type: "enable",
        label: "Enable messages",
      },
      {
        snapshot: {
          state: "needs_signature",
          reason: "build_failed",
          next: "retry",
        },
        type: "retry",
        label: "Retry",
      },
      {
        snapshot: {
          state: "needs_signature",
          reason: "installation_limit",
          next: "resetIdentity",
        },
        type: "resetIdentity",
        label: "Free a device slot",
      },
      {
        snapshot: { state: "error", reason: "timeout", next: "retry" },
        type: "retry",
        label: "Retry",
      },
      {
        snapshot: { state: "error", reason: "opfs_lock", next: "cancel" },
        type: "cancel",
        label: "Cancel",
      },
      {
        snapshot: {
          state: "error",
          reason: "installation_limit",
          next: "resetIdentity",
        },
        type: "resetIdentity",
        label: "Free a device slot",
      },
      {
        snapshot: {
          state: "active",
          publiclyReachable: true,
          publishError: "publish_failed",
          next: "retry",
        },
        type: "retry",
        label: "Retry",
      },
    ];

    for (const row of cases) {
      const action = primaryActionFromSnapshot(row.snapshot);
      assert.ok(action, JSON.stringify(row.snapshot));
      assert.equal(action!.command.type, row.type);
      assert.equal(action!.label, row.label);
    }
  });

  it("returns null when next is absent", () => {
    assert.equal(
      primaryActionFromSnapshot({
        state: "active",
        publiclyReachable: true,
      }),
      null,
    );
    assert.equal(primaryActionFromSnapshot({ state: "disconnected" }), null);
    assert.equal(primaryActionFromSnapshot({ state: "unsupported" }), null);
    assert.equal(
      primaryActionFromSnapshot({
        state: "reconciling",
        op: "intent",
        deadlineMs: Date.now() + 1000,
      }),
      null,
    );
  });

  it("lock state never maps to retry", () => {
    const action = primaryActionFromSnapshot({
      state: "error",
      reason: "opfs_lock",
      next: "cancel",
    });
    assert.equal(action?.command.type, "cancel");
    assert.notEqual(action?.command.type, "retry");
  });
});

describe("needsMessagingSetupCard / seller disclosure", () => {
  it("shows setup for active publish failure", () => {
    assert.equal(
      needsMessagingSetupCard({
        state: "active",
        publiclyReachable: false,
        publishError: "publish_failed",
        next: "retry",
      }),
      true,
    );
  });

  it("seller unreachable disclosure only when active and not publiclyReachable", () => {
    assert.equal(
      needsSellerUnreachableDisclosure({
        state: "active",
        publiclyReachable: false,
      }),
      true,
    );
    assert.equal(
      needsSellerUnreachableDisclosure({
        state: "active",
        publiclyReachable: true,
      }),
      false,
    );
    assert.equal(
      needsSellerUnreachableDisclosure({
        state: "disabled",
        intent: "explicit",
        next: "enable",
      }),
      false,
    );
  });
});
