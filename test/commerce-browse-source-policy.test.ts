/**
 * Commerce browse source — selected namespace is admitted before fetch.
 *
 * Pins: Solana refuses no_indexed_commerce; EVM available filters chainId;
 * unscoped omits chainId; empty copy ≠ refusal; void discard banned;
 * sentence sole-owned in browse-source.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  admitCommerceBrowseSource,
  browseSourceChainIdQuery,
  COMMERCE_BROWSE_SOURCE_CAUSES,
  commerceBrowseSourceCauseCopy,
  commerceBrowseSourceRefusalCopy,
  hasIndexedCommerceSource,
} from "@/lib/commerce/browse-source";
import {
  COMMERCIAL_ACTIVE,
  unresolvedNamespaceCopy,
  type CommercialRegistry,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { buildConsignmentsListUrl } from "@/lib/web3/ponder-urls";
import { FIXTURE_SVM_NAMESPACE, FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOLANA_NS = 2_000_040_168;
const REFUSAL_SENTENCE = "This network has no indexed commerce yet.";
const MARKET_EMPTY_TITLE = "No active listings match these filters yet.";
const AUCTION_EMPTY_TITLE = "No active auctions";

const AUCTION_ACTION = "app/actions/auction-browse.ts";
const MARKET_ACTION = "app/actions/marketplace-listings.ts";
const MARKET_LOADER = "components/marketplace/market-browse-loader.tsx";
const BROWSE_SOURCE = "lib/commerce/browse-source.ts";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("commerce browse source admission", () => {
  it("unscoped: null / non-finite → no chainId query", () => {
    for (const input of [null, undefined, Number.NaN, Infinity] as const) {
      const admission = admitCommerceBrowseSource(input);
      assert.equal(admission.status, "unscoped");
      assert.equal(browseSourceChainIdQuery(admission), undefined);
    }
    const url = buildConsignmentsListUrl({
      mode: "fixedPrice",
      active: true,
      page: 1,
      limit: 20,
    });
    assert.equal(url.searchParams.has("chainId"), false);
  });

  it("84532 selected → available; URL carries only that chainId", () => {
    const admission = admitCommerceBrowseSource(84532);
    assert.equal(admission.status, "available");
    if (admission.status !== "available") return;
    assert.equal(admission.namespace, 84532);
    assert.equal(browseSourceChainIdQuery(admission), 84532);
    assert.equal(hasIndexedCommerceSource(84532), true);

    const url = buildConsignmentsListUrl({
      mode: "ascending",
      active: true,
      page: 1,
      limit: 48,
      chainId: browseSourceChainIdQuery(admission),
    });
    assert.equal(url.searchParams.get("chainId"), "84532");
  });

  it("11155111 selected → available with that namespace only", () => {
    const admission = admitCommerceBrowseSource(11155111);
    assert.equal(admission.status, "available");
    if (admission.status !== "available") return;
    assert.equal(browseSourceChainIdQuery(admission), 11155111);
  });

  it("Solana selected → refuse no_indexed_commerce; never available", () => {
    const admission = admitCommerceBrowseSource(SOLANA_NS);
    assert.equal(admission.status, "refused");
    if (admission.status !== "refused") return;
    assert.equal(admission.cause, "no_indexed_commerce");
    assert.equal(admission.namespace, SOLANA_NS);
    assert.equal(hasIndexedCommerceSource(SOLANA_NS), false);
    assert.equal(browseSourceChainIdQuery(admission), undefined);
    assert.equal(
      commerceBrowseSourceRefusalCopy(admission.cause),
      REFUSAL_SENTENCE,
    );
  });

  it("non-commercial finite id → unresolved_namespace (not no_indexed_commerce)", () => {
    const admission = admitCommerceBrowseSource(999_999);
    assert.equal(admission.status, "refused");
    if (admission.status !== "refused") return;
    assert.equal(admission.cause, "unresolved_namespace");
    assert.equal(
      commerceBrowseSourceRefusalCopy(admission.cause),
      unresolvedNamespaceCopy(),
    );
  });

  it("injectable registry: SVM commercial without EIP-155 refuses", () => {
    const registry: CommercialRegistry = {
      [FIXTURE_SVM_NAMESPACE]: FIXTURE_SVM_STACK as SvmCommercialActiveStack,
    };
    const admission = admitCommerceBrowseSource(FIXTURE_SVM_NAMESPACE, registry);
    assert.equal(admission.status, "refused");
    if (admission.status !== "refused") return;
    assert.equal(admission.cause, "no_indexed_commerce");
  });

  it("refusal sentence ≠ empty-grid sentences; causes exhaustive", () => {
    assert.notEqual(REFUSAL_SENTENCE, MARKET_EMPTY_TITLE);
    assert.notEqual(REFUSAL_SENTENCE, AUCTION_EMPTY_TITLE);
    assert.equal(
      commerceBrowseSourceCauseCopy("no_indexed_commerce"),
      REFUSAL_SENTENCE,
    );
    for (const cause of COMMERCE_BROWSE_SOURCE_CAUSES) {
      assert.ok(commerceBrowseSourceCauseCopy(cause).length > 0);
    }
  });
});

describe("commerce browse source plants (red → green)", () => {
  it("plant: treating Solana as available (foreign rows) is red", () => {
    const live = admitCommerceBrowseSource(SOLANA_NS);
    assert.notEqual(live.status, "available");

    /** Plant: pretend Solana has a source and would filter/fetch foreign rows. */
    function plantedAdmitAsAvailable(
      namespace: number,
    ): { status: "available"; namespace: number } {
      return { status: "available", namespace };
    }
    const plant = plantedAdmitAsAvailable(SOLANA_NS);
    assert.equal(plant.status, "available");
    assert.notEqual(
      plant.status,
      live.status,
      "plant available must not match live Solana admission",
    );
  });

  it("plant: omitting chainId when EVM selected is red vs live URL", () => {
    const admission = admitCommerceBrowseSource(84532);
    assert.equal(admission.status, "available");
    const correct = buildConsignmentsListUrl({
      mode: "fixedPrice",
      active: true,
      chainId: browseSourceChainIdQuery(admission),
    });
    const planted = buildConsignmentsListUrl({
      mode: "fixedPrice",
      active: true,
      // plant: discard selected namespace
    });
    assert.equal(correct.searchParams.get("chainId"), "84532");
    assert.equal(planted.searchParams.has("chainId"), false);
    assert.notEqual(
      correct.searchParams.get("chainId"),
      planted.searchParams.get("chainId"),
    );
  });

  it("plant: re-inline refusal sentence outside owner is red", () => {
    const owners = [BROWSE_SOURCE];
    const scan = scanProductSources((rel, source) => {
      if (source.includes(JSON.stringify(REFUSAL_SENTENCE))) {
        return `re-inlined no_indexed_commerce sentence (sole owner: commerceBrowseSourceCauseCopy): ${REFUSAL_SENTENCE}`;
      }
      return false;
    }, { owners });
    assertCleanProductScan(scan, { owners });
  });

  it("auction action: no void discard; admit before fetch; chainId in URL path", () => {
    const src = read(AUCTION_ACTION);
    assert.equal(
      /void\s+opts\?\.chainId/.test(src),
      false,
      "void opts?.chainId must not survive",
    );
    assert.ok(
      src.includes("admitCommerceBrowseSource"),
      "auctions must admit via browse-source owner",
    );
    assert.ok(
      src.includes("browseSourceChainIdQuery"),
      "auctions must take chainId query from admission",
    );
    const admitIdx = src.indexOf("admitCommerceBrowseSource");
    const fetchIdx = src.indexOf("ponderFetch");
    assert.ok(admitIdx >= 0 && fetchIdx > admitIdx);
  });

  it("marketplace loader parses chain and passes chainId into search", () => {
    const src = read(MARKET_LOADER);
    assert.ok(src.includes("parseOptionalChainParam"));
    assert.ok(src.includes("chainId"));
    assert.ok(src.includes("searchMarketplaceListings"));
    assert.match(src, /chainId\s*!=\s*null\s*\?\s*\{\s*chainId/);
  });

  it("marketplace action admits and forwards chainId into consignments URL", () => {
    const src = read(MARKET_ACTION);
    assert.ok(src.includes("admitCommerceBrowseSource"));
    assert.ok(src.includes("browseSourceChainIdQuery"));
    assert.ok(src.includes("chainId"));
    assert.equal(/void\s+.*chainId/.test(src), false);
  });

  it("components consume refusal copy from owner; empty titles remain distinct", () => {
    const auctionUi = read("components/auction/auction-browse.tsx");
    const marketUi = read("components/marketplace/market-browse.tsx");
    assert.ok(auctionUi.includes("commerceBrowseSourceRefusalCopy"));
    assert.ok(marketUi.includes("commerceBrowseSourceRefusalCopy"));
    assert.ok(auctionUi.includes(AUCTION_EMPTY_TITLE));
    assert.ok(marketUi.includes(MARKET_EMPTY_TITLE));
    assert.equal(auctionUi.includes(REFUSAL_SENTENCE), false);
    assert.equal(marketUi.includes(REFUSAL_SENTENCE), false);
  });

  it("live commercial registry: Solana configured but not an indexed commerce source", () => {
    assert.ok(COMMERCIAL_ACTIVE[SOLANA_NS]);
    assert.equal(hasIndexedCommerceSource(SOLANA_NS), false);
    assert.equal(hasIndexedCommerceSource(84532), true);
    assert.equal(hasIndexedCommerceSource(11155111), true);
  });
});
