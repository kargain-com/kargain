/**
 * Ban hand-rolled base58 alphabet / encode loops outside the pubkey owner.
 * Wallet Standard signatures convert only via kit in svm-write-adapter.
 * Scan roots: app | components | hooks | lib | adapters (plan Unit A).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, it } from "node:test";

import {
  POLICY_SCAN_ROOT,
  PRODUCT_GRAPH_SCAN_ROOTS,
  walkTsFilesFromRoots,
} from "./policy-scan-helpers.ts";

const ALLOWLIST = new Set(["lib/web3/protocol-address.ts"]);

/** Bitcoin / Solana base58 alphabet (no 0/O/I/l) — product must not re-declare it. */
const BASE58_ALPHABET_LITERAL =
  /["']123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz["']/;

/**
 * Hand-written encode sizing / carry loop (the Irys fractional-size class).
 * Kit `getBase58Decoder` / pubkey owner are outside this pattern by construction.
 */
const HAND_ROLLED_ENCODE_SIZE =
  /\(\s*\(?\s*bytes\.length\s*(?:-\s*\w+)?\s*\)?\s*\*\s*138\s*\)\s*\/\s*100/;

const HAND_ROLLED_CARRY_MOD58 =
  /carry\s*%\s*58|%\s*58n?\b[\s\S]{0,80}BASE58|BASE58[\s\S]{0,80}%\s*58/;

function base58HandrollViolation(
  relPath: string,
  source: string,
): string | false {
  if (ALLOWLIST.has(relPath)) return false;
  if (BASE58_ALPHABET_LITERAL.test(source)) {
    return "base58 alphabet literal outside protocol-address pubkey owner";
  }
  if (HAND_ROLLED_ENCODE_SIZE.test(source)) {
    return "hand-rolled base58 encode size formula (138/100 class)";
  }
  if (HAND_ROLLED_CARRY_MOD58.test(source)) {
    return "hand-rolled base58 encode carry/%58 loop outside allowlist";
  }
  return false;
}

function scanGraphForHandroll(): {
  filesRead: number;
  violations: { path: string; reason: string }[];
} {
  const violations: { path: string; reason: string }[] = [];
  let filesRead = 0;
  for (const file of walkTsFilesFromRoots(PRODUCT_GRAPH_SCAN_ROOTS)) {
    const rel = relative(POLICY_SCAN_ROOT, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    filesRead += 1;
    const reason = base58HandrollViolation(rel, source);
    if (reason) violations.push({ path: rel, reason });
  }
  return { filesRead, violations };
}

describe("base58 hand-roll policy", () => {
  it("product+adapters have no alphabet literal or encode loop outside protocol-address", () => {
    const scan = scanGraphForHandroll();
    assert.ok(scan.filesRead > 0);
    assert.deepEqual(
      scan.violations,
      [],
      scan.violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("in-memory plant with alphabet literal is red; allowlisted path is green", () => {
    const planted =
      'const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";\n';
    assert.equal(
      base58HandrollViolation("adapters/irys-solana/to-irys-provider.ts", planted),
      "base58 alphabet literal outside protocol-address pubkey owner",
    );
    assert.equal(
      base58HandrollViolation("lib/web3/protocol-address.ts", planted),
      false,
    );
  });

  it("in-memory plant with fractional 138/100 size formula is red", () => {
    const planted =
      "const size = ((bytes.length - zeros) * 138) / 100 + 1;\n";
    assert.equal(
      base58HandrollViolation("adapters/irys-solana/plant.ts", planted),
      "hand-rolled base58 encode size formula (138/100 class)",
    );
  });

  it("protocol-address remains the sole allowlisted alphabet home (pubkey encode/decode)", () => {
    assert.deepEqual([...ALLOWLIST], ["lib/web3/protocol-address.ts"]);
  });
});
