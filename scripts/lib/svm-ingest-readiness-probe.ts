/**
 * Sole owner of the svm-ingest deploy readiness probe.
 *
 * Success = reserved GET /ready answered with HTTP 200 (caught up). Any other
 * answered status is not success — keep polling until the deadline, then fail
 * with classifySvmIngestReadySurface + payload status. Failure with no answer
 * = timeout (crash-loop / dead process). A malformed body is named
 * (`payload_malformed: …`) and never classified from invented fields.
 */
import {
  assertSvmIngestReadyServedFacts,
  classifySvmIngestReadySurface,
  type SvmIngestReadyPayload,
} from "../../svm-ingest/http-health.js";

export const SVM_INGEST_READY_DEFAULT_URL = "http://127.0.0.1:42100/ready";
export const SVM_INGEST_READY_TIMEOUT_MS = 90_000;
export const SVM_INGEST_READY_INTERVAL_MS = 2_000;

export type SvmIngestReadyClassification = ReturnType<
  typeof classifySvmIngestReadySurface
>;

export type SvmIngestReadyProbeResult =
  | { ok: true; status: number; url: string; elapsedMs: number }
  | {
      ok: false;
      url: string;
      timeoutMs: number;
      elapsedMs: number;
      lastHttpStatus: number | null;
      classification: SvmIngestReadyClassification | null;
      payloadStatus: SvmIngestReadyPayload["status"] | null;
      payloadMalformed: string | null;
    };

export function svmIngestDidNotBecomeReadyMessage(
  result: Extract<SvmIngestReadyProbeResult, { ok: false }>,
): string {
  if (result.payloadMalformed != null) {
    return (
      `svm_ingest_did_not_become_ready: ${result.payloadMalformed} ` +
      `http_status=${result.lastHttpStatus} within ${result.timeoutMs}ms`
    );
  }
  if (result.classification != null && result.payloadStatus != null) {
    return (
      `svm_ingest_did_not_become_ready: classification=${result.classification} ` +
      `payload_status=${result.payloadStatus} http_status=${result.lastHttpStatus} ` +
      `within ${result.timeoutMs}ms`
    );
  }
  return (
    `svm_ingest_did_not_become_ready: GET ${result.url} did not answer within ${result.timeoutMs}ms`
  );
}

export type SvmIngestReadyProbeDeps = {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type ParseReadyResult =
  | { ok: true; payload: SvmIngestReadyPayload }
  | { ok: false; reason: string };

/**
 * Validate /ready JSON with the surface owner (declared facts) and type-check
 * each field. Never invent defaults for missing or mistyped values.
 */
export function parseSvmIngestReadyPayload(body: string): ParseReadyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: "payload_malformed: invalid_json" };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "payload_malformed: not_object" };
  }
  const rec = parsed as Record<string, unknown>;
  try {
    assertSvmIngestReadyServedFacts(rec);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `payload_malformed: ${msg}` };
  }
  if (rec.status !== "ready" && rec.status !== "not_ready") {
    return { ok: false, reason: "payload_malformed: status" };
  }
  if (
    !(rec.bootstrapState === null || typeof rec.bootstrapState === "string")
  ) {
    return { ok: false, reason: "payload_malformed: bootstrapState" };
  }
  if (!(rec.incident === null || typeof rec.incident === "string")) {
    return { ok: false, reason: "payload_malformed: incident" };
  }
  if (typeof rec.lagSlots !== "number" || !Number.isFinite(rec.lagSlots)) {
    return { ok: false, reason: "payload_malformed: lagSlots" };
  }
  if (
    typeof rec.lastContiguousSlot !== "number" ||
    !Number.isFinite(rec.lastContiguousSlot)
  ) {
    return { ok: false, reason: "payload_malformed: lastContiguousSlot" };
  }
  return {
    ok: true,
    payload: {
      status: rec.status,
      bootstrapState: rec.bootstrapState,
      incident: rec.incident,
      lagSlots: rec.lagSlots,
      lastContiguousSlot: rec.lastContiguousSlot,
    },
  };
}

function timeoutFailure(args: {
  url: string;
  timeoutMs: number;
  elapsedMs: number;
  lastHttpStatus: number | null;
  lastPayload: SvmIngestReadyPayload | null;
  lastMalformed: string | null;
}): Extract<SvmIngestReadyProbeResult, { ok: false }> {
  // Prefer a valid last payload for classification; otherwise name the malformation.
  if (args.lastPayload != null) {
    return {
      ok: false,
      url: args.url,
      timeoutMs: args.timeoutMs,
      elapsedMs: args.elapsedMs,
      lastHttpStatus: args.lastHttpStatus,
      classification: classifySvmIngestReadySurface(args.lastPayload),
      payloadStatus: args.lastPayload.status,
      payloadMalformed: null,
    };
  }
  return {
    ok: false,
    url: args.url,
    timeoutMs: args.timeoutMs,
    elapsedMs: args.elapsedMs,
    lastHttpStatus: args.lastHttpStatus,
    classification: null,
    payloadStatus: null,
    payloadMalformed: args.lastMalformed,
  };
}

/**
 * Poll until /ready returns HTTP 200 with a valid payload, or the timeout
 * expires. Non-200 answers and malformed bodies are not readiness.
 */
export async function waitForSvmIngestReady(
  opts?: {
    url?: string;
    timeoutMs?: number;
    intervalMs?: number;
  } & SvmIngestReadyProbeDeps,
): Promise<SvmIngestReadyProbeResult> {
  const url = opts?.url ?? SVM_INGEST_READY_DEFAULT_URL;
  const timeoutMs = opts?.timeoutMs ?? SVM_INGEST_READY_TIMEOUT_MS;
  const intervalMs = opts?.intervalMs ?? SVM_INGEST_READY_INTERVAL_MS;
  const fetchFn = opts?.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep =
    opts?.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts?.now ?? Date.now;

  let lastHttpStatus: number | null = null;
  let lastPayload: SvmIngestReadyPayload | null = null;
  let lastMalformed: string | null = null;

  const started = now();
  for (;;) {
    const elapsedMs = now() - started;
    if (elapsedMs >= timeoutMs) {
      return timeoutFailure({
        url,
        timeoutMs,
        elapsedMs,
        lastHttpStatus,
        lastPayload,
        lastMalformed,
      });
    }
    try {
      const res = await fetchFn(url, { method: "GET", redirect: "manual" });
      lastHttpStatus = res.status;
      const body = await res.text();
      const parsed = parseSvmIngestReadyPayload(body);
      if (!parsed.ok) {
        // Last observation wins: a malformed answer clears any earlier payload.
        lastMalformed = parsed.reason;
        lastPayload = null;
      } else {
        lastPayload = parsed.payload;
        lastMalformed = null;
        if (res.status === 200) {
          return {
            ok: true,
            status: res.status,
            url,
            elapsedMs: now() - started,
          };
        }
      }
    } catch {
      // Not listening yet — keep polling until deadline.
    }
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) {
      return timeoutFailure({
        url,
        timeoutMs,
        elapsedMs: now() - started,
        lastHttpStatus,
        lastPayload,
        lastMalformed,
      });
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}
