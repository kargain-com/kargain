/**
 * Sole owner of the commercial ABI *set*: lib/svm/commercial-abi-events.ts.
 * ponder.config.ts is a distinct owner of the Ponder createConfig contracts map
 * (addresses / start blocks) — not an ABI census.
 *
 * Property: assembling a collection over commercial ABIs from abis.generated
 * (contract-keyed map or array of ≥2 Abi symbols) is a violation outside named
 * owners. Importing several ABIs to use them is not enumeration.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMMERCIAL_CONTRACT_ABIS,
  COMMERCIAL_CONTRACT_NAMES,
  listCommercialAbiEvents,
} from "../lib/svm/commercial-abi-events.js";
import {
  POLICY_SCAN_ROOT,
  scanCommercialAbiEnumerationSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = path.join(ROOT, "lib/svm/commercial-abi-events.ts");

export const COMMERCIAL_ABI_ENUMERATION_OWNERS = [
  "lib/svm/commercial-abi-events.ts",
  "ponder.config.ts",
] as const;

export const COMMERCIAL_ABI_SYMBOLS = [
  "AscendingConsignmentAbi",
  "FixedPriceConsignmentAbi",
  "KarPassportAbi",
  "KarPassportBridgeGatewayAbi",
  "KarProPassAbi",
  "KarProStakingAbi",
] as const;

const CONTRACT_NAMES = [
  "KarPassport",
  "KarProStaking",
  "KarProPass",
  "FixedPriceConsignment",
  "AscendingConsignment",
  "KarPassportBridgeGateway",
] as const;

/** Strip import lines and comments so use-sites remain. */
function stripImportsAndComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

/** Top-level (non-nested) array literals in source. */
function topLevelArrayLiterals(source: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "]" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(source.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function abiSymbolsIn(text: string): string[] {
  return COMMERCIAL_ABI_SYMBOLS.filter((s) =>
    new RegExp(`\\b${s}\\b`).test(text),
  );
}

/**
 * Count commercial Abi symbols that are *direct array elements*
 * (`[FooAbi, BarAbi]` or `FooAbi as Abi`), not nested `abi: FooAbi` fields.
 */
function directAbiArrayElementCount(arrayLiteral: string): number {
  const alt = COMMERCIAL_ABI_SYMBOLS.join("|");
  const re = new RegExp(
    `(?:\\[|,)\\s*(?:${alt})\\b(?:\\s+as\\s+\\w+)?\\s*(?=,|\\])`,
    "g",
  );
  return [...arrayLiteral.matchAll(re)].length;
}

/**
 * True when source assembles a commercial-ABI collection from abis.generated
 * symbols (contract-keyed map with ≥2 entries, or array of ≥2 Abi elements).
 * Multi-ABI *use* (scattered `abi: FooAbi` call sites / read configs) is not
 * a collection.
 */
export function commercialAbiCollectionAssemblyInSource(source: string): boolean {
  const body = stripImportsAndComments(source);
  if (abiSymbolsIn(body).length < 2) return false;

  for (const arr of topLevelArrayLiterals(body)) {
    if (directAbiArrayElementCount(arr) >= 2) return true;
  }

  let keyed = 0;
  for (const name of CONTRACT_NAMES) {
    const direct = new RegExp(`\\b${name}\\s*:\\s*${name}Abi\\b`);
    const nested = new RegExp(
      `\\b${name}\\s*:\\s*\\{[\\s\\S]*?\\babi\\s*:\\s*${name}Abi\\b`,
    );
    if (direct.test(body) || nested.test(body)) keyed++;
  }
  return keyed >= 2;
}

function enumerationPredicate(rel: string, source: string): string | false {
  const norm = rel.replace(/\\/g, "/");
  if ((COMMERCIAL_ABI_ENUMERATION_OWNERS as readonly string[]).includes(norm)) {
    return false;
  }
  if (!commercialAbiCollectionAssemblyInSource(source)) return false;
  return "assembles a commercial ABI collection outside named owners";
}

describe("commercial abi events policy", () => {
  it("owner exports six commercial ABIs and lists 110 events", () => {
    assert.equal(COMMERCIAL_CONTRACT_NAMES.length, 6);
    assert.equal(Object.keys(COMMERCIAL_CONTRACT_ABIS).length, 6);
    assert.equal(listCommercialAbiEvents().length, 110);
    const text = fs.readFileSync(OWNER, "utf8");
    for (const sym of COMMERCIAL_ABI_SYMBOLS) {
      assert.ok(text.includes(sym), `owner must import ${sym}`);
    }
    assert.match(text, /COMMERCIAL_CONTRACT_ABIS = \{/);
    assert.match(text, /\} as const/);
  });

  it("named owners are exactly the commercial enumerator and ponder config map", () => {
    assert.deepEqual([...COMMERCIAL_ABI_ENUMERATION_OWNERS].sort(), [
      "lib/svm/commercial-abi-events.ts",
      "ponder.config.ts",
    ]);
  });

  it("no file outside owners assembles a commercial ABI collection", () => {
    const violations = scanCommercialAbiEnumerationSources(enumerationPredicate, {
      owners: COMMERCIAL_ABI_ENUMERATION_OWNERS,
      rootDir: POLICY_SCAN_ROOT,
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("constructed violation: parallel ABI map turns red then green", () => {
    const dirty = `
import {
  KarPassportAbi,
  FixedPriceConsignmentAbi,
} from "@/lib/contracts/abis.generated";
const PARALLEL = {
  KarPassport: KarPassportAbi,
  FixedPriceConsignment: FixedPriceConsignmentAbi,
};
void PARALLEL;
`;
    assert.equal(
      commercialAbiCollectionAssemblyInSource(dirty),
      true,
      "dirty map must be detected",
    );
    assert.equal(
      enumerationPredicate("lib/marketplace/evil.ts", dirty),
      "assembles a commercial ABI collection outside named owners",
    );

    const cleanConsumer = `
import {
  FixedPriceConsignmentAbi,
  AscendingConsignmentAbi,
} from "@/lib/contracts/abis.generated";
export function modeAbi(mode: "fixed" | "ascending") {
  return mode === "fixed" ? FixedPriceConsignmentAbi : AscendingConsignmentAbi;
}
`;
    assert.equal(
      commercialAbiCollectionAssemblyInSource(cleanConsumer),
      false,
      "multi-ABI ternary consumer must stay green",
    );
    assert.equal(enumerationPredicate("lib/commerce/mode.ts", cleanConsumer), false);
  });

  it("constructed violation: Abi array collection turns red", () => {
    const dirty = `
import { KarPassportAbi, KarProPassAbi } from "@/lib/contracts/abis.generated";
const DECODE = [KarPassportAbi, KarProPassAbi];
void DECODE;
`;
    assert.equal(commercialAbiCollectionAssemblyInSource(dirty), true);

    const readConfigs = `
import { KarProPassAbi, KarProStakingAbi } from "@/lib/contracts/abis.generated";
const contracts = [
  { abi: KarProPassAbi, functionName: "x" },
  { abi: KarProStakingAbi, functionName: "y" },
];
void contracts;
`;
    assert.equal(
      commercialAbiCollectionAssemblyInSource(readConfigs),
      false,
      "array of read configs with nested abi fields is not enumeration",
    );
  });
});
