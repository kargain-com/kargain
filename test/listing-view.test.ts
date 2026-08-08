import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DENOMINATION_KIND } from "../lib/commerce/denomination.ts";
import { consignmentToListingInput } from "../lib/commerce/listing-view.ts";
import type { PonderConsignmentRow } from "../lib/commerce/ponder-consignment.ts";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function baseRow(
  overrides: Partial<PonderConsignmentRow> = {},
): PonderConsignmentRow {
  return {
    id: "84532-fp-1",
    chainId: 84532,
    mode: "fixedPrice",
    modeContract: "0x73F41293bb207443990006b951CE9BC38Ef2eB3b",
    tokenId: "1",
    saleOrdinal: 1,
    seller: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
    agent: "",
    asset: USDC,
    denominationKind: DENOMINATION_KIND.Asset,
    currencyCode: "",
    floor: "0",
    compensationForm: 0,
    commissionBps: 0,
    price: "350000000000",
    platformFeeBps: 10,
    phase: "offered",
    openedAt: "1",
    updatedAt: "1",
    ...overrides,
  };
}

describe("consignmentToListingInput", () => {
  it("carries asset denomination price and asset (not silent $0 display facts)", () => {
    const input = consignmentToListingInput(baseRow());
    assert.equal(input.denominationKind, DENOMINATION_KIND.Asset);
    assert.equal(input.price, "350000000000");
    assert.equal(input.asset, USDC);
    assert.equal(input.fiatPrice1e8, "0");
  });

  it("keeps fiat price in fiatPrice1e8 for fiat lots", () => {
    const input = consignmentToListingInput(
      baseRow({
        denominationKind: DENOMINATION_KIND.Fiat,
        asset: "0x0000000000000000000000000000000000000000",
        price: "4200000000000",
        currencyCode: "USD",
      }),
    );
    assert.equal(input.denominationKind, DENOMINATION_KIND.Fiat);
    assert.equal(input.fiatPrice1e8, "4200000000000");
    assert.equal(input.price, "4200000000000");
  });
});
