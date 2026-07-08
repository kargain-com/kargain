import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyProfileEvent,
  buildEthereumProfileFilter,
  createEmptyProfileBatchState,
  ethereumAddressFromEvent,
  profileMapFromState,
} from "../lib/nostr/batch-profiles.ts";

function kind0Event(overrides: {
  content?: string;
  created_at?: number;
  tags?: string[][];
} = {}) {
  return {
    content: overrides.content ?? JSON.stringify({ name: "Test" }),
    created_at: overrides.created_at ?? 1_700_000_000,
    tags:
      overrides.tags ??
      [["i", "ethereum:0x1111111111111111111111111111111111111111"]],
  };
}

describe("buildEthereumProfileFilter", () => {
  it("dedupes and lowercases ethereum identity tags", () => {
    const filter = buildEthereumProfileFilter([
      "0xAbCdEf1111111111111111111111111111111111",
      "0xabcdef1111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ]);

    assert.deepEqual(filter["#i"], [
      "ethereum:0xabcdef1111111111111111111111111111111111",
      "ethereum:0x2222222222222222222222222222222222222222",
    ]);
    assert.equal(filter.kinds?.[0], 0);
    assert.equal(filter.limit, 4);
  });
});

describe("ethereumAddressFromEvent", () => {
  it("parses ethereum identity tag to lowercased address", () => {
    const address = ethereumAddressFromEvent(
      kind0Event({
        tags: [["i", "ethereum:0xAbCdEf1234567890AbCdEf1234567890AbCdEf12"]],
      }),
    );
    assert.equal(address, "0xabcdef1234567890abcdef1234567890abcdef12");
  });

  it("returns null when no ethereum tag is present", () => {
    assert.equal(ethereumAddressFromEvent(kind0Event({ tags: [] })), null);
  });
});

describe("applyProfileEvent", () => {
  it("accumulates profiles for multiple addresses", () => {
    let state = createEmptyProfileBatchState();

    state = applyProfileEvent(
      state,
      kind0Event({
        content: JSON.stringify({ lud16: "a@example.com" }),
        tags: [["i", "ethereum:0x1111111111111111111111111111111111111111"]],
        created_at: 100,
      }),
    );
    state = applyProfileEvent(
      state,
      kind0Event({
        content: JSON.stringify({ lud16: "b@example.com" }),
        tags: [["i", "ethereum:0x2222222222222222222222222222222222222222"]],
        created_at: 200,
      }),
    );

    const map = profileMapFromState(state);
    assert.equal(map.size, 2);
    assert.equal(map.get("0x1111111111111111111111111111111111111111")?.lud16, "a@example.com");
    assert.equal(map.get("0x2222222222222222222222222222222222222222")?.lud16, "b@example.com");
  });

  it("keeps the newest kind:0 event per address", () => {
    let state = createEmptyProfileBatchState();

    state = applyProfileEvent(
      state,
      kind0Event({
        content: JSON.stringify({ lud16: "old@example.com" }),
        created_at: 100,
      }),
    );
    state = applyProfileEvent(
      state,
      kind0Event({
        content: JSON.stringify({ lud16: "new@example.com" }),
        created_at: 200,
      }),
    );
    state = applyProfileEvent(
      state,
      kind0Event({
        content: JSON.stringify({ lud16: "stale@example.com" }),
        created_at: 50,
      }),
    );

    const map = profileMapFromState(state);
    assert.equal(map.get("0x1111111111111111111111111111111111111111")?.lud16, "new@example.com");
  });
});
