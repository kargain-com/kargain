/**
 * Sole owner of the Ponder deploy readiness probe.
 *
 * Modes:
 * - answered — any HTTP status within the deadline (ADR 0010 process probe).
 * - ready200 — HTTP 200 only (ADR 0015 switch gate).
 *
 * Failure = no matching answer within the deadline. Never invents /health.
 */
export const PONDER_READY_DEFAULT_URL = "http://127.0.0.1:42069/ready";
export const PONDER_READY_TIMEOUT_MS = 90_000;
export const PONDER_READY200_TIMEOUT_MS = 600_000;
export const PONDER_READY_INTERVAL_MS = 2_000;

export type PonderReadyMode = "answered" | "ready200";

export type PonderReadyProbeResult =
  | { ok: true; status: number; url: string; elapsedMs: number; mode: PonderReadyMode }
  | {
      ok: false;
      url: string;
      timeoutMs: number;
      elapsedMs: number;
      mode: PonderReadyMode;
      /** True when at least one HTTP response was received (not connection refused). */
      hadAnswer: boolean;
      lastStatus?: number;
    };

export function ponderDidNotBecomeReadyMessage(
  url: string,
  timeoutMs: number,
): string {
  return (
    `ponder_did_not_become_ready: GET ${url} did not answer within ${timeoutMs}ms`
  );
}

/** ADR 0015 §d pending evidence line (exact). */
export function ponderSwitchPendingEvidence(schema: string): string {
  return `deploy_evidence switch=pending schema=${schema}`;
}

export type PonderReadyProbeDeps = {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Poll /ready until the mode's success criterion, or timeout.
 * Connection refused / network errors continue until timeout.
 */
export async function waitForPonderReady(
  opts?: {
    url?: string;
    timeoutMs?: number;
    intervalMs?: number;
    mode?: PonderReadyMode;
  } & PonderReadyProbeDeps,
): Promise<PonderReadyProbeResult> {
  const mode: PonderReadyMode = opts?.mode ?? "answered";
  const url = opts?.url ?? PONDER_READY_DEFAULT_URL;
  const timeoutMs =
    opts?.timeoutMs ??
    (mode === "ready200"
      ? PONDER_READY200_TIMEOUT_MS
      : PONDER_READY_TIMEOUT_MS);
  const intervalMs = opts?.intervalMs ?? PONDER_READY_INTERVAL_MS;
  const fetchFn = opts?.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep =
    opts?.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts?.now ?? Date.now;

  const started = now();
  let hadAnswer = false;
  let lastStatus: number | undefined;
  for (;;) {
    const elapsedMs = now() - started;
    if (elapsedMs >= timeoutMs) {
      return { ok: false, url, timeoutMs, elapsedMs, mode, hadAnswer, lastStatus };
    }
    try {
      const res = await fetchFn(url, { method: "GET", redirect: "manual" });
      hadAnswer = true;
      lastStatus = res.status;
      if (mode === "answered") {
        return {
          ok: true,
          status: res.status,
          url,
          elapsedMs: now() - started,
          mode,
        };
      }
      if (res.status === 200) {
        return {
          ok: true,
          status: 200,
          url,
          elapsedMs: now() - started,
          mode,
        };
      }
      // ready200: 503 etc. keep polling
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
        mode,
        hadAnswer,
        lastStatus,
      };
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}
