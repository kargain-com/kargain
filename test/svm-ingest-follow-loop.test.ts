/**
 * Follow loop serialisation + RPC budget ownership (no dual 429 path).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { runFollowLoop } from "../src/svm-ingest/follow-loop.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("svm-ingest follow loop owner", () => {
  it("runs ticks serially — next starts only after previous finishes + pollMs", async () => {
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    const ac = new AbortController();
    let ticks = 0;

    const done = runFollowLoop({
      pollMs: 20,
      signal: ac.signal,
      followOnce: async () => {
        ticks += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        events.push(`start-${ticks}`);
        await new Promise((r) => setTimeout(r, 30));
        events.push(`end-${ticks}`);
        active -= 1;
        if (ticks >= 3) ac.abort();
      },
    });

    await done;
    assert.equal(maxActive, 1);
    assert.deepEqual(events, [
      "start-1",
      "end-1",
      "start-2",
      "end-2",
      "start-3",
      "end-3",
    ]);
  });

  it("main does not schedule follow with setInterval", () => {
    const mainSrc = fs.readFileSync(
      path.join(ROOT, "src/svm-ingest/main.ts"),
      "utf8",
    );
    assert.ok(mainSrc.includes("runFollowLoop"));
    assert.ok(!/\bsetInterval\b/.test(mainSrc));
    assert.ok(!/followInFlight/.test(mainSrc));
  });
});

describe("svm-ingest RPC budget sole owner", () => {
  it("disables web3.js rate-limit retry so with429Backoff is the only 429 path", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/svm-ingest/rpc-client.ts"),
      "utf8",
    );
    assert.ok(src.includes("disableRetryOnRateLimit: true"));
    assert.ok(src.includes("with429Backoff"));
    assert.ok(src.includes("SvmIngestRpcBudgetExhaustedError"));
  });
});
