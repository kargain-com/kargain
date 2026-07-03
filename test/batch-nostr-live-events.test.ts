import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDebouncedNostrEventBuffer } from "../lib/nostr/batch-nostr-live-events.ts";

describe("batch-nostr-live-events", () => {
  it("flushes batched events after debounce", async () => {
    const flushed: number[][] = [];
    const buffer = createDebouncedNostrEventBuffer<number>((batch) => {
      flushed.push(batch);
    }, 50);

    buffer.push(1);
    buffer.push(2);
    assert.equal(flushed.length, 0);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(flushed, [[1, 2]]);
  });

  it("flushNow drains pending immediately", () => {
    const flushed: string[] = [];
    const buffer = createDebouncedNostrEventBuffer<string>((batch) => {
      flushed.push(...batch);
    });

    buffer.push("a");
    buffer.push("b");
    buffer.flushNow();
    assert.deepEqual(flushed, ["a", "b"]);
  });
});
