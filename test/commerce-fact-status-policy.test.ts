/**
 * S8-D1b — AST policy:
 * (1) SVM arm of resolvePassportCommerceFacts must not assign boolean
 *     literals to tri-state commerce fact fields.
 * (2) Product consumers must not compare commerce fact fields to boolean /
 *     undefined literals (=== false, !== false, === true, === undefined).
 *
 * Plants in memory through the same helpers — quoted red, then green.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const COMMERCE_FACTS_REL = "lib/passport/passport-commerce-facts.ts";

/** Fields that must be CommerceFact — never a bare boolean assignment on SVM. */
const TRI_STATE_FIELDS = [
  "hasLiveConsignment",
  "liveConsignmentMode",
  "challengeOpen",
  "encumbranceRegistry",
] as const;

/**
 * Extract the SVM arm body of resolvePassportCommerceFacts
 * (`if (args.plan.vm === "svm") { ... }`).
 */
export function extractSvmResolveArm(source: string): string | null {
  const marker = /if\s*\(\s*args\.plan\.vm\s*===\s*["']svm["']\s*\)\s*\{/;
  const match = marker.exec(source);
  if (!match || match.index == null) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const c = source[i]!;
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    i += 1;
  }
  if (depth !== 0) return null;
  return source.slice(start, i - 1);
}

/**
 * Literal boolean assigned to a commerce-fact field inside the SVM arm.
 * Catches `hasLiveConsignment: false` and `live: false` style invent.
 */
export function findSvmArmBooleanLiteralAssignments(arm: string): string[] {
  const violations: string[] = [];
  // Bare field: false|true on known tri-state or mode live/mandate invent.
  const re =
    /\b(hasLiveConsignment|liveConsignmentMode|challengeOpen|live|mandate|unresolved)\s*:\s*(true|false)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(arm)) != null) {
    violations.push(
      `SVM resolve arm assigns boolean literal to commerce fact field (${m[1]}: ${m[2]})`,
    );
  }
  return violations;
}

const COMMERCE_FACT_IMPORT =
  /from\s+["']@\/lib\/passport\/(?:passport-commerce-facts|commerce-fact|sell-surface|bridge-surface|passport-commerce-rail|encumbrance-registry|encumbrance-permission)["']/;

/**
 * Consumer comparing a commerce fact (or `.live` / `.mandate` / hasLive…) to a
 * boolean / undefined literal. Only files that import commerce-fact owners —
 * never Ponder row.hasLiveConsignment (different subject).
 */
export function findCommerceFactBooleanCompares(source: string): string[] {
  if (!COMMERCE_FACT_IMPORT.test(source)) return [];
  const violations: string[] = [];
  const compareRe =
    /\b(hasLiveConsignment|liveConsignmentMode|challengeOpen|encumbranceRegistry|(?:fixedPrice|ascending)\.live|(?:fixedPrice|ascending)\.mandate)\s*(?:===|!==)\s*(true|false|undefined)\b/g;
  let m: RegExpExecArray | null;
  while ((m = compareRe.exec(source)) != null) {
    violations.push(
      `commerce fact compared to boolean/undefined literal (${m[0]})`,
    );
  }
  const looseRe =
    /\b(?:facts\.)?(hasLiveConsignment|liveConsignmentMode|challengeOpen)\s*(?:===|!==)\s*(true|false|undefined)\b/g;
  while ((m = looseRe.exec(source)) != null) {
    const msg = `commerce fact compared to boolean/undefined literal (${m[0]})`;
    if (!violations.includes(msg)) violations.push(msg);
  }
  return violations;
}

/**
 * Extract the body of `function resolveSvmCommerceFacts(...) { ... }`.
 * Planning (`svmPlanningFacts`) may pending supported reads — out of scope.
 * Signature may span lines with nested generics — do not use `[^)]*`.
 */
export function extractResolveSvmCommerceFactsFn(source: string): string | null {
  const marker = /function\s+resolveSvmCommerceFacts\b/;
  const match = marker.exec(source);
  if (!match || match.index == null) return null;
  let i = match.index + match[0].length;
  while (i < source.length && /\s/.test(source[i]!)) i += 1;
  if (source[i] !== "(") return null;
  // Skip parameter list (balanced parens).
  let depth = 0;
  for (; i < source.length; i++) {
    const c = source[i]!;
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  while (i < source.length && source[i] !== "{") i += 1;
  if (source[i] !== "{") return null;
  const start = i + 1;
  depth = 1;
  i = start;
  while (i < source.length && depth > 0) {
    const c = source[i]!;
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    i += 1;
  }
  if (depth !== 0) return null;
  return source.slice(start, i - 1);
}

/**
 * Literal `commerceFactPending()` assigned as a field of the object returned by
 * resolveSvmCommerceFacts — eternal wait invent instead of keyed-entry resolve.
 */
export function findResolveSvmPendingLiterals(fnBody: string): string[] {
  const violations: string[] = [];
  const re =
    /\b(hasLiveConsignment|liveConsignmentMode|challengeOpen|encumbranceRegistry|live|mandate)\s*:\s*commerceFactPending\s*\(\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fnBody)) != null) {
    violations.push(
      `resolveSvmCommerceFacts returns literal commerceFactPending() for field ${m[1]}`,
    );
  }
  return violations;
}

function svmArmBooleanPredicate(rel: string, source: string): string | false {
  if (rel !== COMMERCE_FACTS_REL) return false;
  const arm = extractSvmResolveArm(source);
  if (arm == null) {
    return `could not extract SVM resolve arm (${rel})`;
  }
  const hits = findSvmArmBooleanLiteralAssignments(arm);
  return hits[0] ?? false;
}

