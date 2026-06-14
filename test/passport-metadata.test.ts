import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMetadataWire } from "../lib/passport/build-metadata-json.ts";
import { METADATA_VERSION } from "../lib/passport/metadata-constants.ts";
import {
  assertNoPiiKeys,
  normalizeVin,
  passportMetadataSchema,
} from "../lib/passport/metadata-schema.ts";
import {
  diffPassportMetadata,
  hasAnchorChanges,
} from "../lib/passport/metadata-diff.ts";
import { parseMetadataJson } from "../lib/passport/parse-metadata-json.ts";
import type { PassportMetadata } from "../lib/passport/metadata-schema.ts";

const baseForm = {
  vin: "1HGBH41JXMN109186",
  make: "Honda",
  model: "Civic",
  year: "2021",
  mileage: "45000",
  description: "Well maintained",
  type: "",
  vehicleType: "",
  modelVariant: "",
  fuelType: "Petrol",
  bodyType: "Sedan",
  transmission: "Manual",
  power: "",
  evBatteryKwh: "",
  colour: "Blue",
  locationLabel: "London",
  locationLat: "",
  locationLng: "",
  engine: "",
  features: "Sunroof",
  condition: "Good",
};

describe("parseMetadataJson", () => {
  it("parses legacy v1.0 with mileage_km", () => {
    const parsed = parseMetadataJson({
      version: "1.0",
      name: "2021 Honda Civic",
      vin: "1hgbh41jxmn109186",
      make: "Honda",
      model: "Civic",
      year: 2021,
      mileage_km: 45000,
      fuel_type: "Petrol",
      body_type: "Sedan",
      transmission: "Manual",
      color: "Blue",
      photos: ["ar://photo-1"],
      created_at: "2024-01-01T00:00:00.000Z",
    });

    assert.ok(parsed);
    assert.equal(parsed.version, "1.0");
    assert.equal(parsed.mileageKm, 45000);
    assert.equal(parsed.vin, "1HGBH41JXMN109186");
    assert.equal(parsed.fuelType, "Petrol");
    assert.equal(parsed.bodyType, "Sedan");
    assert.equal(parsed.colour, "Blue");
    assert.equal(parsed.createdAt, "2024-01-01T00:00:00.000Z");
  });

  it("parses v1.1 with optional fields", () => {
    const parsed = parseMetadataJson({
      version: "1.1",
      name: "2022 Tesla Model 3",
      vin: "5YJ3E1EA1KF123456",
      make: "Tesla",
      model: "Model 3",
      year: 2022,
      mileageKm: 12000,
      type: "EV",
      modelVariant: "Long Range",
      colour: "White",
      power: "283 kW",
      evBatteryKwh: 75,
      location: { label: "Berlin", lat: 52.52, lng: 13.405 },
      photos: ["ar://a", "ar://b"],
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-06-01T00:00:00.000Z",
    });

    assert.ok(parsed);
    assert.equal(parsed.version, "1.1");
    assert.equal(parsed.type, "EV");
    assert.equal(parsed.modelVariant, "Long Range");
    assert.equal(parsed.power, "283 kW");
    assert.equal(parsed.location?.label, "Berlin");
    assert.deepEqual(parsed.photos, ["ar://a", "ar://b"]);
  });
});

describe("normalizeVin", () => {
  it("strips invalid characters and uppercases", () => {
    assert.equal(normalizeVin(" 1h-gbh41!jxmn109186 "), "1HGBH41JXMN109186");
    assert.equal(normalizeVin("abc-123"), "ABC123");
  });
});

describe("buildMetadataWire", () => {
  it("emits v1.1 camelCase wire JSON with timestamps", () => {
    const wire = buildMetadataWire(baseForm, ["ar://photo-1"], {
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    assert.equal(wire.version, METADATA_VERSION);
    assert.equal(wire.mileageKm, 45000);
    assert.equal(wire.vin, "1HGBH41JXMN109186");
    assert.equal(wire.createdAt, "2025-01-01T00:00:00.000Z");
    assert.equal(wire.updatedAt, "2025-01-01T00:00:00.000Z");
    assert.equal(wire.name, "2021 Honda Civic");
    assert.equal(wire.description, "Well maintained");
    assert.equal(wire.fuelType, "Petrol");
    assert.equal(wire.bodyType, "Sedan");
    assert.equal(wire.transmission, "Manual");
    assert.equal(wire.colour, "Blue");
    assert.deepEqual(wire.location, { label: "London" });
    assert.deepEqual(wire.features, ["Sunroof"]);
    assert.equal(wire.condition, "Good");
    assert.equal("mileage_km" in wire, false);
  });
});

describe("PII rejection", () => {
  it("rejects PII keys on wire objects", () => {
    assert.throws(
      () => assertNoPiiKeys({ vin: "X", ownerName: "Alice" }),
      /PII field not allowed/,
    );
  });

  it("accepts normalized metadata via Zod", () => {
    const metadata: PassportMetadata = {
      version: "1.1",
      vin: "1HGBH41JXMN109186",
      make: "Honda",
      model: "Civic",
      year: 2021,
      mileageKm: 45000,
      photos: ["ar://photo-1"],
    };
    assert.doesNotThrow(() => passportMetadataSchema.parse(metadata));
  });
});

describe("diffPassportMetadata", () => {
  const before: PassportMetadata = {
    version: "1.1",
    vin: "1HGBH41JXMN109186",
    make: "Honda",
    model: "Civic",
    year: 2021,
    mileageKm: 10000,
    photos: ["ar://a"],
    description: "Original",
  };

  it("classifies VIN change as anchor and description as cosmetic", () => {
    const after: PassportMetadata = {
      ...before,
      vin: "5YJ3E1EA1KF123456",
      description: "Updated",
    };
    const diff = diffPassportMetadata(before, after);

    assert.ok(diff.anchor.some((c) => c.field === "vin"));
    assert.ok(diff.cosmetic.some((c) => c.field === "description"));
    assert.equal(hasAnchorChanges(diff), true);
  });

  it("treats mileage delta under 500 km as cosmetic", () => {
    const after: PassportMetadata = { ...before, mileageKm: 10400 };
    const diff = diffPassportMetadata(before, after);

    assert.ok(diff.cosmetic.some((c) => c.field === "mileageKm"));
    assert.equal(diff.anchor.some((c) => c.field === "mileageKm"), false);
    assert.equal(hasAnchorChanges(diff), false);
  });

  it("treats mileage delta over 500 km as anchor", () => {
    const after: PassportMetadata = { ...before, mileageKm: 10600 };
    const diff = diffPassportMetadata(before, after);

    assert.ok(diff.anchor.some((c) => c.field === "mileageKm"));
    assert.equal(hasAnchorChanges(diff), true);
  });
});
