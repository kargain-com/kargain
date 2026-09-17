/**
 * Ban hub invent under app|components|hooks:
 * - `COMMERCIAL_ACTIVE[<numeric literal>]`
 * - `(??|||) <commercialNamespaceId>` fallbacks (registry-derived)
 * - `indexerQueryKey` / `openableTermsQueryKey` namespace invent via `?? 0` / `|| 0`
 *
 * Pagination `?? 1` and other non-commercial defaults are not this class.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registeredCommercialNamespaceIds } from "../lib/web3/commercial-active.ts";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

function inProductScope(rel: string): boolean {
  return (
    rel.startsWith("app/") ||
    rel.startsWith("components/") ||
    rel.startsWith("hooks/")
  );
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Bracket-index of COMMERCIAL_ACTIVE with a numeric literal (hub invent). */
const HUB_LITERAL = /COMMERCIAL_ACTIVE\s*\[\s*\d+\s*\]/;

function hubLiteralPredicate(rel: string, source: string): string | false {
  if (!inProductScope(rel)) return false;
  const stripped = stripComments(source);
  if (!HUB_LITERAL.test(stripped)) return false;
  return `COMMERCIAL_ACTIVE[literal] hub invent (${rel})`;
}

function commercialFallbackRegex(): RegExp {
  const ids = registeredCommercialNamespaceIds();
  assert.ok(
    ids.length > 0,
    "commercial registry must expose at least one namespace for the fallback ban",
  );
  const alt = ids.map((id) => String(id)).join("|");
  return new RegExp(`(?:\\?\\?|\\|\\|)\\s*(?:${alt})\\b`);
}

function commercialFallbackPredicate(
  rel: string,
  source: string,
): string | false {
  if (!inProductScope(rel)) return false;
  const stripped = stripComments(source);
  if (!commercialFallbackRegex().test(stripped)) return false;
  return `commercial chain id ??/|| invent (${rel})`;
}

/** Key builders inventing namespace 0 when chain is absent. */
const KEY_ZERO_INVENT =
  /(?:indexerQueryKey\s*\(\s*(?:'[^']*'|"[^"]*")\s*,\s*[^,;)]*(?:\?\?|\|\|)\s*0\b|openableTermsQueryKey\s*\(\s*[^,;)]*(?:\?\?|\|\|)\s*0\b)/;

function keyZeroInventPredicate(rel: string, source: string): string | false {
  if (!inProductScope(rel)) return false;
  const stripped = stripComments(source);
  if (!KEY_ZERO_INVENT.test(stripped)) return false;
  return `query-key namespace ??/|| 0 invent (${rel})`;
}

function anyHubInventPredicate(rel: string, source: string): string | false {
  return (
    hubLiteralPredicate(rel, source) ||
    commercialFallbackPredicate(rel, source) ||
    keyZeroInventPredicate(rel, source)
  );
}

describe("commercial-active hub literal policy", () => {
  it("bans COMMERCIAL_ACTIVE[<number>] under app|components|hooks", () => {
    const scan = scanProductSources(hubLiteralPredicate);
    assertCleanProductScan(scan);
  });

  it("bans commercial ??/|| fallbacks under app|components|hooks (registry-derived)", () => {
    const scan = scanProductSources(commercialFallbackPredicate);
    assertCleanProductScan(scan);
  });

  it("bans indexerQueryKey/openableTermsQueryKey namespace ??/|| 0 invent", () => {
    const scan = scanProductSources(keyZeroInventPredicate);
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

  it("planted ?? 84532 turns red; live tree green", () => {
    const ids = registeredCommercialNamespaceIds();
    assert.ok(ids.includes(84532), "hub 84532 must be commercial for this plant");
    const dirty = `const sync = chainId ?? 84532;\n`;
    assert.equal(
      commercialFallbackPredicate("components/planted.tsx", dirty),
      "commercial chain id ??/|| invent (components/planted.tsx)",
      "planted ?? 84532 must turn the commercial-fallback ban red",
    );
    assert.equal(
      anyHubInventPredicate("components/planted.tsx", "const page = page ?? 1;\n"),
      false,
      "pagination ?? 1 must stay green — not a commercial invent",
    );
  });

  it("planted || 11155111 turns red", () => {
    const ids = registeredCommercialNamespaceIds();
    assert.ok(
      ids.includes(11155111),
      "spoke 11155111 must be commercial for this plant",
    );
    const dirty = `const sync = chainId || 11155111;\n`;
    assert.equal(
      commercialFallbackPredicate("hooks/planted.ts", dirty),
      "commercial chain id ??/|| invent (hooks/planted.ts)",
      "planted || 11155111 must turn the commercial-fallback ban red",
    );
  });

  it("planted indexerQueryKey namespace ?? 0 turns red; sentinel green", () => {
    const dirty =
      'const key = indexerQueryKey("kar-pro-slug", chainId ?? 0, uri);\n';
    assert.equal(
      keyZeroInventPredicate("hooks/planted.ts", dirty),
      "query-key namespace ??/|| 0 invent (hooks/planted.ts)",
      "planted indexerQueryKey ?? 0 must turn the key-zero ban red",
    );
    const clean =
      'const key = indexerQueryKey("kar-pro-slug", chainId ?? "unresolved", uri);\n';
    assert.equal(keyZeroInventPredicate("hooks/planted.ts", clean), false);
  });
});
