/**
 * Sole owner: lib/svm/commercial-abi-events.ts — six-contract ABI enumeration.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = path.join(ROOT, "lib/svm/commercial-abi-events.ts");
const TEST_DIR = path.join(ROOT, "test");

const COMMERCIAL_ABI_SYMBOLS = [
  "AscendingConsignmentAbi",
  "FixedPriceConsignmentAbi",
  "KarPassportAbi",
  "KarPassportBridgeGatewayAbi",
  "KarProPassAbi",
  "KarProStakingAbi",
] as const;

function listTestTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTestTsFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function countCommercialAbiImports(source: string): number {
  let n = 0;
  for (const sym of COMMERCIAL_ABI_SYMBOLS) {
    if (new RegExp(`\\b${sym}\\b`).test(source)) n++;
  }
  return n;
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
  });

  it("no test file imports all six commercial ABIs (enumeration dual path ban)", () => {
    const violations: string[] = [];
    for (const file of listTestTsFiles(TEST_DIR)) {
      if (path.basename(file) === "commercial-abi-events-policy.test.ts") continue;
      const text = fs.readFileSync(file, "utf8");
      if (countCommercialAbiImports(text) >= COMMERCIAL_ABI_SYMBOLS.length) {
        violations.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(violations, []);
  });
});
