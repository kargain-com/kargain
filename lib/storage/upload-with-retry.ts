const DEFAULT_ATTEMPTS = 3;

/**
 * Bounded retry with linear backoff `400 * (attempt + 1)` ms between tries.
 * Final failure rethrows the last error (or a generic Error).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = DEFAULT_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed.");
}
