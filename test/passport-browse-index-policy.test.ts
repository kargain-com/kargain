/**
 * Every passport index in ponder.schema.ts must match a real browse
 * predicate/order key in PASSPORT_BROWSE_INDEXES. Orphan indexes and
 * unindexed equality/range/lower predicates fail closed.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PASSPORT_BROWSE_INDEXES,
  PASSPORT_BROWSE_UNINDEXED_ILIKE,
} from "../src/lib/passport-browse-index-contract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = path.join(ROOT, "ponder.schema.ts");
const BROWSE = path.join(ROOT, "src/lib/ponder-consignment-browse.ts");
const MIGRATION = path.join(ROOT, "docs/indexer/MIGRATION-V2.md");

type DeclaredIndex = {
  schemaKey: string;
  form: "column" | "lower";
  column: string;
};

/** Parse passport table index().on(...) declarations from ponder.schema.ts. */
function parsePassportSchemaIndexes(source: string): DeclaredIndex[] {
  const passportBlock = source.match(
    /export const passport = onchainTable\([\s\S]*?\n\);\n\nexport const passportUriHistory/,
  );
  assert.ok(passportBlock, "passport onchainTable block not found");
  const block = passportBlock[0];
  const out: DeclaredIndex[] = [];
  const re =
    /(\w+Idx):\s*index\(\)\.on\((?:sql`lower\(\$\{table\.(\w+)\}\)`|table\.(\w+))\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) != null) {
    const schemaKey = m[1];
    if (m[2]) {
      out.push({ schemaKey, form: "lower", column: m[2] });
    } else {
      out.push({ schemaKey, form: "column", column: m[3]! });
    }
  }
  return out;
}

describe("passport browse index ↔ predicate policy", () => {
  it("schema indexes match PASSPORT_BROWSE_INDEXES exactly", () => {
    const schemaSrc = fs.readFileSync(SCHEMA, "utf8");
    const declared = parsePassportSchemaIndexes(schemaSrc);
    const expected = PASSPORT_BROWSE_INDEXES.map((e) => ({
      schemaKey: e.schemaKey,
      form: e.form,
      column: e.column,
    }));

    assert.deepEqual(
      declared,
      expected,
      "ponder.schema.ts passport indexes must match PASSPORT_BROWSE_INDEXES (orphan index or form mismatch)",
    );
  });

  it("every indexable browse predicate has a matching index allowlist entry", () => {
    const browseSrc = fs.readFileSync(BROWSE, "utf8");
    const byColumn = new Map(
      PASSPORT_BROWSE_INDEXES.map((e) => [e.column, e] as const),
    );

    // lower(passport.X) / lower(${passport.X}) / lower(${column}) via csvColumnMatch columns
    const lowerCols = new Set<string>();
    for (const m of browseSrc.matchAll(
      /lower\(\$\{passport\.(\w+)\}\)/g,
    )) {
      lowerCols.add(m[1]);
    }
    // csvColumnMatch(passport.fuelType, …) etc.
    for (const m of browseSrc.matchAll(
      /csvColumnMatch\(\s*passport\.(\w+)/g,
    )) {
      lowerCols.add(m[1]);
    }

    for (const col of lowerCols) {
      const entry = byColumn.get(col);
      assert.ok(
        entry,
        `predicate lower(${col}) has no PASSPORT_BROWSE_INDEXES entry`,
      );
      assert.equal(
        entry.form,
        "lower",
        `predicate lower(${col}) requires form "lower" index, got ${entry.form}`,
      );
    }

    // Column equality / range used in filters or order
    const columnPreds = [
      { col: "status", needles: ["eq(passport.status", "passport.status"] },
      { col: "year", needles: ["passport.year"] },
      { col: "mileageKm", needles: ["passport.mileageKm"] },
      { col: "locationPlaceId", needles: ["passport.locationPlaceId"] },
    ] as const;

    for (const { col, needles } of columnPreds) {
      const used = needles.some((n) => browseSrc.includes(n));
      assert.ok(used, `expected column predicate for ${col} in browse SQL`);
      const entry = byColumn.get(col);
      assert.ok(entry, `predicate on ${col} has no PASSPORT_BROWSE_INDEXES entry`);
      assert.equal(entry.form, "column");
    }
  });

  it("colour and search stay unindexed and are documented", () => {
    const schemaSrc = fs.readFileSync(SCHEMA, "utf8");
    const declared = parsePassportSchemaIndexes(schemaSrc);
    assert.ok(
      !declared.some((d) => d.column === "colour"),
      "colour must not be indexed (ILIKE %…%)",
    );
    assert.deepEqual([...PASSPORT_BROWSE_UNINDEXED_ILIKE], ["colour", "search"]);

    const migration = fs.readFileSync(MIGRATION, "utf8");
    assert.match(migration, /colour/i);
    assert.match(migration, /search/i);
    assert.match(migration, /50k/);
    assert.match(migration, /pg_trgm|ILIKE/i);
  });

  it("fails closed: allowlist entry without schema index is caught by equality", () => {
    // Constructed violation — if someone adds to PASSPORT_BROWSE_INDEXES without
    // schema, the first test's deepEqual fails. Pin the invariant here.
    const schemaSrc = fs.readFileSync(SCHEMA, "utf8");
    const declaredKeys = new Set(
      parsePassportSchemaIndexes(schemaSrc).map((d) => d.schemaKey),
    );
    for (const entry of PASSPORT_BROWSE_INDEXES) {
      assert.ok(
        declaredKeys.has(entry.schemaKey),
        `allowlist ${entry.schemaKey} missing from schema (orphan allowlist entry)`,
      );
    }
  });
});
