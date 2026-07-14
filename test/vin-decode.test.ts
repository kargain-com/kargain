import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import {
  clearVinDecodeCacheForTests,
  decodeVinFields,
  mapVpicBodyType,
  mapVpicFuelType,
  mapVpicTransmission,
} from "../lib/passport/vin-decode.ts";

describe("mapVpicFuelType", () => {
  it("maps plain Gasoline to Petrol", () => {
    assert.equal(mapVpicFuelType("Gasoline"), "Petrol");
    assert.equal(mapVpicFuelType("Gasoline, Premium Unleaded"), "Petrol");
  });

  it("returns null for E85 / Flexible (no Petrol, no Other)", () => {
    assert.equal(mapVpicFuelType("Flexible Fuel Vehicle (FFV)"), null);
    assert.equal(mapVpicFuelType("Gasoline E85"), null);
    assert.equal(mapVpicFuelType("Flex Fuel"), null);
  });

  it("maps Hybrid / HEV / PHEV wording before Electric", () => {
    assert.equal(mapVpicFuelType("Gasoline/Electric Hybrid"), "Hybrid");
    assert.equal(mapVpicFuelType("Plug-in Hybrid"), "Hybrid");
    assert.equal(mapVpicFuelType("HEV"), "Hybrid");
    assert.equal(mapVpicFuelType("PHEV"), "Hybrid");
  });

  it("maps Diesel and Electric", () => {
    assert.equal(mapVpicFuelType("Diesel"), "Diesel");
    assert.equal(mapVpicFuelType("Electric"), "Electric");
  });

  it("returns null for unknown fuel strings", () => {
    assert.equal(mapVpicFuelType("Hydrogen"), null);
    assert.equal(mapVpicFuelType("Compressed Natural Gas (CNG)"), null);
    assert.equal(mapVpicFuelType(""), null);
  });
});

describe("mapVpicBodyType", () => {
  it("maps Sedan/Saloon and Sedan", () => {
    assert.equal(mapVpicBodyType("Sedan/Saloon"), "Sedan");
    assert.equal(mapVpicBodyType("Sedan"), "Sedan");
  });

  it("maps SUV / MPV, Hatchback / Liftback, Coupe", () => {
    assert.equal(mapVpicBodyType("Sport Utility Vehicle (SUV)"), "SUV");
    assert.equal(mapVpicBodyType("MPV"), "SUV");
    assert.equal(mapVpicBodyType("Hatchback"), "Hatchback");
    assert.equal(mapVpicBodyType("Liftback"), "Hatchback");
    assert.equal(mapVpicBodyType("Coupe"), "Coupe");
  });

  it("maps Van / Minivan and Pickup → Truck", () => {
    assert.equal(mapVpicBodyType("Cargo Van"), "Van");
    assert.equal(mapVpicBodyType("Minivan"), "Van");
    assert.equal(mapVpicBodyType("Pickup"), "Truck");
    assert.equal(mapVpicBodyType("Standard Pickup Truck"), "Truck");
  });

  it("returns null for unmapped body types", () => {
    assert.equal(mapVpicBodyType("Convertible/Cabriolet"), null);
    assert.equal(mapVpicBodyType("Wagon"), null);
    assert.equal(mapVpicBodyType(""), null);
  });
});

describe("mapVpicTransmission", () => {
  it("maps Manual / Automatic / CVT", () => {
    assert.equal(mapVpicTransmission("Manual"), "Manual");
    assert.equal(mapVpicTransmission("6-Speed Manual"), "Manual");
    assert.equal(mapVpicTransmission("Automatic"), "Automatic");
    assert.equal(mapVpicTransmission("Continuously Variable Transmission (CVT)"), "Automatic");
  });

  it("returns null for unmapped transmission", () => {
    assert.equal(mapVpicTransmission("Direct Drive"), null);
    assert.equal(mapVpicTransmission(""), null);
  });
});

describe("decodeVinFields", () => {
  beforeEach(() => {
    clearVinDecodeCacheForTests();
  });

  it("returns only unambiguous mapped fields", async () => {
    const fields = await decodeVinFields("1HGBH41JXMN109186", 1991, {
      decode: async () => ({
        attributes: [
          { attribute: "model", value: "Civic", ambiguous: false },
          { attribute: "series", value: "EX", ambiguous: false },
          { attribute: "engine", value: "1.5L I4", ambiguous: false },
          { attribute: "fuelType", value: "Gasoline", ambiguous: false },
          { attribute: "bodyType", value: "Sedan/Saloon", ambiguous: false },
          { attribute: "transmission", value: "Automatic", ambiguous: false },
          { attribute: "plant", value: "Ohio", ambiguous: false },
        ],
      }),
    });

    assert.deepEqual(fields, {
      model: "Civic",
      modelVariant: "EX",
      engine: "1.5L I4",
      fuelType: "Petrol",
      bodyType: "Sedan",
      transmission: "Automatic",
    });
  });

  it("skips ambiguous and null-value attributes", async () => {
    const fields = await decodeVinFields("1HGBH41JXMN109186", null, {
      decode: async () => ({
        attributes: [
          { attribute: "model", value: "Civic", ambiguous: true },
          { attribute: "series", value: null, ambiguous: false },
          { attribute: "fuelType", value: "Gasoline", ambiguous: false },
          { attribute: "bodyType", value: "Convertible", ambiguous: false },
        ],
      }),
    });

    assert.deepEqual(fields, {
      fuelType: "Petrol",
    });
  });

  it("returns null when decode throws", async () => {
    const fields = await decodeVinFields("1HGBH41JXMN109186", null, {
      decode: async () => {
        throw new Error("LeafNotFoundError");
      },
    });
    assert.equal(fields, null);
  });

  it("caches per VIN and does not re-call decode", async () => {
    let calls = 0;
    const deps = {
      decode: async () => {
        calls += 1;
        return {
          attributes: [
            { attribute: "model", value: "Civic", ambiguous: false },
          ],
        };
      },
    };

    const first = await decodeVinFields("1HGBH41JXMN109186", 1991, deps);
    const second = await decodeVinFields("1HGBH41JXMN109186", 1991, deps);
    assert.equal(calls, 1);
    assert.equal(first, second);
    assert.deepEqual(first, { model: "Civic" });
  });
});
