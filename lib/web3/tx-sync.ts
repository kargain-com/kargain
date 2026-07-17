export const INDEXER_SYNC_INTERVAL_MS = 1_000;
export const INDEXER_SYNC_MAX_ATTEMPTS = 30;
export const INDEXER_SYNC_CONSECUTIVE_FAILURES = 3;

export const TX_SYNC_LAG_ADVISORY =
  "Confirmed on chain. The display may take a moment to catch up.";

export type IndexerBlockNumberResult =
  | { ok: true; blockNumber: number }
  | { ok: false };

export type PollUntilResult<T> =
  | { status: "matched"; value: T; attempts: number }
  | { status: "exhausted"; value: T | undefined; attempts: number }
  | { status: "cancelled"; value: T | undefined; attempts: number };

type PollUntilOptions<T> = {
  poll: () => Promise<T>;
  predicate: (value: T) => boolean;
  intervalMs: number;
  maxAttempts: number;
  wait: (ms: number) => Promise<void>;
  shouldContinue?: () => boolean;
};

type WaitForIndexerBlockOptions = {
  targetBlock: bigint;
  fetchStatus: () => Promise<IndexerBlockNumberResult>;
  wait: (ms: number) => Promise<void>;
};

export async function pollUntil<T>({
  poll,
  predicate,
  intervalMs,
  maxAttempts,
  wait,
  shouldContinue = () => true,
}: PollUntilOptions<T>): Promise<PollUntilResult<T>> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("pollUntil maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new Error("pollUntil intervalMs must be non-negative");
  }

  let latestValue: T | undefined;
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (!shouldContinue()) {
      return { status: "cancelled", value: latestValue, attempts };
    }

    let value: T;
    try {
      value = await poll();
      attempts += 1;
      latestValue = value;
    } catch {
      attempts += 1;
      if (!shouldContinue()) {
        return { status: "cancelled", value: latestValue, attempts };
      }
      if (attempts < maxAttempts) await wait(intervalMs);
      continue;
    }

    if (!shouldContinue()) {
      return { status: "cancelled", value: latestValue, attempts };
    }

    try {
      if (predicate(value)) {
        return { status: "matched", value, attempts };
      }
    } catch {
      // A predicate failure is a transient miss, just like a failed poll.
    }

    if (attempts < maxAttempts) {
      if (!shouldContinue()) {
        return { status: "cancelled", value: latestValue, attempts };
      }
      await wait(intervalMs);
    }
  }

  return { status: "exhausted", value: latestValue, attempts };
}

export async function waitForIndexerBlock({
  targetBlock,
  fetchStatus,
  wait,
}: WaitForIndexerBlockOptions): Promise<{ synced: boolean }> {
  let consecutiveFailures = 0;

  for (
    let attempt = 0;
    attempt < INDEXER_SYNC_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const status = await fetchStatus();
      if (status.ok) {
        consecutiveFailures = 0;
        if (BigInt(status.blockNumber) >= targetBlock) {
          return { synced: true };
        }
      } else {
        consecutiveFailures += 1;
        if (consecutiveFailures >= INDEXER_SYNC_CONSECUTIVE_FAILURES) {
          return { synced: false };
        }
      }
    } catch {
      consecutiveFailures += 1;
      if (consecutiveFailures >= INDEXER_SYNC_CONSECUTIVE_FAILURES) {
        return { synced: false };
      }
    }

    if (attempt < INDEXER_SYNC_MAX_ATTEMPTS - 1) {
      await wait(INDEXER_SYNC_INTERVAL_MS);
    }
  }

  return { synced: false };
}
