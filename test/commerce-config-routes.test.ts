/**
 * Commerce config HTTP surface — projections with writers must have readers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = path.join(ROOT, "src/api/commerce-routes.ts");

describe("commerce config HTTP readers", () => {
  it("registers GET routes for mode / payment-token / currency-feed projections", () => {
    const src = readFileSync(ROUTES, "utf8");
    for (const route of [
      '"/commerce-modes"',
      '"/commerce-payment-tokens"',
      '"/commerce-currency-feeds"',
    ]) {
      assert.ok(
        src.includes(`app.get(${route}`),
        `missing app.get(${route}) in commerce-routes.ts`,
      );
    }
    assert.ok(src.includes("commerceMode"));
    assert.ok(src.includes("commercePaymentToken"));
    assert.ok(src.includes("commerceCurrencyFeed"));
  });
});
