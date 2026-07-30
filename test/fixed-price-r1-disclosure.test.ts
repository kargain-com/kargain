import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { FIXED_PRICE_R1_DISCLOSURE } from "../lib/marketplace/fixed-price-r1-disclosure.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUY_PANEL = path.join(
  ROOT,
  "components/marketplace/listing-buy-panel.tsx",
);

describe("fixed-price R1 disclosure", () => {
  it("names no protection window, no escrow reversal, and no on-chain dispute", () => {
    assert.match(FIXED_PRICE_R1_DISCLOSURE, /no protection window/i);
    assert.match(FIXED_PRICE_R1_DISCLOSURE, /no escrow-backed reversal/i);
    assert.match(FIXED_PRICE_R1_DISCLOSURE, /no on-chain dispute/i);
    assert.match(
      FIXED_PRICE_R1_DISCLOSURE,
      /moves the passport and the payment and nothing more/i,
    );
  });

  it("buy panel imports and renders the canonical disclosure before commit", () => {
    const text = fs.readFileSync(BUY_PANEL, "utf8");
    assert.match(
      text,
      /FIXED_PRICE_R1_DISCLOSURE/,
      "listing-buy-panel must render FIXED_PRICE_R1_DISCLOSURE",
    );
    assert.match(
      text,
      /from\s+["']@\/lib\/marketplace\/fixed-price-r1-disclosure["']/,
    );
  });
});
