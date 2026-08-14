/**
 * Product invariant: every marketplace filter/sort control that reaches
 * `marketFiltersToApiInput` must be a consignments.list catalog key that the
 * `/consignments` handler reads. Adding a UI control without server support fails.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { marketFiltersToApiInput, DEFAULT_MARKET_FILTERS } from "../lib/marketplace/filter-params.ts";
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

const UI_FILES = [
  "components/marketplace/market-filter-bar.tsx",
  "components/marketplace/market-filter-drawer.tsx",
  "components/marketplace/market-filter-chips.tsx",
  "components/marketplace/market-sort-select.tsx",
] as const;

function queryKeysReadInConsignmentsHandler(): Set<string> {
  const source = fs.readFileSync(
    path.join(ROOT, "src/api/commerce-routes.ts"),
    "utf8",
  );
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
        // pagination — always in catalog
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
    const sortSrc = fs.readFileSync(
      path.join(ROOT, "components/marketplace/market-sort-select.tsx"),
      "utf8",
    );
    const modes = ["newest", "price_asc", "price_desc", "mileage_asc"] as const;
    for (const mode of modes) {
      assert.match(sortSrc, new RegExp(mode));
    }
    const handler = queryKeysReadInConsignmentsHandler();
    assert.equal(handler.has("sort"), true);
    const catalog = new Set(consignmentsListQueryKeys());
    assert.equal(catalog.has("sort"), true);
  });

  it("UI filter surfaces exist (regression: do not drop chrome without server)", () => {
    for (const rel of UI_FILES) {
      assert.equal(
        fs.existsSync(path.join(ROOT, rel)),
        true,
        `missing UI surface ${rel}`,
      );
    }
  });
});
