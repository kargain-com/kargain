import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VerifierDirectoryEntry } from "../app/actions/verifier-directory.ts";
import {
  filterVerifiers,
  formatVerifierDirectoryResultCount,
  verifierMatchesQuery,
} from "../lib/verifier/filter-verifiers.ts";

function entry(
  overrides: Partial<VerifierDirectoryEntry> = {},
): VerifierDirectoryEntry {
  return {
    address: "0xabcdef1234567890abcdef1234567890abcdef12",
    category: 0,
    name: "Alpha Mechanic",
    slug: "alpha-mechanic",
    metadataURI: "ar://test",
    active: true,
    verificationCount: 10,
    verificationFee: "1000000000000000000",
    joinedAt: 1_700_000_000,
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
      sortKey: "verifications",
      activeOnly: false,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.category, 2);
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
      sortKey: "lowestFee",
      activeOnly: false,
    });

    assert.equal(result.length, 2);
    assert.equal(result[0]?.verificationFee, "1000000000000000000");
    assert.equal(result[1]?.verificationFee, "2000000000000000000");
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
