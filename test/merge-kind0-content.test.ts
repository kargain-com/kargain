import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeKind0Content } from "../lib/nostr/merge-kind0-content.ts";

describe("mergeKind0Content", () => {
  it("preserves unknown fields like nip05", () => {
    const merged = mergeKind0Content(
      { nip05: "user@example.com", name: "Old" },
      { name: "New" },
    );
    assert.equal(merged.nip05, "user@example.com");
    assert.equal(merged.name, "New");
  });

  it("clears lud16 when patch passes empty string", () => {
    const merged = mergeKind0Content(
      { lud16: "pay@example.com" },
      { lud16: "" },
    );
    assert.equal(merged.lud16, undefined);
  });

  it("leaves messagesEnabled when omitted from patch", () => {
    const merged = mergeKind0Content(
      { messagesEnabled: true, name: "Ada" },
      { name: "Bob" },
    );
    assert.equal(merged.messagesEnabled, true);
    assert.equal(merged.name, "Bob");
  });

  it("writes explicit messagesEnabled false", () => {
    const merged = mergeKind0Content(
      { messagesEnabled: true },
      { messagesEnabled: false },
    );
    assert.equal(merged.messagesEnabled, false);
  });
});
