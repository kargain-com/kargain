/**
 * Projection digest catalog ≡ schema CREATE TABLE ≡ writer INSERT targets.
 * Incomplete digest coverage (tables or columns) must refuse by name.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ProjectionDigestAbsentColumnError,
  ProjectionDigestUncoveredColumnError,
  ProjectionDigestUncoveredTableError,
  SVM_PROJECTION_CATALOG,
  assertProjectionDigestCoversColumns,
  assertProjectionDigestCoversTables,
  catalogCoveredColumnsForTable,
  parseProjectionSchemaTableNames,
  parseSelectSqlColumns,
  svmProjectionCatalogTableNames,
} from "../lib/svm/svm-projection-catalog.ts";
import {
  ProjectionDigestUndefinedValueTypeError,
  canonicalizeProjectionRow,
  normalizeCanonicalValue,
} from "../lib/svm/projection-replay-digest.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = path.join(
  ROOT,
  "src/svm-ingest/db/projection-schema.sql",
);
const WRITER = path.join(ROOT, "src/lib/svm-projection-writer.ts");
const DIGEST = path.join(ROOT, "lib/svm/projection-replay-digest.ts");

const INSERT_TABLE_RE =
  /INSERT\s+INTO\s+kargain_svm_projection\.([a-z_]+)/gi;

function writerInsertTables(src: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(INSERT_TABLE_RE.source, "gi");
  while ((m = re.exec(src)) !== null) out.add(m[1]!);
  return [...out].sort();
}

describe("svm projection digest catalog policy", () => {
  it("catalog ≡ projection-schema CREATE TABLE (both directions)", () => {
    const schemaTables = parseProjectionSchemaTableNames(
      fs.readFileSync(SCHEMA, "utf8"),
    ).sort();
    const catalog = [...svmProjectionCatalogTableNames()].sort();
    assert.deepEqual(
      catalog,
      schemaTables,
      `catalog ${JSON.stringify(catalog)} !== schema ${JSON.stringify(schemaTables)}`,
    );
  });

  it("catalog ≡ writer INSERT targets (both directions)", () => {
    const writerTables = writerInsertTables(fs.readFileSync(WRITER, "utf8"));
    const catalog = [...svmProjectionCatalogTableNames()].sort();
    assert.deepEqual(
      catalog,
      writerTables,
      `catalog ${JSON.stringify(catalog)} !== writer ${JSON.stringify(writerTables)}`,
    );
  });

  it("digest owner asserts live table + column coverage before hashing", () => {
    const digestSrc = fs.readFileSync(DIGEST, "utf8");
    assert.ok(
      digestSrc.includes("assertProjectionDigestCoversLiveSchema"),
      "digest must call live schema coverage assert",
    );
    assert.ok(
      digestSrc.includes("assertProjectionDigestCoversColumns") ||
        digestSrc.includes("listLiveProjectionColumns"),
      "digest must assert column coverage against information_schema",
    );
    assert.ok(
      !digestSrc.includes("digestProjectionRows"),
      "subset digestProjectionRows API must be deleted",
    );
    assert.ok(
      !digestSrc.includes("should not for these columns"),
      "object-passthrough assumption comment must be deleted",
    );
    assert.ok(
      digestSrc.includes("localeCompare") ||
        digestSrc.includes("canonicalizeProjectionRow"),
      "canonical keys must be ordered independently of selectSql",
    );
  });

  it("constructed: uncovered live table refuses by name", () => {
    assert.throws(
      () =>
        assertProjectionDigestCoversTables([
          ...svmProjectionCatalogTableNames(),
          "orphan_projection_table",
        ]),
      (err: unknown) => {
        assert.ok(err instanceof ProjectionDigestUncoveredTableError);
        assert.equal(err.uncoveredTable, "orphan_projection_table");
        assert.match(err.message, /projection_digest_uncovered_table: orphan_projection_table/);
        return true;
      },
    );
  });

  it("constructed: live column absent from coverage refuses by name", () => {
    const covered = catalogCoveredColumnsForTable("passport");
    assert.throws(
      () =>
        assertProjectionDigestCoversColumns({
          table: "passport",
          liveColumns: [...covered, "orphan_digest_column"],
          coveredColumns: covered,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProjectionDigestUncoveredColumnError);
        assert.equal(err.table, "passport");
        assert.equal(err.uncoveredColumn, "orphan_digest_column");
        assert.match(
          err.message,
          /projection_digest_uncovered_column: passport\.orphan_digest_column/,
        );
        return true;
      },
    );
  });

  it("constructed: covered column absent from live refuses by name", () => {
    const covered = [...catalogCoveredColumnsForTable("passport")];
    const live = covered.filter((c) => c !== "owner");
    assert.throws(
      () =>
        assertProjectionDigestCoversColumns({
          table: "passport",
          liveColumns: live,
          coveredColumns: covered,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProjectionDigestAbsentColumnError);
        assert.equal(err.table, "passport");
        assert.equal(err.absentColumn, "owner");
        assert.match(
          err.message,
          /projection_digest_absent_column: passport\.owner/,
        );
        return true;
      },
    );
  });

  it("constructed: undefined value type refuses rather than serializing", () => {
    assert.throws(
      () => normalizeCanonicalValue("created_at", new Date(0)),
      (err: unknown) => {
        assert.ok(err instanceof ProjectionDigestUndefinedValueTypeError);
        assert.equal(err.column, "created_at");
        assert.equal(err.jsType, "Date");
        assert.match(
          err.message,
          /projection_digest_undefined_value_type: created_at:Date/,
        );
        return true;
      },
    );
    assert.throws(
      () =>
        canonicalizeProjectionRow("passport", {
          owner: { nested: true },
        }),
      /projection_digest_undefined_value_type: owner:object/,
    );
  });

  it("canonical keys are lexicographic under row, with stream kind first", () => {
    const line = JSON.stringify(
      canonicalizeProjectionRow("custody_determining_event", {
        token_id: "t",
        chain_id: 1,
        id: "i",
        kind: "native_mint",
        block_number: 2,
        log_index: 3,
      }),
    );
    assert.ok(line.startsWith('{"kind":"custody_determining_event","row":{'));
    assert.ok(
      line.includes('"kind":"native_mint"'),
      "custody column kind must survive beside stream discriminant",
    );
    assert.ok(
      line.indexOf('"block_number"') < line.indexOf('"chain_id"'),
      "lex order puts block_number before chain_id",
    );
  });

  it("parseSelectSqlColumns rejects empty and expands passport floor", () => {
    const passport = parseSelectSqlColumns(
      SVM_PROJECTION_CATALOG.find((e) => e.table === "passport")!.selectSql,
    );
    assert.ok(passport.length >= 36);
    assert.ok(passport.includes("dispute_deposit"));
    assert.deepEqual(parseSelectSqlColumns("a, b ,c"), ["a", "b", "c"]);
  });

  it("constructed: schema with extra CREATE TABLE diverges from catalog", () => {
    const dirty =
      fs.readFileSync(SCHEMA, "utf8") +
      "\nCREATE TABLE IF NOT EXISTS kargain_svm_projection.orphan_projection_table (id TEXT PRIMARY KEY);\n";
    const schemaTables = parseProjectionSchemaTableNames(dirty);
    assert.ok(schemaTables.includes("orphan_projection_table"));
    assert.throws(
      () => assertProjectionDigestCoversTables(schemaTables),
      /projection_digest_uncovered_table: orphan_projection_table/,
    );
  });

  it("constructed: writer missing a catalog table fails bidirectional pin", () => {
    const catalog = new Set(svmProjectionCatalogTableNames());
    const incomplete = writerInsertTables(
      fs.readFileSync(WRITER, "utf8"),
    ).filter((t) => t !== "passport");
    for (const t of incomplete) assert.ok(catalog.has(t));
    assert.ok(!incomplete.includes("passport"));
    assert.notDeepEqual([...catalog].sort(), incomplete.sort());
  });
});
