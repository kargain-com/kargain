/**
 * Product invariant: marketplace browse filters apply end-to-end.
 * Keys ⊆ catalog ⊆ handler; chrome commits typed values; price SQL ≡ Asking facts.
 * Stay red while chrome is dead or Asking USD is forked in SQL.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { askingUsdcFacts } from "../lib/commerce/listing-price-display.ts";
import { marketFiltersToApiInput, DEFAULT_MARKET_FILTERS } from "../lib/marketplace/filter-params.ts";
import { COMMERCIAL_ACTIVE } from "../lib/web3/commercial-active.ts";
import { consignmentsListQueryKeys } from "../lib/web3/ponder-endpoints.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** State → API key for multi-select CSV fields. */
const STATE_TO_API: Record<string, string> = {
  fuelTypes: "fuelType",
  bodyTypes: "bodyType",
  transmissions: "transmission",
  conditions: "condition",
  vehicleTypes: "vehicleType",
};

/** URL/display-only — not sent to Ponder. */
const NON_API_STATE_KEYS = new Set([
  "placeLabel",
  "placeCountryCode",
  "page",
]);

const FILTER_CHROME = [
  "components/marketplace/market-filter-bar.tsx",
  "components/marketplace/market-filter-drawer.tsx",
  "components/marketplace/market-filter-chips.tsx",
  "components/marketplace/market-sort-select.tsx",
  "components/marketplace/filter-combobox.tsx",
] as const;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function queryKeysReadInConsignmentsHandler(): Set<string> {
  const source = read("src/api/commerce-routes.ts");
  const start = source.indexOf('app.get("/consignments"');
  assert.ok(start >= 0, "GET /consignments handler missing");
  const from = source.slice(start);
  const next = from.search(/\n\s*app\.get\(/);
  const block = next > 0 ? from.slice(0, next) : from.slice(0, 8000);
  const keys = new Set<string>();
  const re = /c\.req\.query\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    keys.add(m[1]!);
  }
  return keys;
}

describe("marketplace browse filter invariant", () => {
  it("marketFiltersToApiInput keys are covered by catalog + /consignments handler", () => {
    const sample = marketFiltersToApiInput({
      ...DEFAULT_MARKET_FILTERS,
      search: "civic",
      make: "Honda",
      model: "Civic",
      yearMin: "2018",
      yearMax: "2024",
      priceMin: "1000",
      priceMax: "50000",
      priceCurrency: "USD",
      mileageMin: "0",
      mileageMax: "100000",
      fuelTypes: ["Petrol"],
      bodyTypes: ["Sedan"],
      transmissions: ["Manual"],
      conditions: ["Used"],
      vehicleTypes: ["Car"],
      placeId: "place-1",
      colour: "red",
      status: "VERIFIED",
      sort: "price_asc",
      page: 1,
    });

    const catalog = new Set(consignmentsListQueryKeys());
    const handler = queryKeysReadInConsignmentsHandler();
    const missing: string[] = [];

    for (const [key, value] of Object.entries(sample)) {
      if (value === undefined) continue;
      if (key === "limit" || key === "page") {
        if (!catalog.has(key) || !handler.has(key)) {
          missing.push(`${key}: pagination not in catalog/handler`);
        }
        continue;
      }
      if (!catalog.has(key)) {
        missing.push(`${key}: not in consignments.list catalog`);
      }
      if (!handler.has(key)) {
        missing.push(`${key}: not read by /consignments handler`);
      }
    }

    assert.deepEqual(missing, []);
  });

  it("MarketFilterState fields that are user filters map to catalog API keys", () => {
    const catalog = new Set(consignmentsListQueryKeys());
    const handler = queryKeysReadInConsignmentsHandler();
    const stateKeys = Object.keys(DEFAULT_MARKET_FILTERS);
    const missing: string[] = [];

    for (const stateKey of stateKeys) {
      if (NON_API_STATE_KEYS.has(stateKey)) continue;
      const apiKey = STATE_TO_API[stateKey] ?? stateKey;
      if (!catalog.has(apiKey)) {
        missing.push(`state.${stateKey} → ${apiKey}: missing from catalog`);
      }
      if (!handler.has(apiKey)) {
        missing.push(`state.${stateKey} → ${apiKey}: missing from handler`);
      }
    }

    assert.deepEqual(missing, []);
  });

  it("sort modes exposed in MarketSortSelect are handler-supported", () => {
    const sortSrc = read("components/marketplace/market-sort-select.tsx");
    const modes = ["newest", "price_asc", "price_desc", "mileage_asc"] as const;
    for (const mode of modes) {
      assert.match(sortSrc, new RegExp(mode));
    }
    const handler = queryKeysReadInConsignmentsHandler();
    assert.equal(handler.has("sort"), true);
    const catalog = new Set(consignmentsListQueryKeys());
    assert.equal(catalog.has("sort"), true);
  });

  it("FilterCombobox commits typed input to onChange (not only option click)", () => {
    const combo = read("components/marketplace/filter-combobox.tsx");
    assert.match(combo, /const next = e\.target\.value/);
    assert.match(combo, /onChange\(next\)/);
    assert.doesNotMatch(
      combo,
      /if\s*\(\s*!e\.target\.value\s*\)\s*onChange\(/,
    );

    const bar = read("components/marketplace/market-filter-bar.tsx");
    assert.match(bar, /debouncedMake/);
    assert.match(bar, /patchFilters\(\{\s*make: debouncedMake/);
    assert.match(bar, /<FilterCombobox/);

    const drawer = read("components/marketplace/market-filter-drawer.tsx");
    assert.match(drawer, /<FilterCombobox/);
    assert.match(drawer, /onChange=\{\(make\) => patchDraft\(\{\s*make/);
  });

  it("filter chrome does not pin dead FacetsResponse as desired state", () => {
    for (const rel of FILTER_CHROME) {
      assert.equal(fs.existsSync(path.join(ROOT, rel)), true, `missing ${rel}`);
      const src = read(rel);
      assert.doesNotMatch(src, /FacetsResponse/);
      assert.doesNotMatch(src, /facets\s*=\s*null/);
      assert.doesNotMatch(src, /usdFacetRangeToCrypto/);
    }
    assert.doesNotMatch(read("lib/types/ponder.ts"), /export type FacetsResponse/);
  });

  it("browse price SQL consumes Asking USDC facts (not a forked Asset NULL)", () => {
    const browse = read("src/lib/ponder-consignment-browse.ts");
    assert.match(browse, /askingUsdcFacts/);
    assert.match(browse, /from ["'].*listing-price-display["']/);
    assert.doesNotMatch(
      browse,
      /WHEN \$\{consignment\.denominationKind\} = \$\{DENOMINATION_KIND\.Asset\} THEN NULL\n\s*WHEN \$\{consignment\.price\}/,
    );

    const facts = askingUsdcFacts();
    const committed = Object.values(COMMERCIAL_ACTIVE)
      .filter((s) => s.vm === "evm")
      .map((s) => s.usdc.toLowerCase());
    assert.deepEqual(
      facts.map((f) => f.address.toLowerCase()).sort(),
      [...committed].sort(),
    );
    for (const fact of facts) {
      assert.doesNotMatch(
        browse,
        new RegExp(fact.address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `SQL module must not paste USDC ${fact.address}; consume askingUsdcFacts`,
      );
    }
  });
});
