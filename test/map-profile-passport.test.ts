import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isProfilePassportBridgedAway,
  mapProfileListing,
  mapProfilePassport,
} from "../lib/passport/map-profile-passport.ts";

describe("mapProfilePassport", () => {
  it("parses origin, custody, and denorm display fields", () => {
    const row = mapProfilePassport({
      id: "42",
      status: "VERIFIED",
      vin: "1HGBH41JXMN109186",
      make: "Honda",
      model: "Civic",
      year: 2020,
      coverPhotoUri: "ar://covertxid",
      chainId: 84532,
      custodyChain: 11155111,
    });
    assert.ok(row);
    assert.equal(row.tokenId, "42");
    assert.equal(row.chainId, 84532);
    assert.equal(row.custodyChain, 11155111);
    assert.equal(row.status, "VERIFIED");
    assert.equal(row.vin, "1HGBH41JXMN109186");
    assert.equal(row.make, "Honda");
    assert.equal(row.model, "Civic");
    assert.equal(row.year, 2020);
    assert.ok(row.imageUrl);
    assert.match(row.imageUrl, /covertxid/);
  });

  it("nulls empty cover and trims empty vin", () => {
    const row = mapProfilePassport({
      id: "1",
      status: "UNVERIFIED",
      vin: "  ",
      make: "",
      model: "",
      year: 0,
      coverPhotoUri: "",
      chainId: 84532,
      custodyChain: 84532,
    });
    assert.ok(row);
    assert.equal(row.vin, null);
    assert.equal(row.imageUrl, null);
    assert.equal(row.year, 0);
  });

  it("preserves home custody when equal to origin", () => {
    const row = mapProfilePassport({
      id: "1",
      status: "UNVERIFIED",
      chainId: 84532,
      custodyChain: 84532,
    });
    assert.ok(row);
    assert.equal(row.chainId, row.custodyChain);
    assert.equal(isProfilePassportBridgedAway(row.chainId, row.custodyChain), false);
  });

  it("marks bridged-away when custody differs from origin", () => {
    assert.equal(isProfilePassportBridgedAway(84532, 11155111), true);
  });

  it("fail-closes without custodyChain", () => {
    assert.equal(
      mapProfilePassport({
        id: "1",
        status: "VERIFIED",
        chainId: 84532,
      }),
      null,
    );
  });

  it("fail-closes without chainId", () => {
    assert.equal(
      mapProfilePassport({
        id: "1",
        status: "VERIFIED",
        custodyChain: 84532,
      }),
      null,
    );
  });
});

describe("mapProfileListing", () => {
  it("maps denorm fields including year vin cover", () => {
    const row = mapProfileListing({
      tokenId: "7",
      active: true,
      passportStatus: "VERIFIED",
      chainId: 84532,
      custodyChain: 11155111,
      originChainId: 84532,
      make: "Honda",
      model: "Civic",
      year: 2019,
      vin: "1HGBH41JXMN109186",
      coverPhotoUri: "https://example.com/a.jpg",
    });
    assert.ok(row);
    assert.equal(row.custodyChain, 11155111);
    assert.equal(row.originChainId, 84532);
    assert.equal(row.make, "Honda");
    assert.equal(row.year, 2019);
    assert.equal(row.vin, "1HGBH41JXMN109186");
    assert.equal(row.imageUrl, "https://example.com/a.jpg");
  });

  it("falls back to listing chainId when custody missing", () => {
    const row = mapProfileListing({
      tokenId: "8",
      active: true,
      passportStatus: "UNVERIFIED",
      chainId: 11155111,
    });
    assert.ok(row);
    assert.equal(row.custodyChain, 11155111);
    assert.equal(row.imageUrl, null);
  });

  it("drops inactive listings", () => {
    assert.equal(
      mapProfileListing({
        tokenId: "9",
        active: false,
        chainId: 84532,
        custodyChain: 84532,
      }),
      null,
    );
  });
});
