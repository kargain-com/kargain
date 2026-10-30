/**
 * Fail instrument: svm-ingest readiness probe with injected fetch.
 * Uses the real polling module — not a re-implementation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifySvmIngestReadySurface,
  type SvmIngestReadyPayload,
} from "../svm-ingest/http-health.ts";
import {
  parseSvmIngestReadyPayload,
  svmIngestDidNotBecomeReadyMessage,
  waitForSvmIngestReady,
} from "../scripts/lib/svm-ingest-readiness-probe.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
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
    assert.equal(result.payloadMalformed, null);
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
    assert.equal(result.payloadMalformed, null);
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
    assert.equal(result.payloadMalformed, null);
    assert.equal(
      svmIngestDidNotBecomeReadyMessage(result),
      `svm_ingest_did_not_become_ready: GET ${result.url} did not answer within ${result.timeoutMs}ms`,
    );
  });

  it("malformed 503 body → payload_malformed, no invented classification", async () => {
    const missingSlot = {
      status: "not_ready",
      bootstrapState: "historical_backfill",
      incident: null,
      lagSlots: 0,
      // lastContiguousSlot missing — owner refuses; must not default to 0
    };
    const parsed = parseSvmIngestReadyPayload(JSON.stringify(missingSlot));
    assert.equal(parsed.ok, false);
    if (parsed.ok) throw new Error("unreachable");
    assert.match(parsed.reason, /^payload_malformed:/);
    assert.match(parsed.reason, /lastContiguousSlot/);

    const result = await waitForSvmIngestReady({
      timeoutMs: 80,
      intervalMs: 10,
      sleep: async () => {},
      fetch: async () => jsonResponse(503, missingSlot),
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.classification, null);
    assert.equal(result.payloadStatus, null);
    assert.ok(result.payloadMalformed);
    assert.match(result.payloadMalformed!, /^payload_malformed:/);
    const msg = svmIngestDidNotBecomeReadyMessage(result);
    assert.match(msg, /payload_malformed:/);
    assert.doesNotMatch(msg, /classification=/);
  });

  it("valid 503 then malformed until timeout → last observation is payload_malformed", async () => {
    const missingSlot = {
      status: "not_ready",
      bootstrapState: "historical_backfill",
      incident: null,
      lagSlots: 0,
    };
    let calls = 0;
    const result = await waitForSvmIngestReady({
      timeoutMs: 80,
      intervalMs: 10,
      sleep: async () => {},
      fetch: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse(503, bootstrapPayload);
        return jsonResponse(503, missingSlot);
      },
    });
    assert.ok(calls >= 2, "must observe bootstrap then malformed");
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.classification, null);
    assert.equal(result.payloadStatus, null);
    assert.ok(result.payloadMalformed);
    assert.match(result.payloadMalformed!, /^payload_malformed:/);
    assert.doesNotMatch(
      svmIngestDidNotBecomeReadyMessage(result),
      /classification=/,
    );
  });
});
