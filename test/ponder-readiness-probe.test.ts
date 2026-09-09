/**
 * Fail instrument: readiness probe must fail by name against a dead service.
 * Uses the real polling module — not a re-implementation.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";

import {
  ponderDidNotBecomeReadyMessage,
  waitForPonderReady,
} from "../scripts/lib/ponder-readiness-probe.ts";

describe("ponder-readiness-probe", () => {
  it("constructed: never-ready service fails with named refusal", async () => {
    // Bind nothing — use a port that is not accepting connections.
    const url = "http://127.0.0.1:1/ready";
    const result = await waitForPonderReady({
      url,
      timeoutMs: 80,
      intervalMs: 20,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    const msg = ponderDidNotBecomeReadyMessage(result.url, result.timeoutMs);
    assert.equal(
      msg,
      "ponder_did_not_become_ready: GET http://127.0.0.1:1/ready did not answer within 80ms",
    );
  });

  it("accepts HTTP 503 as ready (backfill is not a crash-loop)", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 503;
      res.end("backfill");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await waitForPonderReady({
        url: `http://127.0.0.1:${port}/ready`,
        timeoutMs: 2_000,
        intervalMs: 50,
      });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("unreachable");
      assert.equal(result.status, 503);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("accepts HTTP 200 as ready", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await waitForPonderReady({
        url: `http://127.0.0.1:${port}/ready`,
        timeoutMs: 2_000,
        intervalMs: 50,
      });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("unreachable");
      assert.equal(result.status, 200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
