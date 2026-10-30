/**
 * Sole owner of live follow scheduling for svm-ingest.
 * One follow tick at a time; next tick starts only after pollMs from the previous finish.
 * No setInterval overlap — budgeted RPC and discovery assume serial ticks.
 */

export type RunFollowLoopArgs = {
  followOnce: () => Promise<void>;
  pollMs: number;
  signal: AbortSignal;
  onError?: (err: unknown) => void;
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs until `signal` aborts. Errors from followOnce are reported and do not stop the loop
 * (ingest incidents are recorded inside the loop; unexpected throws are logged by the caller).
 */
export async function runFollowLoop(args: RunFollowLoopArgs): Promise<void> {
  const { followOnce, pollMs, signal, onError } = args;
  if (!Number.isFinite(pollMs) || pollMs < 0) {
    throw new Error(`runFollowLoop pollMs must be a non-negative number (got ${pollMs})`);
  }
  while (!signal.aborted) {
    try {
      await followOnce();
    } catch (err) {
      onError?.(err);
    }
    if (signal.aborted) return;
    await sleep(pollMs, signal);
  }
}
