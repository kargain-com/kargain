import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VerifierDirectoryEntry } from "../lib/verifier/parse-directory-entry.ts";
import {
  filterVerifiers,
  formatVerifierDirectoryResultCount,
  verifierMatchesQuery,
} from "../lib/verifier/filter-verifiers.ts";

function entry(
  overrides: Partial<VerifierDirectoryEntry> = {},
): VerifierDirectoryEntry {
  return {
    chainId: 84532,
    address: "0xabcdef1234567890abcdef1234567890abcdef12",
    category: 0,
    name: "Alpha Mechanic",
    slug: "alpha-mechanic",
    metadataURI: "ar://test",
    active: true,
    verificationCount: 10,
    verificationFee: "1000000000000000000",
    joinedAt: 1_700_000_000,
    locationLabel: "",
    locationPlaceId: "",
    locationCountryCode: "",
    ...overrides,
  };
}

describe("verifierMatchesQuery", () => {
  it("matches empty query for any entry", () => {
    const verifier = entry();
    assert.equal(verifierMatchesQuery(verifier, ""), true);
    assert.equal(verifierMatchesQuery(verifier, "   "), true);
  });

  it("matches name and slug case-insensitively", () => {
    const verifier = entry({ name: "Beta Garage", slug: "beta-garage" });
    assert.equal(verifierMatchesQuery(verifier, "beta"), true);
    assert.equal(verifierMatchesQuery(verifier, "GARAGE"), true);
    assert.equal(verifierMatchesQuery(verifier, "gamma"), false);
  });

  it("matches address with 0x prefix, bare hex, and mixed case", () => {
    const verifier = entry({
      address: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
    });
    assert.equal(verifierMatchesQuery(verifier, "0xabcdef"), true);
    assert.equal(verifierMatchesQuery(verifier, "ABCDEF"), true);
    assert.equal(verifierMatchesQuery(verifier, "cdef1234"), true);
    assert.equal(verifierMatchesQuery(verifier, "zzzz"), false);
  });

  it("matches category label text", () => {
    const verifier = entry({ category: 0, name: "X", slug: "x" });
    assert.equal(verifierMatchesQuery(verifier, "mech"), true);
    assert.equal(verifierMatchesQuery(verifier, "MECHANIC"), true);
    assert.equal(verifierMatchesQuery(verifier, "broker"), false);
  });
});

