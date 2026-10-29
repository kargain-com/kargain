/**
 * Fail instrument: readiness probe must fail by name against a dead service.
 * Uses the real polling module — not a re-implementation.
 *
 * B7: ready200 pending evidence is only valid after hadAnswer=true
 * (CLI gates on result.hadAnswer; library exposes the flag).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";

import {
  ponderDidNotBecomeReadyMessage,
  ponderSwitchPendingEvidence,
  waitForPonderReady,
} from "../scripts/lib/ponder-readiness-probe.ts";

describe("ponder-readiness-probe", () => {
  it("constructed: never-ready service fails with named refusal", async () => {
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

  it("answered mode accepts HTTP 503 as ready (backfill is not a crash-loop)", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 503;
      res.end("backfill");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await waitForPonderReady({
        url: `http://127.0.0.1:${port}/ready`,
        mode: "answered",
        timeoutMs: 2_000,
        intervalMs: 50,
      });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("unreachable");
      assert.equal(result.status, 503);
      assert.equal(result.mode, "answered");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("answered mode accepts HTTP 200 as ready", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await waitForPonderReady({
        url: `http://127.0.0.1:${port}/ready`,
        mode: "answered",
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

  it("ready200 mode rejects 503 and accepts 200", async () => {
    let n = 0;
    const server = createServer((_req, res) => {
      n += 1;
      res.statusCode = n < 3 ? 503 : 200;
      res.end(n < 3 ? "backfill" : "ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await waitForPonderReady({
        url: `http://127.0.0.1:${port}/ready`,
        mode: "ready200",
        timeoutMs: 2_000,
        intervalMs: 20,
      });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("unreachable");
      assert.equal(result.status, 200);
      assert.equal(result.mode, "ready200");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("B7: ready200 timeout with never-answered reports hadAnswer=false (no pending)", async () => {
    const result = await waitForPonderReady({
      url: "http://127.0.0.1:1/ready",
      mode: "ready200",
      timeoutMs: 80,
      intervalMs: 20,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.hadAnswer, false);
    // CLI may print pending only when hadAnswer; never-answered must not look pending.
    assert.equal(
      ponderSwitchPendingEvidence("k_" + "a".repeat(40)).startsWith(
        "deploy_evidence switch=pending",
      ),
      true,
    );
  });

  it("B7: ready200 timeout after non-200 answers reports hadAnswer=true (pending ok)", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 503;
      res.end("backfill");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await waitForPonderReady({
        url: `http://127.0.0.1:${port}/ready`,
        mode: "ready200",
        timeoutMs: 80,
        intervalMs: 20,
      });
      assert.equal(result.ok, false);
      if (result.ok) throw new Error("unreachable");
      assert.equal(result.hadAnswer, true);
      assert.equal(result.lastStatus, 503);
      const schema = "k_" + "b".repeat(40);
      assert.equal(
        ponderSwitchPendingEvidence(schema),
        `deploy_evidence switch=pending schema=${schema}`,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
