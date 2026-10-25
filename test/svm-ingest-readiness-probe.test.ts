/**
 * Fail instrument: svm-ingest readiness probe with injected fetch.
 * Uses the real polling module — not a re-implementation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifySvmIngestReadySurface,
  type SvmIngestReadyPayload,
} from "../src/svm-ingest/http-health.ts";
import {
  svmIngestDidNotBecomeReadyMessage,
  waitForSvmIngestReady,
} from "../scripts/lib/svm-ingest-readiness-probe.ts";

function jsonResponse(status: number, payload: SvmIngestReadyPayload): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const bootstrapPayload: SvmIngestReadyPayload = {
  status: "not_ready",
  bootstrapState: "bootstrap_range_not_enumerated",
  incident: null,
  lagSlots: 0,
  lastContiguousSlot: 0,
};

const incidentPayload: SvmIngestReadyPayload = {
  status: "not_ready",
  bootstrapState: null,
  incident: "rpc_unavailable",
  lagSlots: 12,
  lastContiguousSlot: 100,
};

const readyPayload: SvmIngestReadyPayload = {
  status: "ready",
  bootstrapState: null,
  incident: null,
  lagSlots: 0,
  lastContiguousSlot: 200,
};

describe("svm-ingest-readiness-probe", () => {
  it("HTTP 200 → ok with status 200", async () => {
    const result = await waitForSvmIngestReady({
      timeoutMs: 200,
      intervalMs: 20,
      sleep: async () => {},
      fetch: async () => jsonResponse(200, readyPayload),
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.status, 200);
  });

  it("503 bootstrap payload until timeout → bootstrap_incomplete", async () => {
    assert.equal(
      classifySvmIngestReadySurface(bootstrapPayload),
      "bootstrap_incomplete",
    );
    const result = await waitForSvmIngestReady({
      timeoutMs: 80,
      intervalMs: 10,
      sleep: async () => {},
      fetch: async () => jsonResponse(503, bootstrapPayload),
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.classification, "bootstrap_incomplete");
    assert.equal(result.payloadStatus, "not_ready");
    const msg = svmIngestDidNotBecomeReadyMessage(result);
    assert.match(msg, /classification=bootstrap_incomplete/);
    assert.match(msg, /payload_status=not_ready/);
  });

  it("503 incident payload until timeout → incident", async () => {
    assert.equal(classifySvmIngestReadySurface(incidentPayload), "incident");
    const result = await waitForSvmIngestReady({
      timeoutMs: 80,
      intervalMs: 10,
      sleep: async () => {},
      fetch: async () => jsonResponse(503, incidentPayload),
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.classification, "incident");
    assert.equal(result.payloadStatus, "not_ready");
    const msg = svmIngestDidNotBecomeReadyMessage(result);
    assert.match(msg, /classification=incident/);
  });

  it("no answer → timeout", async () => {
    const result = await waitForSvmIngestReady({
      timeoutMs: 80,
      intervalMs: 10,
      sleep: async () => {},
      fetch: async () => {
        throw new Error("connection refused");
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.classification, null);
    assert.equal(result.payloadStatus, null);
    assert.equal(
      svmIngestDidNotBecomeReadyMessage(result),
      `svm_ingest_did_not_become_ready: GET ${result.url} did not answer within ${result.timeoutMs}ms`,
    );
  });
});
