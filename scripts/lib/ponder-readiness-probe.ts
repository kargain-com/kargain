/**
 * Sole owner of the Ponder deploy readiness probe (ADR 0010, ADR 0016 §g).
 *
 * Modes:
 * - answered — any HTTP status on the reserved GET /ready within the deadline
 *   (200 caught up, 503 backfill). No answer = crash loop / dead process.
 * - ready200 — HTTP 200 within the deadline. At the deadline the result says
 *   whether the last attempt was answered (catching up) or not (stopped).
 *
 * Never invents a custom /health route.
 */
/** The writer on the Compose network, as seen from `ponder-deploy` (ADR 0016 §e). */
export const PONDER_READY_DEFAULT_URL = "http://ponder:42069/ready";
export const PONDER_READY_TIMEOUT_MS = 90_000;
export const PONDER_READY200_TIMEOUT_MS = 600_000;
export const PONDER_READY_INTERVAL_MS = 2_000;

export type PonderReadyMode = "answered" | "ready200";

export type PonderReadyProbeResult =
  | {
      ok: true;
      mode: PonderReadyMode;
      status: number;
      url: string;
      elapsedMs: number;
    }
  | {
      ok: false;
      mode: PonderReadyMode;
      url: string;
      timeoutMs: number;
      elapsedMs: number;
      /** Status of the last attempt when it was answered; null when it was not. */
      lastStatus: number | null;
    };

export function ponderDidNotBecomeReadyMessage(
  url: string,
  timeoutMs: number,
): string {
  return (
    `ponder_did_not_become_ready: GET ${url} did not answer within ${timeoutMs}ms`
  );
}

export type PonderReadyProbeDeps = {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Poll /ready until the mode's success criterion, or the timeout expires.
 * Connection refused / network errors continue until timeout — they are not
 * readiness. No continue-on-error; timeout is the named failure.
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
    (mode === "ready200" ? PONDER_READY200_TIMEOUT_MS : PONDER_READY_TIMEOUT_MS);
  const intervalMs = opts?.intervalMs ?? PONDER_READY_INTERVAL_MS;
  const fetchFn = opts?.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep =
    opts?.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts?.now ?? Date.now;

  const started = now();
  let lastStatus: number | null = null;
  for (;;) {
    const elapsedMs = now() - started;
    if (elapsedMs >= timeoutMs) {
      return { ok: false, mode, url, timeoutMs, elapsedMs, lastStatus };
    }
    try {
      const res = await fetchFn(url, { method: "GET", redirect: "manual" });
      lastStatus = res.status;
      if (mode === "answered" || res.status === 200) {
        return {
          ok: true,
          mode,
          status: res.status,
          url,
          elapsedMs: now() - started,
        };
      }
    } catch {
      // Not listening (or no longer listening) — keep polling until deadline.
      lastStatus = null;
    }
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) {
      return {
        ok: false,
        mode,
        url,
        timeoutMs,
        elapsedMs: now() - started,
        lastStatus,
      };
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}
