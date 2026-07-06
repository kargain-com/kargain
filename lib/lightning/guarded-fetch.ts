const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 65_536;

export type GuardedFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
};

async function readBodyWithCap(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader != null) {
    const length = Number(lengthHeader);
    if (Number.isFinite(length) && length > maxBytes) return null;
  }

  if (!response.body) {
    const text = await response.text();
    if (text.length > maxBytes) return null;
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) return null;
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

/** Server-side JSON fetch with timeout, no redirects, and response size cap. */
export async function guardedJsonFetch(
  url: string,
  options?: GuardedFetchOptions,
): Promise<unknown | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) return null;

    const body = await readBodyWithCap(response, maxBytes);
    if (body == null) return null;

    try {
      return JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