function resolveSvmPendingPredicate(
  rel: string,
  source: string,
): string | false {
  if (rel !== COMMERCE_FACTS_REL) return false;
  const fn = extractResolveSvmCommerceFactsFn(source);
  if (fn == null) {
    return `could not extract resolveSvmCommerceFacts (${rel})`;
  }
  const hits = findResolveSvmPendingLiterals(fn);
  return hits[0] ?? false;
}

function consumerComparePredicate(rel: string, source: string): string | false {
  // Producer may mention false in comments / EVM arm — only scan consumers.
  if (rel === COMMERCE_FACTS_REL) return false;
  if (rel.startsWith("test/")) return false;
  const hits = findCommerceFactBooleanCompares(source);
  if (hits.length === 0) return false;
  return `${hits[0]} (${rel})`;
}

describe("commerce-fact status policy (S8-D1b)", () => {
  it("SVM resolve arm has no boolean literal on commerce fact fields", () => {
    const src = readFileSync(
      join(process.cwd(), COMMERCE_FACTS_REL),
      "utf8",
    );
    const arm = extractSvmResolveArm(src);
    assert.ok(arm, "SVM resolve arm must exist");
    assert.deepEqual(
      findSvmArmBooleanLiteralAssignments(arm!),
      [],
      "SVM arm must not invent boolean literals for tri-state fields",
    );
  });

  it("resolveSvmCommerceFacts has no literal commerceFactPending() field", () => {
    const src = readFileSync(
      join(process.cwd(), COMMERCE_FACTS_REL),
      "utf8",
    );
    const fn = extractResolveSvmCommerceFactsFn(src);
    assert.ok(fn, "resolveSvmCommerceFacts must exist");
    assert.deepEqual(
      findResolveSvmPendingLiterals(fn!),
      [],
      "resolveSvmCommerceFacts must not return literal commerceFactPending() fields",
    );
  });

  it("product consumers do not compare commerce facts to boolean literals", () => {
    const scan = scanProductSources(consumerComparePredicate);
    assertCleanProductScan(scan);
  });

  it("planted hasLiveConsignment: false in SVM arm turns red", () => {
    const cleanArm = `
    return resolveSvmCommerceFacts({
      plan: args.plan,
      entry: args.entry,
      isPending: args.isPending,
      registry: args.registry,
    });
`;
    const plantedArm = `
    return {
      fixedPrice: unreadModeFacts(false),
      ascending: unreadModeFacts(false),
      hasLiveConsignment: false,
      liveConsignmentMode: null,
      challengeOpen: undefined,
    };
`;
    assert.deepEqual(
      findSvmArmBooleanLiteralAssignments(cleanArm),
      [],
      "clean twin must be green",
    );
    const planted = findSvmArmBooleanLiteralAssignments(plantedArm);
    assert.ok(planted.length > 0, "planted hasLiveConsignment: false must turn red");
    assert.match(
      planted[0]!,
      /SVM resolve arm assigns boolean literal to commerce fact field \(hasLiveConsignment: false\)/,
    );
  });

  it("planted challengeOpen: commerceFactPending() in resolveSvmCommerceFacts turns red", () => {
    const cleanFn = `
  return {
    fixedPrice,
    ascending,
    challengeOpen: challengeOpenFromEntry(args.entry(CHALLENGE_ACCOUNT_KEY), {
      batchPending,
    }),
    hasLiveConsignment: combined.hasLiveConsignment,
  };
`;
    const plantedFn = `
  return {
    fixedPrice,
    ascending,
    challengeOpen: commerceFactPending(),
    hasLiveConsignment: combined.hasLiveConsignment,
  };
`;
    assert.deepEqual(
      findResolveSvmPendingLiterals(cleanFn),
      [],
      "clean twin must be green",
    );
    const planted = findResolveSvmPendingLiterals(plantedFn);
    assert.ok(
      planted.length > 0,
      "planted challengeOpen: commerceFactPending() must turn red",
    );
    assert.match(
      planted[0]!,
      /resolveSvmCommerceFacts returns literal commerceFactPending\(\) for field challengeOpen/,
    );
  });

  it("planted facts.hasLiveConsignment === false turns red", () => {
    const clean = `
import type { PassportCommerceFacts } from "@/lib/passport/passport-commerce-facts";
export function canOpen(facts: PassportCommerceFacts) {
  return facts.hasLiveConsignment.status === "known" && !facts.hasLiveConsignment.value;
}
`;
    const planted = `
import type { PassportCommerceFacts } from "@/lib/passport/passport-commerce-facts";
export function canOpen(facts: PassportCommerceFacts) {
  return facts.hasLiveConsignment === false;
}
`;
    assert.deepEqual(
      findCommerceFactBooleanCompares(clean),
      [],
      "clean twin must be green",
    );
    const hits = findCommerceFactBooleanCompares(planted);
    assert.ok(hits.length > 0, "planted === false must turn red");
    assert.match(
      hits[0]!,
      /commerce fact compared to boolean\/undefined literal \(hasLiveConsignment === false\)/,
    );
  });

  it("live product scan via shared helpers stays clean", () => {
    const scanBool = scanProductSources(svmArmBooleanPredicate);
    assertCleanProductScan(scanBool);
    const scanPending = scanProductSources(resolveSvmPendingPredicate);
    assertCleanProductScan(scanPending);
  });
});

void TRI_STATE_FIELDS;
