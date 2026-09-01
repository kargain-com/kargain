/**
 * Policy: bridge_crossing stream is not consumed by HTTP routes; passport
 * handlers do not write bridge_crossing directly (S7b read surface unchanged).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const API_DIR = path.join(ROOT, "src/api");
const INDEX_TS = path.join(ROOT, "src/index.ts");
const CROSSING_OWNER = path.join(ROOT, "src/lib/ponder-bridge-crossings.ts");
const BRIDGE_HANDLERS = path.join(ROOT, "src/bridge-handlers.ts");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("ponder bridge crossing surface policy", () => {
  it("src/api does not reference bridge_crossing table", () => {
    for (const file of listTsFiles(API_DIR)) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      assert.ok(
        !src.includes("bridgeCrossing") && !src.includes("bridge_crossing"),
        `${path.relative(ROOT, file)} must not read bridge_crossing (S7b staging)`,
      );
    }
  });

  it("src/index.ts does not insert or update bridge_crossing directly", () => {
    const src = stripComments(fs.readFileSync(INDEX_TS, "utf8"));
    assert.ok(
      !src.includes(".insert(bridgeCrossing)") &&
        !src.includes(".update(bridgeCrossing"),
      "passport handlers must correlate via notePassportCounterpartForTx only",
    );
  });

  it("sole bridge_crossing writers are bridge-handlers + ponder-bridge-crossings", () => {
    const handlers = stripComments(fs.readFileSync(BRIDGE_HANDLERS, "utf8"));
    const owner = stripComments(fs.readFileSync(CROSSING_OWNER, "utf8"));
    assert.ok(handlers.includes("insertOnftSentCrossing"));
    assert.ok(handlers.includes("insertOnftReceivedCrossing"));
    assert.ok(owner.includes(".insert(bridgeCrossing)"));
    assert.ok(owner.includes(".update(bridgeCrossing"));
  });
});
