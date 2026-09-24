import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress } from "viem";

import { AVAILABLE, blocked } from "../lib/challenge/action-gate.ts";
import type { MandateSnapshot } from "../lib/commerce/mandate.ts";
import { COMPENSATION_FORM, DENOMINATION_KIND } from "../lib/commerce/denomination.ts";
import {
  commerceFactKnown,
  commerceFactPending,
  commerceFactRefused,
} from "../lib/passport/commerce-fact.ts";
import type { EncumbrancePermissionGate } from "../lib/passport/encumbrance-permission.ts";
import {
  deriveSellSurface,
  type SellSurfaceFlags,
  type SellSurfaceInput,
} from "../lib/passport/sell-surface.ts";
import { mintProtocolOwner } from "../lib/web3/protocol-address.ts";

const AGENT = mintProtocolOwner(
  84_532,
  "0x1111111111111111111111111111111111111111",
)!;
const NOW = 2_000_000_000;

const AVAILABLE_PERM: EncumbrancePermissionGate = { status: "available" };
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
  source: { presence: "known", address: AGENT },
};
const SUPPORT_OWED: EncumbrancePermissionGate = {
  status: "blocked",
  cause: "product_owner_owed",
};

const allHidden: SellSurfaceFlags = {
  showFixedPriceOpen: false,
  showFixedPriceGrant: false,
  showFixedPriceMandateCard: false,
  ascendingSelfOpen: null,
  showAscendingGrant: false,
  showAscendingMandateCard: false,
  showAscendingRunnerNote: false,
};

function inactiveMandate(mode: "fixedPrice" | "ascending"): MandateSnapshot {
  return {
    namespace: 84532,
    mode,
    tokenId: "1",
    agent: zeroAddress as MandateSnapshot["agent"],
    expiry: 0,
    asset: zeroAddress as MandateSnapshot["asset"],
    denominationKind: DENOMINATION_KIND.Fiat,
    currencyCode:
      "0x5553440000000000000000000000000000000000000000000000000000000000",
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
    agent: AGENT as MandateSnapshot["agent"],
    floor: 1_000_000_00n,
    active: true,
    ...overrides,
  };
}

function input(overrides: Partial<SellSurfaceInput> = {}): SellSurfaceInput {
  return {
    isOwner: true,
    hasLiveConsignment: commerceFactKnown(false),
    fixedPriceConfigured: true,
    ascendingConfigured: true,
    openConsignmentPermission: AVAILABLE_PERM,
    isActiveVerifier: false,
    passportStatus: "UNVERIFIED",
    fixedPriceMandate: commerceFactKnown(inactiveMandate("fixedPrice")),
    ascendingMandate: commerceFactKnown(inactiveMandate("ascending")),
    now: NOW,
    ...overrides,
  };
}

function flagsOf(result: ReturnType<typeof deriveSellSurface>): SellSurfaceFlags {
  const { closedCause: _c, ...flags } = result;
  return flags;
}

