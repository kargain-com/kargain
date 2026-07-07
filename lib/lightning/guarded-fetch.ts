import dns, { type LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";

import { Agent, fetch } from "undici";

import {
  assertResolvedAddressesAllowed,
  ForbiddenAddressError,
} from "@/lib/lightning/ip-guard";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 65_536;

export type GuardedFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
};

type DnsLookupFn = typeof dns.lookup;

export function createPinnedLookup(lookupFn: DnsLookupFn = dns.lookup): LookupFunction {
  return (hostname, options, callback) => {
    const wantsAll =
      typeof options === "object" && options != null && options.all === true;

    lookupFn(
      hostname,
      { ...(typeof options === "object" && options != null ? options : {}), all: true },
      (err: NodeJS.ErrnoException | null, result: string | LookupAddress[], family?: number) => {
        if (err) {
          callback(err, "", 4);
          return;
        }

        const resolved = Array.isArray(result)
          ? result
          : [{ address: result, family: family ?? -1 }];

        try {
          assertResolvedAddressesAllowed(resolved);
        } catch (error) {
          callback(error instanceof Error ? error : new ForbiddenAddressError(), "", 4);
          return;
        }

        if (wantsAll) {
          callback(null, resolved);
          return;
        }

        const first = resolved[0]!;
        callback(null, first.address, first.family);
      },
    );
  };
}

const pinnedAgent = new Agent({
  connect: {
    lookup: createPinnedLookup(),
  },
});

async function readBodyWithCap(
  response: Awaited<ReturnType<typeof fetch>>,
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
      dispatcher: pinnedAgent,
      signal: controller.signal,
      redirect: "error",
      headers: { accept: "application/json" },
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

export const __testing = {
  createPinnedLookup,
  ForbiddenAddressError,
};