describe("filterVerifiers", () => {
  it("excludes inactive entries when activeOnly is true", () => {
    const entries = [
      entry({ address: "0x1111111111111111111111111111111111111111", active: true }),
      entry({ address: "0x2222222222222222222222222222222222222222", active: false }),
    ];
    const result = filterVerifiers(entries, {
      query: "",
      categoryIndex: null,
      chainId: null,
      sortKey: "verifications",
      activeOnly: true,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.address, "0x1111111111111111111111111111111111111111");
  });

  it("filters by category index", () => {
    const entries = [
      entry({ address: "0x1111111111111111111111111111111111111111", category: 0 }),
      entry({ address: "0x2222222222222222222222222222222222222222", category: 2 }),
    ];
    const result = filterVerifiers(entries, {
      query: "",
      categoryIndex: 2,
      chainId: null,
      sortKey: "verifications",
      activeOnly: false,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.category, 2);
  });

  it("filters by chainId membership", () => {
    const entries = [
      entry({
        address: "0x1111111111111111111111111111111111111111",
        chainId: 84532,
      }),
      entry({
        address: "0x1111111111111111111111111111111111111111",
        chainId: 11155111,
      }),
      entry({
        address: "0x2222222222222222222222222222222222222222",
        chainId: 84532,
      }),
    ];
    const result = filterVerifiers(entries, {
      query: "",
      categoryIndex: null,
      chainId: 84532,
      sortKey: "verifications",
      activeOnly: false,
    });
    assert.equal(result.length, 2);
    assert.ok(result.every((v) => v.chainId === 84532));
  });

  it("tie-breaks same address dual membership by chainId", () => {
    const hub = entry({
      address: "0x1111111111111111111111111111111111111111",
      chainId: 84532,
      verificationCount: 5,
    });
    const spoke = entry({
      address: "0x1111111111111111111111111111111111111111",
      chainId: 11155111,
      verificationCount: 5,
    });
    const result = filterVerifiers([spoke, hub], {
      query: "",
      categoryIndex: null,
      chainId: null,
      sortKey: "verifications",
      activeOnly: false,
    });
    assert.deepEqual(
      result.map((v) => v.chainId),
      [84532, 11155111],
    );
  });

  it("sorts by lowest fee with zero fees last", () => {
    const low = entry({
      address: "0x1111111111111111111111111111111111111111",
      verificationFee: "1000000000000000000",
      verificationCount: 1,
    });
    const high = entry({
      address: "0x2222222222222222222222222222222222222222",
      verificationFee: "2000000000000000000",
      verificationCount: 1,
    });
    const zero = entry({
      address: "0x3333333333333333333333333333333333333333",
      verificationFee: "0",
      verificationCount: 99,
    });

    const result = filterVerifiers([zero, high, low], {
      query: "",
      categoryIndex: null,
      chainId: null,
      sortKey: "lowestFee",
      activeOnly: false,
    });

    assert.deepEqual(
      result.map((v) => v.address),
      [
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
        "0x3333333333333333333333333333333333333333",
      ],
    );
  });

  it("tie-breaks equal non-zero fees by verification count then address", () => {
    const fewer = entry({
      address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      verificationFee: "1000000000000000000",
      verificationCount: 5,
    });
    const more = entry({
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      verificationFee: "1000000000000000000",
      verificationCount: 20,
    });

    const result = filterVerifiers([fewer, more], {
      query: "",
      categoryIndex: null,
      chainId: null,
      sortKey: "lowestFee",
      activeOnly: false,
    });

    assert.equal(result[0]?.address, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("combines query, category, and sort", () => {
    const entries = [
      entry({
        address: "0x1111111111111111111111111111111111111111",
        name: "Mechanic One",
        category: 0,
        verificationFee: "2000000000000000000",
      }),
      entry({
        address: "0x2222222222222222222222222222222222222222",
        name: "Mechanic Two",
        category: 0,
        verificationFee: "1000000000000000000",
      }),
      entry({
        address: "0x3333333333333333333333333333333333333333",
        name: "Broker One",
        category: 3,
        verificationFee: "0",
      }),
    ];

    const result = filterVerifiers(entries, {
      query: "mechanic",
      categoryIndex: 0,
      chainId: null,
      sortKey: "lowestFee",
      activeOnly: false,
    });

    assert.equal(result.length, 2);
    assert.equal(result[0]?.verificationFee, "1000000000000000000");
    assert.equal(result[1]?.verificationFee, "2000000000000000000");
  });

  it("filters lightning-only when profile has valid lud16 and accepts lightning", () => {
    const lightning = entry({
      address: "0x1111111111111111111111111111111111111111",
    });
    const noLightning = entry({
      address: "0x2222222222222222222222222222222222222222",
    });
    const profiles = new Map([
      [
        "0x1111111111111111111111111111111111111111",
        { lud16: "pay@example.com", verifierPaymentMethods: ["eth", "lightning"] as const },
      ],
      [
        "0x2222222222222222222222222222222222222222",
        { lud16: "bad", verifierPaymentMethods: ["eth", "lightning"] as const },
      ],
    ]);

    const result = filterVerifiers([lightning, noLightning], {
      query: "",
      categoryIndex: null,
      chainId: null,
      sortKey: "verifications",
      activeOnly: false,
      lightningOnly: true,
      profiles,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.address, "0x1111111111111111111111111111111111111111");
  });

  it("excludes entries with unloaded profiles when lightningOnly is true", () => {
    const loaded = entry({
      address: "0x1111111111111111111111111111111111111111",
    });
    const unloaded = entry({
      address: "0x2222222222222222222222222222222222222222",
    });
    const profiles = new Map([
      [
        "0x1111111111111111111111111111111111111111",
        { lud16: "pay@example.com" },
      ],
    ]);

    const result = filterVerifiers([loaded, unloaded], {
      query: "",
      categoryIndex: null,
      chainId: null,
      sortKey: "verifications",
      activeOnly: false,
      lightningOnly: true,
      profiles,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.address, "0x1111111111111111111111111111111111111111");
  });

  it("does not filter by lightning when lightningOnly is false", () => {
    const entries = [
      entry({ address: "0x1111111111111111111111111111111111111111" }),
      entry({ address: "0x2222222222222222222222222222222222222222" }),
    ];

    const result = filterVerifiers(entries, {
      query: "",
      categoryIndex: null,
      chainId: null,
      sortKey: "verifications",
      activeOnly: false,
      lightningOnly: false,
      profiles: new Map(),
    });

    assert.equal(result.length, 2);
  });

  it("ranks same placeId before same country before others", () => {
    const sameCity = entry({
      address: "0x1111111111111111111111111111111111111111",
      verificationCount: 1,
      locationPlaceId: "osm:R123",
      locationCountryCode: "DE",
      locationLabel: "Berlin, Germany",
    });
    const sameCountry = entry({
      address: "0x2222222222222222222222222222222222222222",
      verificationCount: 99,
      locationPlaceId: "osm:R999",
      locationCountryCode: "DE",
      locationLabel: "Munich, Germany",
    });
    const other = entry({
      address: "0x3333333333333333333333333333333333333333",
      verificationCount: 50,
      locationPlaceId: "osm:R1",
      locationCountryCode: "FR",
      locationLabel: "Paris, France",
    });
    const emptyPlace = entry({
      address: "0x4444444444444444444444444444444444444444",
      verificationCount: 80,
    });

    const result = filterVerifiers([other, emptyPlace, sameCountry, sameCity], {
      query: "",
      categoryIndex: null,
      chainId: null,
      sortKey: "verifications",
      activeOnly: false,
      preferredPlaceId: "osm:R123",
      preferredCountryCode: "DE",
    });

    assert.deepEqual(
      result.map((v) => v.address),
      [
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
        "0x4444444444444444444444444444444444444444",
        "0x3333333333333333333333333333333333333333",
      ],
    );
  });

  it("preserves secondary sort within the same place tier", () => {
    const fewer = entry({
      address: "0x1111111111111111111111111111111111111111",
      verificationCount: 5,
      locationPlaceId: "osm:R123",
      locationCountryCode: "DE",
    });
    const more = entry({
      address: "0x2222222222222222222222222222222222222222",
      verificationCount: 20,
      locationPlaceId: "osm:R123",
      locationCountryCode: "DE",
    });

    const result = filterVerifiers([fewer, more], {
      query: "",
      categoryIndex: null,
      chainId: null,
      sortKey: "verifications",
      activeOnly: false,
      preferredPlaceId: "osm:R123",
      preferredCountryCode: "DE",
    });

    assert.equal(result[0]?.address, "0x2222222222222222222222222222222222222222");
  });

  it("ignores place tiers when preferred placeId is blank", () => {
    const low = entry({
      address: "0x1111111111111111111111111111111111111111",
      verificationCount: 1,
      locationPlaceId: "osm:R123",
      locationCountryCode: "DE",
    });
    const high = entry({
      address: "0x2222222222222222222222222222222222222222",
      verificationCount: 50,
      locationCountryCode: "FR",
    });

    const result = filterVerifiers([low, high], {
      query: "",
      categoryIndex: null,
      chainId: null,
      sortKey: "verifications",
      activeOnly: false,
      preferredPlaceId: "",
      preferredCountryCode: "DE",
    });

    assert.equal(result[0]?.address, "0x2222222222222222222222222222222222222222");
  });

  it("empty indexed placeId never wins the same-city tier", () => {
    const incomplete = entry({
      address: "0x1111111111111111111111111111111111111111",
      verificationCount: 99,
      locationPlaceId: "",
      locationCountryCode: "DE",
    });
    const match = entry({
      address: "0x2222222222222222222222222222222222222222",
      verificationCount: 1,
      locationPlaceId: "osm:R123",
      locationCountryCode: "DE",
    });

    const result = filterVerifiers([incomplete, match], {
      query: "",
      categoryIndex: null,
      chainId: null,
      sortKey: "verifications",
      activeOnly: false,
      preferredPlaceId: "osm:R123",
      preferredCountryCode: "DE",
    });

    assert.equal(result[0]?.address, "0x2222222222222222222222222222222222222222");
    assert.equal(result[1]?.address, "0x1111111111111111111111111111111111111111");
  });
});

describe("formatVerifierDirectoryResultCount", () => {
  it("formats singular and plural totals without filters", () => {
    assert.equal(formatVerifierDirectoryResultCount(1, 1, false), "1 verifier");
    assert.equal(formatVerifierDirectoryResultCount(12, 12, false), "12 verifiers");
  });

  it("appends match count when filters are active", () => {
    assert.equal(
      formatVerifierDirectoryResultCount(12, 8, true),
      "12 verifiers · 8 match",
    );
    assert.equal(
      formatVerifierDirectoryResultCount(1, 0, true),
      "1 verifier · 0 match",
    );
  });
});
