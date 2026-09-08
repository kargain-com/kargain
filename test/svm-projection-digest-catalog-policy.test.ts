/**
 * Projection digest catalog ≡ schema CREATE TABLE ≡ writer INSERT targets.
 * Incomplete digest coverage must refuse by name (not silently hash a subset).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ProjectionDigestUncoveredTableError,
  assertProjectionDigestCoversTables,
  parseProjectionSchemaTableNames,
  svmProjectionCatalogTableNames,
} from "../lib/svm/svm-projection-catalog.ts";

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

  it("digest owner asserts live coverage before hashing", () => {
    const digestSrc = fs.readFileSync(DIGEST, "utf8");
    assert.ok(
      digestSrc.includes("assertProjectionDigestCoversLiveSchema") ||
        digestSrc.includes("assertProjectionDigestCoversTables"),
      "digest must call coverage assert",
    );
    assert.ok(
      !digestSrc.includes("digestProjectionRows"),
      "subset digestProjectionRows API must be deleted",
    );
    assert.ok(
      digestSrc.includes("custody_determining_event") ||
        digestSrc.includes("SVM_PROJECTION_CATALOG"),
      "digest must walk the full catalog",
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
