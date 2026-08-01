import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress } from "viem";

import type { MandateSnapshot } from "../lib/commerce/mandate.ts";
import { COMPENSATION_FORM, DENOMINATION_KIND } from "../lib/commerce/denomination.ts";
import type { EncumbrancePermissionGate } from "../lib/passport/encumbrance-permission.ts";
import {
  deriveSellSurface,
  type SellSurfaceFlags,
  type SellSurfaceInput,
} from "../lib/passport/sell-surface.ts";

const AGENT = "0x1111111111111111111111111111111111111111" as const;
const OWNER = "0x2222222222222222222222222222222222222222" as const;
const NOW = 2_000_000_000;

const AVAILABLE: EncumbrancePermissionGate = { status: "available" };
const REFUSED: EncumbrancePermissionGate = {
  status: "blocked",
  cause: "refused",
};
const UNRESOLVED: EncumbrancePermissionGate = {
  status: "blocked",
  cause: "reads_unresolved",
};
const UNANSWERABLE: EncumbrancePermissionGate = {
  status: "blocked",
  cause: "source_unanswerable",
  source: AGENT,
};

const allHidden: SellSurfaceFlags = {
  showFixedPriceOpen: false,
  showFixedPriceGrant: false,
  showFixedPriceMandateCard: false,
  showAscendingOpen: false,
  showAscendingGrant: false,
  showAscendingMandateCard: false,
  showAscendingRunnerNote: false,
};

function inactiveMandate(mode: "fixedPrice" | "ascending"): MandateSnapshot {
  return {
    mode,
    tokenId: "1",
    agent: zeroAddress,
    expiry: 0,
    asset: zeroAddress,
    denominationKind: DENOMINATION_KIND.Fiat,
    currencyCode: "0x5553440000000000000000000000000000000000000000000000000000000000",
    floor: 0n,
    compensationForm: COMPENSATION_FORM.Commission,
    commissionBps: 0,
    active: false,
  };
}

function activeMandate(
  mode: "fixedPrice" | "ascending",
  overrides: Partial<MandateSnapshot> = {},
): MandateSnapshot {
  return {
    ...inactiveMandate(mode),
    agent: AGENT,
    floor: 1_000_000_00n,
    active: true,
    ...overrides,
  };
}

function input(overrides: Partial<SellSurfaceInput> = {}): SellSurfaceInput {
  return {
    isOwner: true,
    hasLiveConsignment: false,
    fixedPriceConfigured: true,
    ascendingConfigured: true,
    openConsignmentPermission: AVAILABLE,
    isActiveVerifier: false,
    fixedPriceMandate: { value: null, now: NOW },
    ascendingMandate: { value: null, now: NOW },
    ...overrides,
  };
}

describe("deriveSellSurface", () => {
  it("hides everything for a non-owner", () => {
    assert.deepEqual(deriveSellSurface(input({ isOwner: false })), allHidden);
  });

  it("hides everything while a live consignment exists", () => {
    assert.deepEqual(
      deriveSellSurface(input({ hasLiveConsignment: true })),
      allHidden,
    );
  });

  it("fails closed while live-consignment or may facts are unresolved", () => {
    assert.deepEqual(
      deriveSellSurface(input({ hasLiveConsignment: undefined })),
      allHidden,
    );
    assert.deepEqual(
      deriveSellSurface(input({ openConsignmentPermission: UNRESOLVED })),
      allHidden,
    );
    assert.deepEqual(
      deriveSellSurface(input({ openConsignmentPermission: REFUSED })),
      allHidden,
    );
  });

  it("fails closed when a source is unanswerable", () => {
    assert.deepEqual(
      deriveSellSurface(input({ openConsignmentPermission: UNANSWERABLE })),
      allHidden,
    );
  });

  it("shows fixed-price open and ascending grant for a private owner", () => {
    assert.deepEqual(deriveSellSurface(input()), {
      ...allHidden,
      showFixedPriceOpen: true,
      showFixedPriceGrant: true,
      showAscendingGrant: true,
      showAscendingRunnerNote: true,
    });
  });

  it("replaces ascending grant with open for a KarPro owner", () => {
    assert.deepEqual(deriveSellSurface(input({ isActiveVerifier: true })), {
      ...allHidden,
      showFixedPriceOpen: true,
      showFixedPriceGrant: true,
      showAscendingOpen: true,
    });
  });

  it("shows a fixed-price mandate card when a standing grant exists", () => {
    assert.deepEqual(
      deriveSellSurface(
        input({
          fixedPriceMandate: {
            value: activeMandate("fixedPrice"),
            now: NOW,
          },
        }),
      ),
      {
        ...allHidden,
        showFixedPriceOpen: true,
        showFixedPriceMandateCard: true,
        showAscendingGrant: true,
        showAscendingRunnerNote: true,
      },
    );
  });

  it("keeps an expired mandate as a management card", () => {
    assert.deepEqual(
      deriveSellSurface(
        input({
          fixedPriceMandate: {
            value: activeMandate("fixedPrice", { expiry: NOW - 1 }),
            now: NOW,
          },
        }),
      ),
      {
        ...allHidden,
        showFixedPriceOpen: true,
        showFixedPriceMandateCard: true,
        showAscendingGrant: true,
        showAscendingRunnerNote: true,
      },
    );
  });

  it("shows an ascending mandate card when a standing grant exists", () => {
    assert.deepEqual(
      deriveSellSurface(
        input({
          ascendingMandate: {
            value: activeMandate("ascending"),
            now: NOW,
          },
          isActiveVerifier: true,
        }),
      ),
      {
        ...allHidden,
        showFixedPriceOpen: true,
        showFixedPriceGrant: true,
        showAscendingMandateCard: true,
      },
    );
  });

  it("hides ascending actions when ascending is not configured", () => {
    const flags = deriveSellSurface(input({ ascendingConfigured: false }));
    assert.equal(flags.showAscendingOpen, false);
    assert.equal(flags.showAscendingGrant, false);
    assert.equal(flags.showAscendingRunnerNote, false);
    assert.equal(flags.showFixedPriceOpen, true);
  });

  it("hides grant CTAs while mandate reads are unresolved", () => {
    const flags = deriveSellSurface(
      input({
        fixedPriceMandate: undefined,
        ascendingMandate: undefined,
        isActiveVerifier: true,
      }),
    );
    assert.equal(flags.showFixedPriceOpen, true);
    assert.equal(flags.showFixedPriceGrant, false);
    assert.equal(flags.showAscendingOpen, false);
    assert.equal(flags.showAscendingGrant, false);
  });

  void OWNER; // retained for future owner-address fixtures
});
