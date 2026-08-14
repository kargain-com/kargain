import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { INDEXER_QUERY_KEY_PREFIXES } from "../lib/web3/indexer-query-keys.ts";
import { ponderBaseUrl } from "../lib/web3/ponder-fetch.ts";
import {
  ponderStatusFetch,
  ponderTransportFetch,
} from "../lib/web3/ponder-fetch-transport.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ponderBaseUrl", () => {
  it("defaults when env missing or blank", () => {
    assert.equal(ponderBaseUrl(undefined), "http://localhost:42069");
    assert.equal(ponderBaseUrl(""), "http://localhost:42069");
    assert.equal(ponderBaseUrl("   "), "http://localhost:42069");
  });

  it("trims whitespace and trailing slashes", () => {
    assert.equal(
      ponderBaseUrl(" https://ponder.kargain.com/ "),
      "https://ponder.kargain.com",
    );
    assert.equal(
      ponderBaseUrl("http://localhost:42069///"),
      "http://localhost:42069",
    );
  });
});

describe("ponder transport (wait / CLI)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("ponderStatusFetch forces no-store for T4 wait", async () => {
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      seenInit = init;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await ponderStatusFetch("http://localhost:42069/status");
    assert.equal(seenInit?.cache, "no-store");
  });

  it("ponderTransportFetch passes init through", async () => {
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      seenInit = init;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await ponderTransportFetch("http://localhost:42069/x", {
      headers: { Accept: "application/json" },
    });
    assert.equal(
      (seenInit?.headers as Record<string, string> | undefined)?.Accept,
      "application/json",
    );
  });
});

describe("revalidateIndexerCache contract (point 8)", () => {
  it("Server Action updateTag-s every INDEXER_QUERY_KEY_PREFIXES entry", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "app/actions/revalidate-indexer-cache.ts"),
      "utf8",
    );
    assert.match(src, /updateTag/);
    assert.match(src, /INDEXER_QUERY_KEY_PREFIXES/);
    // Ban the SWR call site; comments may name the discarded API.
    assert.doesNotMatch(src, /revalidateTag\s*\(/);
    for (const prefix of INDEXER_QUERY_KEY_PREFIXES) {
      // Loop uses the array — pin the import + for-of pattern
      assert.ok(prefix.length > 0);
    }
    assert.match(src, /for\s*\(\s*const\s+tag\s+of\s+INDEXER_QUERY_KEY_PREFIXES\s*\)/);
    assert.match(src, /updateTag\(\s*tag\s*\)/);
  });

  it("syncReads calls revalidateIndexerCache before router.refresh", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "hooks/use-tx-sync.ts"),
      "utf8",
    );
    const revalidateAt = src.indexOf("revalidateIndexerCache");
    const refreshAt = src.indexOf("router.refresh()");
    assert.ok(revalidateAt >= 0, "must call revalidateIndexerCache");
    assert.ok(refreshAt >= 0, "must call router.refresh");
    assert.ok(
      revalidateAt < refreshAt,
      "updateTag SA must run before router.refresh",
    );
    assert.match(src, /setSyncLagged\(!synced \|\| !revalidate\.ok\)/);
  });
});
