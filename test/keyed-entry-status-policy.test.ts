/**
 * S8-D1a — KeyedEntry status is success | pending | refused(cause).
 * Ban Error.message sniffing on keyed-read errors; require pending handling.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const MESSAGE_SNIFF =
  /\.message\s*\.\s*(?:includes|startsWith)\s*\(/;

const IMPORTS_KEYED =
  /from\s+["']@\/lib\/web3\/keyed-multicall["']|from\s+["']\.\.\/lib\/web3\/keyed-multicall/;

/** Owner may compare status; sniffing lives nowhere. */
function messageSniffPredicate(rel: string, source: string): string | false {
  if (!IMPORTS_KEYED.test(source)) return false;
  if (!MESSAGE_SNIFF.test(source)) return false;
  return `KeyedEntry consumer sniffs error.message (${rel})`;
}

/**
 * If a KeyedEntry importer branches on "success" and "refused", it must also
 * name "pending" (wait ≠ refusal).
 */
function missingPendingPredicate(rel: string, source: string): string | false {
  if (!IMPORTS_KEYED.test(source)) return false;
  // Pure type re-exports / maps that never switch on status.
  if (
    !/status\s*===\s*["']success["']|case\s+["']success["']/.test(source)
  ) {
    return false;
  }
  const hasRefused =
    /status\s*===\s*["']refused["']|case\s+["']refused["']/.test(source);
  const hasFailure =
    /status\s*===\s*["']failure["']|case\s+["']failure["']/.test(source);
  if (!hasRefused && !hasFailure) return false;
  if (/status\s*===\s*["']pending["']|case\s+["']pending["']/.test(source)) {
    return false;
  }
  // get()/as* helpers only check success — not a full switch consumer.
  if (
    !hasRefused &&
    !hasFailure &&
    /e\?\.status\s*===\s*["']success["']/.test(source)
  ) {
    return false;
  }
  return `KeyedEntry consumer handles success/refused without pending (${rel})`;
}

function findMessageSniffViolations(source: string): boolean {
  return IMPORTS_KEYED.test(source) && MESSAGE_SNIFF.test(source);
}

function findMissingPendingViolations(source: string): boolean {
  return missingPendingPredicate("plant", source) !== false;
}

describe("keyed-entry status policy (S8-D1a)", () => {
  it("no KeyedEntry consumer sniffs error.message.includes / startsWith", () => {
    const scan = scanProductSources(messageSniffPredicate);
    assertCleanProductScan(scan);
  });

  it("KeyedEntry status consumers that handle refused also handle pending", () => {
    const scan = scanProductSources(missingPendingPredicate);
    assertCleanProductScan(scan);
  });

  it("planted message.includes on KeyedEntry error turns red", () => {
    const clean = `
import type { KeyedEntry } from "@/lib/web3/keyed-multicall";
export function read(entry: KeyedEntry) {
  if (entry.status === "pending") return "wait";
  if (entry.status === "refused") return entry.cause;
  return "ok";
}
`;
    const planted = `
import type { KeyedEntry } from "@/lib/web3/keyed-multicall";
export function read(entry: KeyedEntry) {
  if (entry.status === "refused" && entry.error?.message.includes("account_not_found")) {
    return "missing";
  }
  return "other";
}
`;
    assert.equal(
      findMessageSniffViolations(clean),
      false,
      "clean twin must not sniff",
    );
    assert.equal(
      findMessageSniffViolations(planted),
      true,
      'planted .message.includes("account_not_found") must turn red',
    );
  });

  it("planted switch missing pending turns red", () => {
    const clean = `
import type { KeyedEntry } from "@/lib/web3/keyed-multicall";
export function read(entry: KeyedEntry) {
  switch (entry.status) {
    case "pending":
      return "wait";
    case "refused":
      return entry.cause;
    case "success":
      return "ok";
  }
}
`;
    const planted = `
import type { KeyedEntry } from "@/lib/web3/keyed-multicall";
export function read(entry: KeyedEntry) {
  switch (entry.status) {
    case "refused":
      return entry.cause;
    case "success":
      return "ok";
  }
}
`;
    assert.equal(
      findMissingPendingViolations(clean),
      false,
      "clean twin handles pending",
    );
    assert.equal(
      findMissingPendingViolations(planted),
      true,
      "planted switch without pending must turn red",
    );
  });
});
