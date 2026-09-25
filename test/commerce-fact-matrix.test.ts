/**
 * S8-D1b — behaviour matrix: every surface owner ×
 * { EVM known live, EVM known not-live, EVM pending, SVM product_owner_owed }.
 * EVM rows equal today's decisions; SVM rows fail closed with the named cause.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress } from "viem";

import { COMPENSATION_FORM, DENOMINATION_KIND } from "../lib/commerce/denomination.ts";
import type { MandateSnapshot } from "../lib/commerce/mandate.ts";
import {
  commerceFactCauseCopy,
  commerceFactKnown,
  commerceFactPending,
  commerceFactRefused,
  combinePhaseFacts,
  COMMERCE_FACT_CAUSES,
} from "../lib/passport/commerce-fact.ts";
import { deriveBridgeSurface } from "../lib/passport/bridge-surface.ts";
import {
  encumbrancePermissionFromSupport,
  deriveEncumbrancePermission,
} from "../lib/passport/encumbrance-permission.ts";
import {
  deriveEncumbranceRegistry,
  encumbranceRegistryFromSupport,
} from "../lib/passport/encumbrance-registry.ts";
import { derivePassportCommerceRail } from "../lib/passport/passport-commerce-rail.ts";
import {
  planPassportCommerceReads,
  resolvePassportCommerceFacts,
} from "../lib/passport/passport-commerce-facts.ts";
import { deriveSellSurface } from "../lib/passport/sell-surface.ts";

const NOW = 2_000_000_000;

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

describe("S8-D1b commerce-fact behaviour matrix", () => {
  describe("combinePhaseFacts", () => {
    it("EVM known live / not-live / pending", () => {
      const live = combinePhaseFacts(
        commerceFactKnown(true),
        commerceFactKnown(false),
      );
      assert.deepEqual(live.hasLiveConsignment, commerceFactKnown(true));
      assert.deepEqual(live.liveConsignmentMode, commerceFactKnown("fixedPrice"));

      const idle = combinePhaseFacts(
        commerceFactKnown(false),
        commerceFactKnown(false),
      );
      assert.deepEqual(idle.hasLiveConsignment, commerceFactKnown(false));
      assert.deepEqual(idle.liveConsignmentMode, commerceFactKnown(null));

      const pending = combinePhaseFacts(
        commerceFactPending(),
        commerceFactKnown(false),
      );
      assert.equal(pending.hasLiveConsignment.status, "pending");
    });

    it("SVM product_owner_owed — refused carries cause", () => {
      const r = combinePhaseFacts(
        commerceFactRefused("product_owner_owed"),
        commerceFactRefused("product_owner_owed"),
      );
      assert.deepEqual(r.hasLiveConsignment, {
        status: "refused",
        cause: "product_owner_owed",
      });
    });
  });

  describe("deriveSellSurface", () => {
    const base = {
      isOwner: true,
      fixedPriceConfigured: true,
      ascendingConfigured: true,
      openConsignmentPermission: {
        status: "available" as const,
      },
      isActiveVerifier: false as boolean | undefined,
      passportStatus: "UNVERIFIED" as const,
      fixedPriceMandate: commerceFactKnown(inactiveMandate("fixedPrice")),
      ascendingMandate: commerceFactKnown(inactiveMandate("ascending")),
      now: NOW,
    };

    it("EVM known not-live — CTAs visible", () => {
      const r = deriveSellSurface({
        ...base,
        hasLiveConsignment: commerceFactKnown(false),
      });
      assert.equal(r.showFixedPriceOpen, true);
      assert.equal(r.closedCause, null);
    });

    it("EVM known live — hidden", () => {
      const r = deriveSellSurface({
        ...base,
        hasLiveConsignment: commerceFactKnown(true),
      });
      assert.equal(r.showFixedPriceOpen, false);
      assert.equal(r.closedCause, "live_consignment");
    });

    it("EVM pending — fail closed", () => {
      const r = deriveSellSurface({
        ...base,
        hasLiveConsignment: commerceFactPending(),
      });
      assert.equal(r.showFixedPriceOpen, false);
      assert.equal(r.closedCause, "live_pending");
    });

    it("SVM product_owner_owed — fail closed with cause", () => {
      const r = deriveSellSurface({
        ...base,
        hasLiveConsignment: commerceFactRefused("product_owner_owed"),
      });
      assert.equal(r.showFixedPriceOpen, false);
      assert.equal(r.closedCause, "product_owner_owed");
    });
  });

  describe("deriveBridgeSurface", () => {
    const base = {
      isOwner: true,
      chainId: 84532,
      custodyLock: { status: "known" as const, locked: false },
      ponderCustodyChain: 84532,
    };

    it("EVM known available — canBridge", () => {
      const r = deriveBridgeSurface({
        ...base,
        leaveChainPermission: { status: "available" },
      });
      assert.equal(r.canBridge, true);
    });

    it("EVM pending leave — unresolved waiting", () => {
      const r = deriveBridgeSurface({
        ...base,
        leaveChainPermission: {
          status: "blocked",
          cause: "reads_unresolved",
        },
      });
      assert.equal(r.blockReason, "unresolved");
    });

    it("SVM product_owner_owed — support block, not waiting", () => {
      const r = deriveBridgeSurface({
        ...base,
        leaveChainPermission: encumbrancePermissionFromSupport(
          "product_owner_owed",
        ),
      });
      assert.equal(r.blockReason, "product_owner_owed");
      assert.notEqual(r.blockReason, "unresolved");
    });
  });

  describe("derivePassportCommerceRail", () => {
    const base = {
      fixedPriceConfigured: true,
      ascendingConfigured: true,
      ponderListingActive: false,
      auctionOwnsCommerce: false,
      auctionPonderActive: false,
      auctionHoldOpen: false,
    };

    it("EVM known live — blocks auction", () => {
      const r = derivePassportCommerceRail({
        ...base,
        fixedPriceLive: commerceFactKnown(true),
        ascendingLive: commerceFactKnown(false),
      });
      assert.equal(r.listingBlocksAuction, true);
      assert.equal(r.fixedPriceLiveKnownTrue, true);
    });

    it("EVM known not-live — does not block from chain", () => {
      const r = derivePassportCommerceRail({
        ...base,
        fixedPriceLive: commerceFactKnown(false),
        ascendingLive: commerceFactKnown(false),
      });
      assert.equal(r.listingBlocksAuction, false);
      assert.equal(r.fixedPriceLiveKnownTrue, false);
    });

    it("EVM pending — fail closed as listed-pending", () => {
      const r = derivePassportCommerceRail({
        ...base,
        fixedPriceLive: commerceFactPending(),
        ascendingLive: commerceFactPending(),
      });
      assert.equal(r.listingBlocksAuction, true);
      assert.equal(r.fixedPriceLiveKnownTrue, false);
    });

    it("SVM product_owner_owed — same fail-closed as pending", () => {
      const r = derivePassportCommerceRail({
        ...base,
        fixedPriceLive: commerceFactRefused("product_owner_owed"),
        ascendingLive: commerceFactRefused("product_owner_owed"),
      });
      assert.equal(r.listingBlocksAuction, true);
      assert.equal(r.fixedPriceLiveKnownTrue, false);
      assert.equal(r.ascendingLive, false);
    });
  });

  describe("encumbrance permission + registry", () => {
    it("EVM known may true / false / pending", () => {
      assert.equal(
        deriveEncumbrancePermission({ status: "success", result: true }).status,
        "available",
      );
      assert.deepEqual(
        deriveEncumbrancePermission({ status: "success", result: false }),
        { status: "blocked", cause: "refused" },
      );
      assert.deepEqual(deriveEncumbrancePermission({ status: "pending" }), {
        status: "blocked",
        cause: "reads_unresolved",
      });
    });

    it("SVM product_owner_owed — support gate, not reads_unresolved", () => {
      const gate = encumbrancePermissionFromSupport("product_owner_owed");
      assert.equal(gate.status, "blocked");
      assert.equal(
        gate.status === "blocked" && gate.cause,
        "product_owner_owed",
      );
    });

    it("registry EVM known / pending / SVM support", () => {
      const known = deriveEncumbranceRegistry({
        namespace: 84532,
        countEntry: { status: "success", result: 0n },
        atEntries: [],
      });
      assert.deepEqual(known, { status: "known", value: [] });

      const pending = deriveEncumbranceRegistry({
        namespace: 84532,
        countEntry: undefined,
        atEntries: [],
      });
      assert.deepEqual(pending, { status: "pending" });

      assert.deepEqual(encumbranceRegistryFromSupport("product_owner_owed"), {
        status: "refused",
        cause: "product_owner_owed",
      });
    });
  });

  describe("resolvePassportCommerceFacts SVM arm", () => {
    it("unread entries stay pending; may_* reads_unresolved without inject; configured true", async () => {
      const plan = await planPassportCommerceReads({
        chainId: 2000040168,
        tokenId: "1",
      });
      assert.equal(plan.ok, true);
      if (!plan.ok || plan.vm !== "svm") {
        assert.fail("expected SVM plan on Solana Devnet");
      }
      assert.equal(plan.fixedPriceConfigured, true);
      assert.equal(plan.ascendingConfigured, true);
      assert.ok(
        plan.contracts.some((c) => c.key === "fp.consignment"),
        "plan must request fp.consignment",
      );
      assert.ok(
        plan.contracts.some((c) => c.key === "passportConfig"),
        "plan must request passportConfig",
      );

      const facts = resolvePassportCommerceFacts({
        plan,
        planning: false,
        entry: () => undefined,
        get: () => undefined,
        isPending: false,
        namespace: 2000040168,
      });

      assert.equal(facts.fixedPrice.configured, true);
      assert.equal(facts.ascending.configured, true);
      assert.deepEqual(facts.fixedPrice.live, { status: "pending" });
      assert.deepEqual(facts.hasLiveConsignment, { status: "pending" });
      assert.deepEqual(facts.encumbranceRegistry, { status: "pending" });
      assert.deepEqual(facts.challengeOpen, { status: "pending" });
      assert.equal(
        facts.openConsignmentPermission.status === "blocked" &&
          facts.openConsignmentPermission.cause,
        "reads_unresolved",
      );
    });
  });
});

describe("commerceFactCauseCopy", () => {
  it("every CommerceFactCause returns a non-empty sentence", () => {
    assert.equal(COMMERCE_FACT_CAUSES.length, 8);
    for (const cause of COMMERCE_FACT_CAUSES) {
      const copy = commerceFactCauseCopy(cause);
      assert.ok(copy.length > 0, cause);
      assert.doesNotMatch(copy, /Waiting/, cause);
    }
  });

  it("pins support and keyed sentences", () => {
    assert.match(
      commerceFactCauseCopy("rpc_unavailable"),
      /The network did not answer/,
    );
    assert.equal(
      commerceFactCauseCopy("not_in_program"),
      "This network's passport program does not provide this.",
    );
    assert.match(
      commerceFactCauseCopy("product_owner_owed"),
      /does not read this on this network yet/i,
    );
    assert.match(
      commerceFactCauseCopy("authority_only"),
      /Only the program authority/i,
    );
  });
});
