/**
 * Sole owner of the Ponder deploy readiness probe.
 *
 * Success = reserved GET /ready answered with any HTTP status (200 caught up,
 * 503 backfill). Failure = no listener within the deadline — crash-loop / dead
 * process. Never invents a custom /health route.
 */
export const PONDER_READY_DEFAULT_URL = "http://127.0.0.1:42069/ready";
export const PONDER_READY_TIMEOUT_MS = 90_000;
export const PONDER_READY_INTERVAL_MS = 2_000;

export type PonderReadyProbeResult =
  | { ok: true; status: number; url: string; elapsedMs: number }
  | { ok: false; url: string; timeoutMs: number; elapsedMs: number };

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
 * Poll until /ready returns any HTTP status, or the timeout expires.
 * Connection refused / network errors continue until timeout — they are not
 * readiness. No continue-on-error; timeout is the named failure.
 */
export async function waitForPonderReady(
  opts?: {
    url?: string;
    timeoutMs?: number;
    intervalMs?: number;
  } & PonderReadyProbeDeps,
): Promise<PonderReadyProbeResult> {
  const url = opts?.url ?? PONDER_READY_DEFAULT_URL;
  const timeoutMs = opts?.timeoutMs ?? PONDER_READY_TIMEOUT_MS;
  const intervalMs = opts?.intervalMs ?? PONDER_READY_INTERVAL_MS;
  const fetchFn = opts?.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep =
    opts?.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts?.now ?? Date.now;

  const started = now();
  for (;;) {
    const elapsedMs = now() - started;
    if (elapsedMs >= timeoutMs) {
      return { ok: false, url, timeoutMs, elapsedMs };
    }
    try {
      const res = await fetchFn(url, { method: "GET", redirect: "manual" });
      // Any HTTP status proves the process answered (200 or 503 both OK).
      return {
        ok: true,
        status: res.status,
        url,
        elapsedMs: now() - started,
      };
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
      };
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}
