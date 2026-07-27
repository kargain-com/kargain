import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProfilePassportTitle,
  buildVehicleLabel,
} from "../lib/passport/vehicle-label.ts";

describe("buildVehicleLabel", () => {
  it("joins year make model", () => {
    assert.equal(buildVehicleLabel(2020, "Honda", "Civic"), "2020 Honda Civic");
  });

  it("allows partials", () => {
    assert.equal(buildVehicleLabel(2019, "Toyota", ""), "2019 Toyota");
    assert.equal(buildVehicleLabel(0, "BMW", "M3"), "BMW M3");
    assert.equal(buildVehicleLabel(null, "", "Golf"), "Golf");
    assert.equal(buildVehicleLabel(2021, null, null), "2021");
  });

  it("returns empty when nothing present", () => {
    assert.equal(buildVehicleLabel(0, "", ""), "");
    assert.equal(buildVehicleLabel(undefined, "  ", "  "), "");
  });
});

describe("buildProfilePassportTitle", () => {
  const tokenId = "1";
  const chainId = 84532;

  it("prefers vehicle label", () => {
    assert.equal(
      buildProfilePassportTitle({
        year: 2020,
        make: "Honda",
        model: "Civic",
        tokenId,
        chainId,
      }),
      "2020 Honda Civic",
    );
  });

  it("falls back to Vehicle short label", () => {
    const title = buildProfilePassportTitle({
      year: 0,
      make: "",
      model: "",
      tokenId,
      chainId,
    });
    assert.match(title, /^Vehicle #/);
    assert.match(title, /Base Sepolia|84532/);
  });
});
