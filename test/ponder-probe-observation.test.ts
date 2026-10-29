/**
 * Probe observation parser — models every observation the executor may see.
 * Red: bare status digit (legacy writer probe), non-object JSON, unknown kind.
 * Green: exact typed shapes only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProbeObservationJson } from "../scripts/lib/ponder-probe-observation.js";

describe("parseProbeObservationJson", () => {
  it("legacy bare status digit is red", () => {
    const r = parseProbeObservationJson("200");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "not_object");
  });

  it("plain text / empty is red", () => {
    assert.equal(parseProbeObservationJson("").ok, false);
    assert.equal(parseProbeObservationJson("ok").ok, false);
    assert.equal(parseProbeObservationJson("null").ok, false);
    assert.equal(parseProbeObservationJson("[]").ok, false);
  });

  it("unknown kind / extra fields / bad code are red", () => {
    assert.equal(
      parseProbeObservationJson(JSON.stringify({ kind: "ready" })).ok,
      false,
    );
    assert.equal(
      parseProbeObservationJson(
        JSON.stringify({ kind: "status", code: "200" }),
      ).ok,
      false,
    );
    assert.equal(
      parseProbeObservationJson(
        JSON.stringify({ kind: "status", code: 200, extra: 1 }),
      ).ok,
      false,
    );
    assert.equal(
      parseProbeObservationJson(JSON.stringify({ kind: "no_answer", x: 1 })).ok,
      false,
    );
    assert.equal(
      parseProbeObservationJson(JSON.stringify({ kind: "probe_failed" })).ok,
      false,
    );
  });

  it("typed status / no_answer / probe_failed are green", () => {
    assert.deepEqual(parseProbeObservationJson('{"kind":"status","code":200}'), {
      ok: true,
      value: { kind: "status", code: 200 },
    });
    assert.deepEqual(parseProbeObservationJson('{"kind":"status","code":503}'), {
      ok: true,
      value: { kind: "status", code: 503 },
    });
    assert.deepEqual(parseProbeObservationJson('{"kind":"no_answer"}'), {
      ok: true,
      value: { kind: "no_answer" },
    });
    assert.deepEqual(
      parseProbeObservationJson(
        '{"kind":"probe_failed","detail":"probe_cli_failed"}',
      ),
      {
        ok: true,
        value: { kind: "probe_failed", detail: "probe_cli_failed" },
      },
    );
  });
});
