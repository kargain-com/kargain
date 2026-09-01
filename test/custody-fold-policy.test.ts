/**
 * Custody fold ownership + cross-VM timestamp ban (S7c-3).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FOLD_OWNER = path.join(ROOT, "lib/custody/fold.ts");
const QUERY_OWNER = path.join(ROOT, "src/lib/ponder-passport-custody.ts");
const INDEX_TS = path.join(ROOT, "src/index.ts");
const SCHEMA = path.join(ROOT, "ponder.schema.ts");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("custody fold policy", () => {
  it("sole fold owner is lib/custody/fold.ts", () => {
    const fold = read(FOLD_OWNER);
    assert.ok(fold.includes("export function foldPassportCustody"));
    const libCustodyDir = fs.readdirSync(path.join(ROOT, "lib/custody"));
    const foldFiles = libCustodyDir.filter((f) => f.endsWith(".ts") && f !== "fold.ts");
    for (const file of foldFiles) {
      const src = read(path.join(ROOT, "lib/custody", file));
      assert.ok(
        !src.includes("export function foldPassportCustody"),
        `${file} must not export foldPassportCustody`,
      );
    }
  });

  it("handlers append custody_determining_event — no stored custody columns", () => {
    const index = read(INDEX_TS);
    const schema = read(SCHEMA);
    assert.ok(index.includes("insertCustodyDeterminingEvent"));
    assert.ok(!index.includes("resolveCustody"));
    assert.ok(!index.includes("nextCustodyChain"));
    assert.ok(!index.includes("custodyUpdatedAt"));
    assert.ok(!schema.includes("custodyChain:"));
    assert.ok(schema.includes("custody_determining_event"));
  });

  it("query owner loads streams and calls fold — no timestamp sort in fold path", () => {
    const query = read(QUERY_OWNER);
    assert.ok(query.includes("loadCustodyFoldInputs"));
    assert.ok(query.includes("foldPassportCustody"));
    const foldBody = read(FOLD_OWNER).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!foldBody.includes("timestamp"));
    assert.ok(!query.match(/ORDER BY.*timestamp/i));
  });

  it("deleted ponder-custody monotonic gate is gone", () => {
    assert.equal(
      fs.existsSync(path.join(ROOT, "src/lib/ponder-custody.ts")),
      false,
    );
  });
});
