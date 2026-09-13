/**
 * Ban `COMMERCIAL_ACTIVE[<numeric literal>]` under app|components|hooks.
 * Hub invent must not bypass commercialActive(chainId) / parent-injected unit.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

/** Bracket-index of COMMERCIAL_ACTIVE with a numeric literal (hub invent). */
const HUB_LITERAL =
  /COMMERCIAL_ACTIVE\s*\[\s*\d+\s*\]/;

function hubLiteralPredicate(rel: string, source: string): string | false {
  // Policy scope: app / components / hooks only (not lib registry owners).
  if (
    !rel.startsWith("app/") &&
    !rel.startsWith("components/") &&
    !rel.startsWith("hooks/")
  ) {
    return false;
  }
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  if (!HUB_LITERAL.test(stripped)) return false;
  return `COMMERCIAL_ACTIVE[literal] hub invent (${rel})`;
}

describe("commercial-active hub literal policy", () => {
  it("bans COMMERCIAL_ACTIVE[<number>] under app|components|hooks", () => {
    const scan = scanProductSources(hubLiteralPredicate);
    assertCleanProductScan(scan);
  });

  it("catches planted COMMERCIAL_ACTIVE[84532] in a component path (red→green)", () => {
    const dirty = `import { COMMERCIAL_ACTIVE, nativeUnitOf } from "@/lib/web3/commercial-active";
const unit = nativeUnitOf(COMMERCIAL_ACTIVE[84532]!);
`;
    assert.equal(
      hubLiteralPredicate("components/planted.tsx", dirty),
      "COMMERCIAL_ACTIVE[literal] hub invent (components/planted.tsx)",
    );
    const clean = `import { commercialActive, nativeUnitOf } from "@/lib/web3/commercial-active";
const stack = commercialActive(chainId);
`;
    assert.equal(hubLiteralPredicate("components/planted.tsx", clean), false);
    assert.equal(
      hubLiteralPredicate("lib/web3/commercial-active.ts", dirty),
      false,
    );
  });
});
