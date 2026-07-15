/**
 * F-1 Vincent Commons derivation tests.
 *
 * Golden claimHashes were computed with @kargain/vincent@0.8.0
 * (`claimHash` = SHA-256 over the RFC 8785 JCS form of the fact core);
 * they pin the wire format against accidental drift.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalize, claimHash, parseClaim } from "@kargain/vincent/protocol";

import { sortClaimsForJsonl } from "../lib/vincent-commons/claim-sort.ts";
import {
  communitySchemaName,
  deriveClaims,
  vdsFromVin,
  VPIC_CANONICAL_CODES,
  type VincentObservation,
} from "../lib/vincent-commons/derive-claims.ts";

// NA VIN with a valid check digit (position 9 = X) — masked VDS.
const NA_VIN = "1HGBH41JXMN109186";
// EU VIN whose position 9 does not pass the NA check-digit formula — literal VDS.
const EU_VIN = "WVWZZZ1JZXW000012";

const NA_OBSERVATION: VincentObservation = {
  tokenId: "t1",
  vin: NA_VIN,
  year: 1991,
  make: "Honda",
  model: "Civic",
  modelVariant: "EX",
  bodyType: "Sedan",
  fuelType: "Petrol",
  transmission: "Manual",
  engine: "D15B2",
};

const EU_OBSERVATION: VincentObservation = {
  tokenId: "t2",
  vin: EU_VIN,
  year: 1999,
  make: "Volkswagen",
  model: "Golf",
  fuelType: "Diesel",
};

const GOLDEN_NA_SCHEMA_HASH =
  "sha256:7091805bb4ac759c60d514085fffee450d2f29e221780901c45383ba8d0a3869";
const GOLDEN_NA_BINDING_HASH =
  "sha256:0cbe153749114a9cd6464ffb1ec98c3cf1de019aa95988a867615b469bbb81ed";
const GOLDEN_NA_FUEL_PATTERN_HASH =
  "sha256:efb17b3a0f08cd7501b3fa714bc841a2eb3f5c3f23fcb7aa0ee3e16a476ec132";
const GOLDEN_EU_SCHEMA_HASH =
  "sha256:0fdb22e0c6ecce41919817d34553d2e9d20020564b460bd3f92a9dde6620b098";

function toJsonl(claims: Awaited<ReturnType<typeof deriveClaims>>["claims"]): string {
  return claims.map((claim) => canonicalize(claim)).join("\n");
}

describe("vdsFromVin", () => {
  it("takes VIN positions 4–9 literally when the check digit does not validate", () => {
    assert.equal(vdsFromVin(EU_VIN, false), "ZZZ1JZ");
  });

  it("masks position 9 with * when the check digit validates", () => {
    assert.equal(vdsFromVin(NA_VIN, true), "BH41J*");
  });
});

describe("deriveClaims — golden fixtures", () => {
  it("derives schema + binding + patterns with pinned claimHashes", async () => {
    const { claims, report } = await deriveClaims([NA_OBSERVATION, EU_OBSERVATION]);

    assert.equal(report.counts.vdsSchema, 2);
    assert.equal(report.counts.vdsBinding, 2);
    assert.equal(report.counts.vdsPattern, 8);
    assert.equal(report.counts.total, claims.length);
    assert.deepEqual(report.skipped, []);
    assert.deepEqual(report.conflicts, []);
    assert.deepEqual(report.vocabularySkips, []);
    assert.deepEqual(report.unknownWmiCandidates, []);

    const hashes = claims.map((claim) => claimHash(claim));
    assert.ok(hashes.includes(GOLDEN_NA_SCHEMA_HASH), "NA schema hash");
    assert.ok(hashes.includes(GOLDEN_NA_BINDING_HASH), "NA binding hash");
    assert.ok(hashes.includes(GOLDEN_NA_FUEL_PATTERN_HASH), "NA fuel pattern hash");
    assert.ok(hashes.includes(GOLDEN_EU_SCHEMA_HASH), "EU schema hash");

    // Every claim is protocol-valid.
    for (const claim of claims) {
      const parsed = parseClaim(claim);
      assert.ok(parsed.ok, `claim must parse: ${canonicalize(claim)}`);
    }

    const schema = claims.find((c) => c.type === "vds-schema" && c.key.name.includes("1HG"));
    assert.ok(schema && schema.type === "vds-schema");
    assert.equal(schema.key.name, communitySchemaName("1HG", 1991));
    assert.equal(schema.schemaVersion, "1.1");
    assert.equal(schema.provenance, "community/observation");
    assert.equal(schema.license, "CC0-1.0");
    assert.ok(!("evidence" in schema));
    assert.ok(!("supersedes" in schema));

    const binding = claims.find((c) => c.type === "vds-binding" && c.key.wmi === "1HG");
    assert.ok(binding && binding.type === "vds-binding");
    assert.equal(binding.key.yearFrom, 1991);
    assert.equal(binding.key.yearTo, 1991);
    assert.equal(binding.key.schema, GOLDEN_NA_SCHEMA_HASH);

    const naPatterns = claims.filter(
      (c) => c.type === "vds-pattern" && c.key.schema === GOLDEN_NA_SCHEMA_HASH,
    );
    assert.equal(naPatterns.length, 6);
    for (const pattern of naPatterns) {
      assert.ok(pattern.type === "vds-pattern");
      assert.equal(pattern.key.match.vds, "BH41J*");
      assert.ok(!("vis" in pattern.key.match));
    }

    const euPattern = claims.find(
      (c) =>
        c.type === "vds-pattern" &&
        c.key.schema === GOLDEN_EU_SCHEMA_HASH &&
        c.value.attribute === "fuelType",
    );
    assert.ok(euPattern && euPattern.type === "vds-pattern");
    assert.equal(euPattern.key.match.vds, "ZZZ1JZ");
    assert.equal(euPattern.value.code, "Diesel");
  });

  it("is idempotent and order-insensitive (byte-identical JSONL)", async () => {
    const a = await deriveClaims([NA_OBSERVATION, EU_OBSERVATION]);
    const b = await deriveClaims([NA_OBSERVATION, EU_OBSERVATION]);
    const c = await deriveClaims([EU_OBSERVATION, NA_OBSERVATION]);

    assert.equal(toJsonl(a.claims), toJsonl(b.claims));
    assert.equal(toJsonl(a.claims), toJsonl(c.claims));
    assert.deepEqual(a.report, b.report);
  });

  it("dedupes identical observations by claimHash", async () => {
    const single = await deriveClaims([NA_OBSERVATION]);
    const doubled = await deriveClaims([
      NA_OBSERVATION,
      { ...NA_OBSERVATION, tokenId: "t9" },
    ]);
    assert.equal(toJsonl(single.claims), toJsonl(doubled.claims));
  });
});

describe("deriveClaims — privacy guard", () => {
  it("no claim JSON contains VIN positions 10–17 of any source VIN", async () => {
    const { claims } = await deriveClaims([NA_OBSERVATION, EU_OBSERVATION]);
    const jsonl = toJsonl(claims);
    for (const vin of [NA_VIN, EU_VIN]) {
      const serialTail = vin.slice(9);
      assert.equal(serialTail.length, 8);
      assert.ok(
        !jsonl.includes(serialTail),
        `claims must not contain VIN positions 10–17 (${vin})`,
      );
      assert.ok(!jsonl.includes(vin), "claims must not contain a full VIN");
    }
  });
});

describe("deriveClaims — conflicts", () => {
  it("excludes both sides of a same-key different-value conflict and reports it", async () => {
    const other: VincentObservation = {
      ...NA_OBSERVATION,
      tokenId: "t3",
      fuelType: "Diesel",
    };
    const { claims, report } = await deriveClaims([NA_OBSERVATION, other]);

    assert.equal(report.conflicts.length, 1);
    const conflict = report.conflicts[0];
    assert.ok(conflict);
    assert.equal(conflict.wmi, "1HG");
    assert.equal(conflict.year, 1991);
    assert.equal(conflict.vds, "BH41J*");
    assert.equal(conflict.attribute, "fuelType");
    assert.deepEqual(conflict.values, ["Diesel", "Gasoline"]);
    assert.deepEqual(conflict.tokenIds, ["t1", "t3"]);

    const fuelPatterns = claims.filter(
      (c) => c.type === "vds-pattern" && c.value.attribute === "fuelType",
    );
    assert.equal(fuelPatterns.length, 0, "conflicting patterns are excluded");

    // Non-conflicting attributes from the same group still ship.
    const modelPattern = claims.find(
      (c) => c.type === "vds-pattern" && c.value.attribute === "model",
    );
    assert.ok(modelPattern);
  });

  it("emits no empty schema/binding when every pattern in a group conflicts", async () => {
    const a: VincentObservation = { tokenId: "a", vin: NA_VIN, year: 1991, model: "Civic" };
    const b: VincentObservation = { tokenId: "b", vin: NA_VIN, year: 1991, model: "Accord" };
    const { claims, report } = await deriveClaims([a, b]);
    assert.equal(claims.length, 0);
    assert.equal(report.conflicts.length, 1);
  });
});

describe("deriveClaims — vocabulary mapping", () => {
  it("reverse-maps enumerated values to the vPIC canon vin-decode recognizes", async () => {
    const obs: VincentObservation = {
      tokenId: "t4",
      vin: NA_VIN,
      year: 1991,
      bodyType: "Truck",
      fuelType: "Petrol",
      transmission: "Automatic",
    };
    const { claims } = await deriveClaims([obs]);
    const codes = new Map(
      claims
        .filter((c) => c.type === "vds-pattern")
        .map((c) => (c.type === "vds-pattern" ? [c.value.attribute, c.value.code] : ["", ""])),
    );
    assert.equal(codes.get("bodyType"), "Pickup");
    assert.equal(codes.get("fuelType"), "Gasoline");
    assert.equal(codes.get("transmission"), "Automatic");
    assert.equal(VPIC_CANONICAL_CODES.bodyType.SUV, "SUV/MPV");
    assert.equal(VPIC_CANONICAL_CODES.bodyType.Sedan, "Sedan/Saloon");
  });

  it("skips unmapped enumerated values and reports them", async () => {
    const obs: VincentObservation = {
      tokenId: "t5",
      vin: NA_VIN,
      year: 1991,
      model: "Civic",
      fuelType: "Other",
      bodyType: "Rocket",
    };
    const { claims, report } = await deriveClaims([obs]);

    assert.deepEqual(report.vocabularySkips, [
      { tokenId: "t5", attribute: "bodyType", value: "Rocket" },
      { tokenId: "t5", attribute: "fuelType", value: "Other" },
    ]);
    const attributes = claims
      .filter((c) => c.type === "vds-pattern")
      .map((c) => (c.type === "vds-pattern" ? c.value.attribute : ""));
    assert.deepEqual(attributes, ["model"]);
  });
});

describe("deriveClaims — unknown WMI routing", () => {
  it("lists unknown WMIs as document-required candidates, still emitting VDS claims", async () => {
    const { claims, report } = await deriveClaims(
      [{ ...NA_OBSERVATION, make: "Mystery Motors" }],
      { lookupWmi: async () => null },
    );

    assert.deepEqual(report.unknownWmiCandidates, [
      { wmi: "1HG", makes: ["Mystery Motors"], tokenIds: ["t1"] },
    ]);
    // No wmi claims are ever emitted; VDS claims still are.
    assert.ok(claims.every((c) => c.type !== "wmi"));
    assert.ok(claims.some((c) => c.type === "vds-binding"));
  });

  it("reports nothing for WMIs present in the bundled table", async () => {
    const { report } = await deriveClaims([NA_OBSERVATION], {
      lookupWmi: async () => ({
        wmi: "1HG",
        manufacturer: "Honda",
        country: "US",
        vehicleType: "Passenger Car",
      }),
    });
    assert.deepEqual(report.unknownWmiCandidates, []);
  });
});

describe("deriveClaims — input gate", () => {
  it("skips legacy, invalid, and year-less observations with reasons", async () => {
    const { claims, report } = await deriveClaims([
      { tokenId: "legacy", vin: "AB123456789", year: 1975, model: "Old" },
      { tokenId: "bad", vin: "NOT A VIN", year: 2020, model: "X" },
      { tokenId: "noyear", vin: NA_VIN, year: 0, model: "Civic" },
    ]);

    assert.equal(claims.length, 0);
    assert.deepEqual(report.skipped, [
      { tokenId: "bad", reason: "invalid-vin" },
      { tokenId: "legacy", reason: "legacy-vin" },
      { tokenId: "noyear", reason: "missing-year" },
    ]);
  });
});

describe("sortClaimsForJsonl", () => {
  it("orders by (type, key fields, claimHash) per PROTOCOL §7.2", async () => {
    const { claims } = await deriveClaims([NA_OBSERVATION, EU_OBSERVATION]);
    const shuffled = [...claims].reverse();
    const sorted = sortClaimsForJsonl(shuffled);
    assert.deepEqual(
      sorted.map((c) => canonicalize(c)),
      claims.map((c) => canonicalize(c)),
    );
    const types = sorted.map((c) => c.type);
    assert.deepEqual([...types].sort(), types, "type-major ordering");
  });
});
