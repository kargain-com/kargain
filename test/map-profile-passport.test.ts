import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMPENSATION_FORM,
  DENOMINATION_KIND,
} from "../lib/commerce/denomination.ts";
import type { ConsignmentRecord } from "../lib/commerce/ponder-consignment.ts";
import {
  isProfilePassportBridgedAway,
  mapProfileListingFromConsignment,
  mapProfilePassport,
} from "../lib/passport/map-profile-passport.ts";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

function baseConsignment(
  overrides: Partial<ConsignmentRecord> = {},
): ConsignmentRecord {
  return {
    id: "84532-fixedPrice-7-1",
    chainId: 84532,
    mode: "fixedPrice",
    modeContract: "0x73F41293bb207443990006b951CE9BC38Ef2eB3b",
    tokenId: "7",
    saleOrdinal: 1,
    seller: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
    agent: null,
    asset: ZERO,
    denominationKind: DENOMINATION_KIND.Fiat,
    currencyCode: "USD",
    floor: 0n,
    compensationForm: COMPENSATION_FORM.Margin,
    commissionBps: 0,
    price: 10_000_000_00000000n,
    platformFeeBps: 250,
    phase: "offered",
    closeReason: null,
    openedAt: 1,
    closedAt: null,
    recallRequestedAt: 0n,
    buyer: null,
    hasSettlementNote: false,
    make: "Honda",
    model: "Civic",
    year: 2019,
    vin: "1HGBH41JXMN109186",
    coverPhotoUri: "https://example.com/a.jpg",
    status: "VERIFIED",
    verifier: null,
    duplicateVin: false,
    mileageKm: null,
    custodyChain: 11155111,
    originChainId: 84532,
    ...overrides,
  };
}

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

describe("mapProfileListingFromConsignment", () => {
  it("maps live seller consignment denorm fields", () => {
    const row = mapProfileListingFromConsignment(baseConsignment());
    assert.ok(row);
    assert.equal(row.tokenId, "7");
    assert.equal(row.custodyChain, 11155111);
    assert.equal(row.originChainId, 84532);
    assert.equal(row.make, "Honda");
    assert.equal(row.year, 2019);
    assert.equal(row.vin, "1HGBH41JXMN109186");
    assert.equal(row.imageUrl, "https://example.com/a.jpg");
    assert.equal(row.passportStatus, "VERIFIED");
  });

  it("keeps offered and binding; drops closed and held", () => {
    assert.ok(mapProfileListingFromConsignment(baseConsignment({ phase: "offered" })));
    assert.ok(mapProfileListingFromConsignment(baseConsignment({ phase: "binding" })));
    assert.equal(
      mapProfileListingFromConsignment(baseConsignment({ phase: "held" })),
      null,
    );
    assert.equal(
      mapProfileListingFromConsignment(baseConsignment({ phase: "closed" })),
      null,
    );
  });

  it("defaults status to UNVERIFIED when denorm absent", () => {
    const row = mapProfileListingFromConsignment(
      baseConsignment({ status: null, make: null, coverPhotoUri: null, vin: null }),
    );
    assert.ok(row);
    assert.equal(row.passportStatus, "UNVERIFIED");
    assert.equal(row.make, "");
    assert.equal(row.imageUrl, null);
    assert.equal(row.vin, null);
  });
});
