/**
 * Settlement-note writer permanence — named scenarios.
 *
 * Defect: the product stores payment identifiers permanently on a public chain
 * and said nothing about permanence at the write surface (buyer trust line only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { SETTLEMENT_NOTE_WRITE_DISCLOSURE } from "../lib/marketplace/settlement-note.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELLER_PANEL = path.join(
  ROOT,
  "components/marketplace/listing-seller-settlement-panel.tsx",
);
const AGENT_OPEN = path.join(
  ROOT,
  "components/marketplace/agent-list-on-behalf-panel.tsx",
);

describe("settlement note write disclosure", () => {
  it("names permanence, public chain, buyer visibility, and unverified", () => {
    assert.match(SETTLEMENT_NOTE_WRITE_DISCLOSURE, /permanently/i);
    assert.match(SETTLEMENT_NOTE_WRITE_DISCLOSURE, /public chain/i);
    assert.match(SETTLEMENT_NOTE_WRITE_DISCLOSURE, /shown to buyers/i);
    assert.match(SETTLEMENT_NOTE_WRITE_DISCLOSURE, /does not verify/i);
  });

  it("seller settlement panel imports and renders the write disclosure", () => {
    const text = fs.readFileSync(SELLER_PANEL, "utf8");
    assert.match(
      text,
      /SETTLEMENT_NOTE_WRITE_DISCLOSURE/,
      "listing-seller-settlement-panel must render SETTLEMENT_NOTE_WRITE_DISCLOSURE",
    );
    assert.match(
      text,
      /from\s+["']@\/lib\/marketplace\/settlement-note["']/,
    );
  });

  it("agent open panel imports and renders the write disclosure", () => {
    const text = fs.readFileSync(AGENT_OPEN, "utf8");
    assert.match(
      text,
      /SETTLEMENT_NOTE_WRITE_DISCLOSURE/,
      "agent-list-on-behalf-panel must render SETTLEMENT_NOTE_WRITE_DISCLOSURE",
    );
    assert.match(
      text,
      /from\s+["']@\/lib\/marketplace\/settlement-note["']/,
    );
  });
});
