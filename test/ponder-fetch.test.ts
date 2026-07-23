import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ponderBaseUrl, ponderFetch } from "../lib/web3/ponder-fetch.ts";

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

describe("ponderFetch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("always sets cache no-store even when caller passes revalidate or cache", async () => {
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      seenInit = init;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await ponderFetch("http://localhost:42069/verifiers", {
      cache: "force-cache",
      // @ts-expect-error — Next.js fetch extension; must not survive
      next: { revalidate: 30 },
      headers: { Accept: "application/json" },
    });

    assert.equal(seenInit?.cache, "no-store");
    assert.equal(
      (seenInit as { next?: unknown } | undefined)?.next,
      undefined,
    );
    assert.equal(
      (seenInit?.headers as Record<string, string> | undefined)?.Accept,
      "application/json",
    );
  });
});
