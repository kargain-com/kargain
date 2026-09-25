/**
 * Commerce mode resolution — presence is namespace-keyed, never hex-undefined.
 *
 * Pins: Solana registry modes are configured; genuine absence is named;
 * app|components|hooks never call commerceModeAddress(; EVM hex identity
 * equals resolveCommerceMode address; auction island consumes the owner.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  commerceModeAbsentCopy,
  commerceModeAddress,
  hasCommerceMode,
  resolveCommerceMode,
} from "@/lib/commerce/mode";
import {
  COMMERCIAL_ACTIVE,
  type CommercialRegistry,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOLANA_NS = 2_000_040_168;

const HEX_CALL = /\bcommerceModeAddress\s*\(/;

describe("commerce mode resolution policy", () => {
  it("Solana commercial row: both modes configured with ProtocolOwner program ids", () => {
    const fp = resolveCommerceMode("fixedPrice", SOLANA_NS);
    const asc = resolveCommerceMode("ascending", SOLANA_NS);
    assert.equal(fp.status, "configured");
    assert.equal(asc.status, "configured");
    if (fp.status !== "configured" || asc.status !== "configured") return;
    assert.equal(
      fp.address,
      COMMERCIAL_ACTIVE[SOLANA_NS]!.fixedPriceConsignment,
    );
    assert.equal(
      asc.address,
      COMMERCIAL_ACTIVE[SOLANA_NS]!.ascendingConsignment,
    );
    assert.equal(hasCommerceMode("ascending", SOLANA_NS), true);
    assert.equal(
      commerceModeAddress("ascending", SOLANA_NS),
      undefined,
      "hex accessor must stay undefined on SVM",
    );
  });

  it("genuine absence: commercial stack without mode fields → absent + non-empty copy", () => {
    const bare: SvmCommercialActiveStack = {
      ...FIXTURE_SVM_STACK,
      fixedPriceConsignment: undefined,
      ascendingConsignment: undefined,
    };
    const ns = Number(bare.namespace);
    const registry: CommercialRegistry = {
      ...COMMERCIAL_ACTIVE,
      [ns]: bare,
    };
    const asc = resolveCommerceMode("ascending", ns, registry);
    assert.equal(asc.status, "absent");
    if (asc.status !== "absent") return;
    assert.equal(asc.cause, "mode_not_on_namespace");
    const copy = commerceModeAbsentCopy(asc.cause);
    assert.ok(copy.length > 0);
    assert.match(copy, /not available/i);
    assert.equal(hasCommerceMode("ascending", ns, registry), false);
  });

  it("constructed: treating a configured Solana mode as hex-absent is red", () => {
    const asc = resolveCommerceMode("ascending", SOLANA_NS);
    assert.equal(asc.status, "configured");
    const hexUndefined = commerceModeAddress("ascending", SOLANA_NS) == null;
    assert.equal(hexUndefined, true, "hex is undefined on SVM by design");
    // Presence must not follow the hex lie:
    assert.equal(
      hasCommerceMode("ascending", SOLANA_NS),
      true,
      "hasCommerceMode must not inherit hex undefined",
    );
    assert.notEqual(
      hasCommerceMode("ascending", SOLANA_NS),
      !hexUndefined,
      "configured presence ≠ hex presence on SVM",
    );
  });

  it("EVM identity: resolve address equals commerceModeAddress checksum on hub and spoke", () => {
    for (const chainId of [84532, 11155111] as const) {
      for (const mode of ["fixedPrice", "ascending"] as const) {
        const resolved = resolveCommerceMode(mode, chainId);
        const hex = commerceModeAddress(mode, chainId);
        assert.equal(resolved.status, "configured");
        assert.ok(hex, `hex required on ${chainId} ${mode}`);
        if (resolved.status !== "configured") continue;
        assert.equal(resolved.address, hex);
      }
    }
  });

  it("app|components|hooks never call commerceModeAddress(", () => {
    const scan = scanProductSources((rel, source) => {
      if (
        !rel.startsWith("app/") &&
        !rel.startsWith("components/") &&
        !rel.startsWith("hooks/")
      ) {
        return false;
      }
      if (!HEX_CALL.test(source)) return false;
      return "commerceModeAddress( is banned in surfaces — use resolveCommerceMode / commerceModeEvmAddress";
    });
    assertCleanProductScan(scan);
  });

  it("constructed: commerceModeAddress( detector reddens planted surface source", () => {
    const clean = "const x = resolveCommerceMode(\"ascending\", chainId);\n";
    const dirty = `${clean}const mode = commerceModeAddress("ascending", chainId);\n`;
    assert.equal(HEX_CALL.test(clean), false);
    assert.equal(HEX_CALL.test(dirty), true);
  });

  it("auction island consumes resolveCommerceMode; absent renders copy, not hex null", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "components/auction/auction-detail-client-island.tsx"),
      "utf8",
    );
    assert.match(src, /resolveCommerceMode\s*\(\s*["']ascending["']/);
    assert.match(src, /commerceModeAbsentCopy/);
    assert.doesNotMatch(src, /\bcommerceModeAddress\s*\(/);
    assert.doesNotMatch(
      src,
      /if\s*\(\s*!mode\s*\)\s*return\s+null/,
      "must not gate presence on hex mode variable",
    );
    assert.match(
      src,
      /ascendingMode\.status\s*===\s*["']absent["']/,
    );
  });

  it("listing island ascending hint uses hasCommerceMode (registry, not hex)", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "components/marketplace/listing-detail-client-island.tsx"),
      "utf8",
    );
    assert.match(src, /hasCommerceMode\s*\(\s*["']ascending["']/);
    assert.doesNotMatch(src, /\bcommerceModeAddress\s*\(/);
    assert.equal(hasCommerceMode("ascending", SOLANA_NS), true);
  });
});