describe("deriveSellSurface", () => {
  it("hides when not owner", () => {
    assert.deepEqual(flagsOf(deriveSellSurface(input({ isOwner: false }))), allHidden);
  });

  it("EVM known live consignment — hides CTAs", () => {
    assert.deepEqual(
      flagsOf(deriveSellSurface(input({ hasLiveConsignment: commerceFactKnown(true) }))),
      allHidden,
    );
  });

  it("EVM pending live — fail closed", () => {
    const result = deriveSellSurface(
      input({ hasLiveConsignment: commerceFactPending() }),
    );
    assert.deepEqual(flagsOf(result), allHidden);
    assert.equal(result.closedCause, "live_pending");
  });

  it("SVM product_owner_owed live — fail closed with cause", () => {
    const result = deriveSellSurface(
      input({
        hasLiveConsignment: commerceFactRefused("product_owner_owed"),
      }),
    );
    assert.deepEqual(flagsOf(result), allHidden);
    assert.equal(result.closedCause, "product_owner_owed");
  });

  it("hides when permission unresolved / refused / unanswerable / support", () => {
    assert.deepEqual(
      flagsOf(deriveSellSurface(input({ openConsignmentPermission: UNRESOLVED }))),
      allHidden,
    );
    assert.deepEqual(
      flagsOf(deriveSellSurface(input({ openConsignmentPermission: REFUSED }))),
      allHidden,
    );
    assert.deepEqual(
      flagsOf(deriveSellSurface(input({ openConsignmentPermission: UNANSWERABLE }))),
      allHidden,
    );
    assert.deepEqual(
      flagsOf(deriveSellSurface(input({ openConsignmentPermission: SUPPORT_OWED }))),
      allHidden,
    );
  });

  it("EVM known not-live — shows fixed-price open when free", () => {
    assert.deepEqual(flagsOf(deriveSellSurface(input())), {
      showFixedPriceOpen: true,
      showFixedPriceGrant: true,
      showFixedPriceMandateCard: false,
      ascendingSelfOpen: null,
      showAscendingGrant: true,
      showAscendingMandateCard: false,
      showAscendingRunnerNote: true,
    });
  });

  it("KarPro + VERIFIED — ascending self-open available", () => {
    assert.deepEqual(
      flagsOf(
        deriveSellSurface(
          input({
            isActiveVerifier: true,
            passportStatus: "VERIFIED",
          }),
        ),
      ),
      {
        showFixedPriceOpen: true,
        showFixedPriceGrant: true,
        showFixedPriceMandateCard: false,
        ascendingSelfOpen: AVAILABLE,
        showAscendingGrant: false,
        showAscendingMandateCard: false,
        showAscendingRunnerNote: false,
      },
    );
  });

  it("KarPro + non-VERIFIED — dimmed ascending self-open", () => {
    assert.deepEqual(
      flagsOf(
        deriveSellSurface(
          input({
            isActiveVerifier: true,
            passportStatus: "UNVERIFIED",
          }),
        ),
      ),
      {
        showFixedPriceOpen: true,
        showFixedPriceGrant: true,
        showFixedPriceMandateCard: false,
        ascendingSelfOpen: blocked("not_verified"),
        showAscendingGrant: false,
        showAscendingMandateCard: false,
        showAscendingRunnerNote: false,
      },
    );
  });

  it("Nuclear #4: unread status fails closed on ascending self-open", () => {
    const flags = flagsOf(
      deriveSellSurface(
        input({ isActiveVerifier: true, passportStatus: undefined }),
      ),
    );
    assert.equal(flags.ascendingSelfOpen, null);
    assert.equal(flags.showFixedPriceOpen, true);
  });

  it("active fixed-price mandate shows mandate card", () => {
    const flags = flagsOf(
      deriveSellSurface(
        input({
          fixedPriceMandate: commerceFactKnown(activeMandate("fixedPrice")),
        }),
      ),
    );
    assert.equal(flags.showFixedPriceMandateCard, true);
    assert.equal(flags.showFixedPriceGrant, false);
  });

  it("keeps an expired mandate as a management card", () => {
    assert.deepEqual(
      flagsOf(
        deriveSellSurface(
          input({
            fixedPriceMandate: commerceFactKnown(
              activeMandate("fixedPrice", { expiry: NOW - 1 }),
            ),
          }),
        ),
      ),
      {
        showFixedPriceOpen: true,
        showFixedPriceGrant: false,
        showFixedPriceMandateCard: true,
        ascendingSelfOpen: null,
        showAscendingGrant: true,
        showAscendingMandateCard: false,
        showAscendingRunnerNote: true,
      },
    );
  });

  it("shows an ascending mandate card when a standing grant exists", () => {
    assert.deepEqual(
      flagsOf(
        deriveSellSurface(
          input({
            ascendingMandate: commerceFactKnown(activeMandate("ascending")),
            isActiveVerifier: true,
            passportStatus: "VERIFIED",
          }),
        ),
      ),
      {
        showFixedPriceOpen: true,
        showFixedPriceGrant: true,
        showFixedPriceMandateCard: false,
        ascendingSelfOpen: null,
        showAscendingGrant: false,
        showAscendingMandateCard: true,
        showAscendingRunnerNote: false,
      },
    );
  });

  it("pending mandate — open still shows; grant/card hide", () => {
    const flags = flagsOf(
      deriveSellSurface(
        input({
          fixedPriceMandate: commerceFactPending(),
          ascendingMandate: commerceFactPending(),
        }),
      ),
    );
    assert.equal(flags.showFixedPriceOpen, true);
    assert.equal(flags.showFixedPriceGrant, false);
    assert.equal(flags.showAscendingGrant, false);
  });

  it("refused mandate — fail closed", () => {
    const result = deriveSellSurface(
      input({
        fixedPriceMandate: commerceFactRefused("product_owner_owed"),
      }),
    );
    assert.deepEqual(flagsOf(result), allHidden);
    assert.equal(result.closedCause, "product_owner_owed");
  });

  it("ascendingConfigured false hides ascending flags", () => {
    const flags = flagsOf(deriveSellSurface(input({ ascendingConfigured: false })));
    assert.equal(flags.showAscendingGrant, false);
    assert.equal(flags.showAscendingRunnerNote, false);
  });
});
