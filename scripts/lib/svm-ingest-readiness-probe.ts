/**
 * Sole owner of the svm-ingest deploy readiness probe.
 *
 * Success = reserved GET /ready answered with HTTP 200 (caught up). Any other
 * answered status is not success — keep polling until the deadline, then fail
 * with classifySvmIngestReadySurface + payload status. Failure with no answer
 * = timeout (crash-loop / dead process).
 */
import {
  classifySvmIngestReadySurface,
  type SvmIngestReadyPayload,
} from "../../src/svm-ingest/http-health.js";

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
    };

export function svmIngestDidNotBecomeReadyMessage(
  result: Extract<SvmIngestReadyProbeResult, { ok: false }>,
): string {
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

function parseReadyPayload(body: string): SvmIngestReadyPayload | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed == null || typeof parsed !== "object") return null;
    const rec = parsed as Record<string, unknown>;
    if (rec.status !== "ready" && rec.status !== "not_ready") return null;
    return {
      status: rec.status,
      bootstrapState:
        rec.bootstrapState === null || typeof rec.bootstrapState === "string"
          ? (rec.bootstrapState as string | null)
          : null,
      incident:
        rec.incident === null || typeof rec.incident === "string"
          ? (rec.incident as string | null)
          : null,
      lagSlots: typeof rec.lagSlots === "number" ? rec.lagSlots : 0,
      lastContiguousSlot:
        typeof rec.lastContiguousSlot === "number" ? rec.lastContiguousSlot : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Poll until /ready returns HTTP 200, or the timeout expires.
 * Non-200 answers are not readiness — keep polling; on timeout classify the
 * last payload. Connection refused / network errors continue until timeout.
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

  const started = now();
  for (;;) {
    const elapsedMs = now() - started;
    if (elapsedMs >= timeoutMs) {
      return {
        ok: false,
        url,
        timeoutMs,
        elapsedMs,
        lastHttpStatus,
        classification:
          lastPayload != null
            ? classifySvmIngestReadySurface(lastPayload)
            : null,
        payloadStatus: lastPayload?.status ?? null,
      };
    }
    try {
      const res = await fetchFn(url, { method: "GET", redirect: "manual" });
      lastHttpStatus = res.status;
      const body = await res.text();
      const payload = parseReadyPayload(body);
      if (payload != null) lastPayload = payload;
      if (res.status === 200) {
        return {
          ok: true,
          status: res.status,
          url,
          elapsedMs: now() - started,
        };
      }
    } catch {
      // Not listening yet — keep polling until deadline.
    }
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) {
      return {
        ok: false,
        url,
        timeoutMs,
        elapsedMs: now() - started,
        lastHttpStatus,
        classification:
          lastPayload != null
            ? classifySvmIngestReadySurface(lastPayload)
            : null,
        payloadStatus: lastPayload?.status ?? null,
      };
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}
