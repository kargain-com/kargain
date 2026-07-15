/**
 * Shared Vincent Commons observations source — fixture fetchJson tests:
 * pagination stop conditions, maxPages cap, the three metadata failure
 * reasons, verifier map extraction, and concurrency-order determinism.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchVerifiedObservations } from "../lib/vincent-commons/observations-source.ts";

type Row = {
  id: string;
  status: string;
  tokenUri: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  verifier?: string;
};

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    status: "VERIFIED",
    tokenUri: `ar://tx-${id}`,
    vin: `VIN-${id}`,
    make: "RowMake",
    model: "RowModel",
    year: 2020,
    verifier: "0xAbC0000000000000000000000000000000000001",
    ...overrides,
  };
}

function metadata(id: string, overrides: Record<string, unknown> = {}) {
  return {
    version: "1.1",
    vin: `1HGBH41JXMN10918${id.slice(-1)}`,
    make: "MetaMake",
    model: "MetaModel",
    year: 2021,
    ...overrides,
  };
}

type FixtureOptions = {
  pages: Row[][];
  total: number;
  metadataByTokenId?: Record<string, unknown>;
  failFetchFor?: Set<string>;
  onFetch?: (url: string) => void | Promise<void>;
};

function fixtureFetchJson(options: FixtureOptions) {
  const requestedUrls: string[] = [];
  const fetchJson = async (url: string): Promise<unknown> => {
    requestedUrls.push(url);
    await options.onFetch?.(url);

    const pageMatch = url.match(/[?&]page=(\d+)/);
    if (pageMatch) {
      const page = Number(pageMatch[1]);
      return {
        passports: options.pages[page - 1] ?? [],
        total: options.total,
      };
    }

    const tokenId = url.match(/\/tx-([^/]+)$/)?.[1] ?? "";
    if (options.failFetchFor?.has(tokenId)) {
      throw new Error("network down");
    }
    return options.metadataByTokenId?.[tokenId] ?? metadata(tokenId);
  };
  return { fetchJson, requestedUrls };
}

describe("fetchVerifiedObservations — pagination", () => {
  it("stops when accumulated rows reach total", async () => {
    const { fetchJson, requestedUrls } = fixtureFetchJson({
      pages: [[row("1"), row("2")], [row("3")]],
      total: 3,
    });
    const result = await fetchVerifiedObservations({
      ponderUrl: "https://ponder.example",
      fetchJson,
      pageLimit: 2,
    });

    assert.equal(result.observations.length, 3);
    const pageUrls = requestedUrls.filter((u) => u.includes("/passports?"));
    assert.deepEqual(pageUrls, [
      "https://ponder.example/passports?status=VERIFIED&verifiedFirst=false&page=1&limit=2",
      "https://ponder.example/passports?status=VERIFIED&verifiedFirst=false&page=2&limit=2",
    ]);
  });

  it("stops on an empty page even when total overstates", async () => {
    const { fetchJson, requestedUrls } = fixtureFetchJson({
      pages: [[row("1")], []],
      total: 10,
    });
    const result = await fetchVerifiedObservations({
      ponderUrl: "https://ponder.example",
      fetchJson,
      pageLimit: 1,
    });

    assert.equal(result.observations.length, 1);
    assert.equal(requestedUrls.filter((u) => u.includes("/passports?")).length, 2);
  });

  it("caps at maxPages", async () => {
    const { fetchJson, requestedUrls } = fixtureFetchJson({
      pages: [[row("1")], [row("2")], [row("3")]],
      total: 3,
    });
    const result = await fetchVerifiedObservations({
      ponderUrl: "https://ponder.example",
      fetchJson,
      pageLimit: 1,
      maxPages: 2,
    });

    assert.equal(result.observations.length, 2);
    assert.equal(requestedUrls.filter((u) => u.includes("/passports?")).length, 2);
  });
});

describe("fetchVerifiedObservations — observations and failures", () => {
  it("prefers metadata fields and falls back to row fields", async () => {
    const { fetchJson } = fixtureFetchJson({
      pages: [[row("1")]],
      total: 1,
      metadataByTokenId: {
        "1": metadata("1", { make: "", model: "", year: null }),
      },
    });
    const result = await fetchVerifiedObservations({
      ponderUrl: "https://ponder.example",
      fetchJson,
    });

    assert.equal(result.observations.length, 1);
    const obs = result.observations[0];
    assert.equal(obs.make, "RowMake");
    assert.equal(obs.model, "RowModel");
    assert.equal(obs.year, 2020);
  });

  it("reports unsupported-token-uri for non-ar URIs", async () => {
    const { fetchJson } = fixtureFetchJson({
      pages: [[row("1", { tokenUri: "https://example.com/1.json" })]],
      total: 1,
    });
    const result = await fetchVerifiedObservations({
      ponderUrl: "https://ponder.example",
      fetchJson,
    });

    assert.equal(result.observations.length, 0);
    assert.deepEqual(result.metadataFailures, [
      { tokenId: "1", reason: "unsupported-token-uri" },
    ]);
  });

  it("reports metadata-fetch-failed when the gateway fetch throws", async () => {
    const { fetchJson } = fixtureFetchJson({
      pages: [[row("1")]],
      total: 1,
      failFetchFor: new Set(["1"]),
    });
    const result = await fetchVerifiedObservations({
      ponderUrl: "https://ponder.example",
      fetchJson,
    });

    assert.deepEqual(result.metadataFailures, [
      { tokenId: "1", reason: "metadata-fetch-failed" },
    ]);
  });

  it("reports metadata-parse-failed when the JSON is not passport metadata", async () => {
    const { fetchJson } = fixtureFetchJson({
      pages: [[row("1")]],
      total: 1,
      metadataByTokenId: { "1": ["not", "metadata"] },
    });
    const result = await fetchVerifiedObservations({
      ponderUrl: "https://ponder.example",
      fetchJson,
    });

    assert.deepEqual(result.metadataFailures, [
      { tokenId: "1", reason: "metadata-parse-failed" },
    ]);
  });

  it("maps verifiers lowercased and skips empty ones", async () => {
    const { fetchJson } = fixtureFetchJson({
      pages: [
        [
          row("1", { verifier: "0xABCDEF0000000000000000000000000000000001" }),
          row("2", { verifier: "  " }),
          row("3", { verifier: undefined }),
        ],
      ],
      total: 3,
    });
    const result = await fetchVerifiedObservations({
      ponderUrl: "https://ponder.example",
      fetchJson,
    });

    assert.deepEqual(result.verifierByTokenId, {
      "1": "0xabcdef0000000000000000000000000000000001",
    });
  });
});

describe("fetchVerifiedObservations — concurrency determinism", () => {
  it("returns identical index-ordered output at concurrency 1 and 8", async () => {
    const pages = [[row("1"), row("2"), row("3"), row("4"), row("5")]];

    const sequential = await fetchVerifiedObservations({
      ponderUrl: "https://ponder.example",
      fetchJson: fixtureFetchJson({ pages, total: 5 }).fetchJson,
      concurrency: 1,
    });

    // Delay earlier rows longer so completion order inverts request order.
    let delay = 25;
    const concurrent = await fetchVerifiedObservations({
      ponderUrl: "https://ponder.example",
      fetchJson: fixtureFetchJson({
        pages,
        total: 5,
        onFetch: async (url) => {
          if (!url.includes("/passports?")) {
            const wait = delay;
            delay = Math.max(0, delay - 5);
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
        },
      }).fetchJson,
      concurrency: 8,
    });

    assert.deepEqual(
      concurrent.observations.map((o) => o.tokenId),
      sequential.observations.map((o) => o.tokenId),
    );
    assert.equal(JSON.stringify(concurrent), JSON.stringify(sequential));
  });
});
