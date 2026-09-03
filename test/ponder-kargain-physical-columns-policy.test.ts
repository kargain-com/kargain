/**
 * EVM UNION SQL must use Ponder 0.16 physical (snake_case) column names,
 * not quoted camelCase JS schema fields. Fixture is information_schema from
 * a Ponder-created kargain schema — not pg-mem.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  KARGAIN_CONSIGNMENT_PHYSICAL_COLUMNS,
  KARGAIN_CUSTODY_DETERMINING_PHYSICAL_COLUMNS,
  KARGAIN_PASSPORT_PHYSICAL_COLUMNS,
  columnSetMismatch,
  extractSelectListBeforeFrom,
  findQuotedCamelCaseSqlIdentifiers,
} from "./fixtures/ponder-kargain-physical-columns.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("ponder kargain physical columns", () => {
  const entity = read("src/lib/ponder-passport-entity.ts");
  const browse = read("src/lib/passport-entity-browse-sql.ts");
  const custody = read("src/lib/ponder-passport-custody.ts");
  const provenance = read("src/lib/ponder-passport-provenance.ts");
  const pgMem = read("test/fixtures/entity-pg-pool.ts");

  it("kargain.passport SELECT list ≡ Ponder information_schema snake_case", () => {
    const cols = extractSelectListBeforeFrom(entity, "kargain.passport");
    const gaps = columnSetMismatch(cols, KARGAIN_PASSPORT_PHYSICAL_COLUMNS);
    assert.deepEqual(gaps.missing, []);
    assert.deepEqual(gaps.extra, []);
  });

  it("constructed camelCase quoted chainId on passport turns red then green", () => {
    const redSql = `SELECT id, "chainId" AS chain_id FROM kargain.passport`;
    const redQuoted = findQuotedCamelCaseSqlIdentifiers(redSql);
    assert.ok(redQuoted.includes("chainId"));
    const redCols = extractSelectListBeforeFrom(redSql, "kargain.passport");
    const redGaps = columnSetMismatch(redCols, KARGAIN_PASSPORT_PHYSICAL_COLUMNS);
    assert.ok(redGaps.missing.includes("chain_id") || redQuoted.includes("chainId"));

    const greenQuoted = findQuotedCamelCaseSqlIdentifiers(entity);
    assert.deepEqual(greenQuoted, []);
    const greenGaps = columnSetMismatch(
      extractSelectListBeforeFrom(entity, "kargain.passport"),
      KARGAIN_PASSPORT_PHYSICAL_COLUMNS,
    );
    assert.deepEqual(greenGaps.missing, []);
    assert.deepEqual(greenGaps.extra, []);
  });

  it("consignment browse uses snake_case physical columns on kargain.consignment", () => {
    assert.match(browse, /c\.chain_id AS "chainId"/);
    assert.match(browse, /c\.token_id AS "tokenId"/);
    assert.doesNotMatch(browse, /c\."chainId"/);
    assert.doesNotMatch(browse, /c\."tokenId"/);
    assert.deepEqual(findQuotedCamelCaseSqlIdentifiers(browse), []);
    for (const col of ["chain_id", "token_id", "mode_contract", "opened_at"]) {
      assert.ok(
        (KARGAIN_CONSIGNMENT_PHYSICAL_COLUMNS as readonly string[]).includes(col),
      );
    }
  });

  it("custody EVM SQL has no quoted camelCase; uses token_id / chain_id", () => {
    assert.deepEqual(findQuotedCamelCaseSqlIdentifiers(custody), []);
    assert.match(custody, /FROM kargain\.custody_determining_event/);
    assert.match(custody, /token_id/);
    assert.match(custody, /chain_id/);
    for (const col of ["token_id", "chain_id", "block_number", "log_index"]) {
      assert.ok(
        (KARGAIN_CUSTODY_DETERMINING_PHYSICAL_COLUMNS as readonly string[]).includes(
          col,
        ),
      );
    }
  });

  it("provenance EVM SQL uses snake_case passport_record / uri_history", () => {
    assert.deepEqual(findQuotedCamelCaseSqlIdentifiers(provenance), []);
    assert.match(provenance, /FROM kargain\.passport_record/);
    assert.match(provenance, /token_id/);
    assert.match(provenance, /chain_id/);
  });

  it("pg-mem EVM passport DDL uses the same physical names as Ponder", () => {
    assert.match(pgMem, /chain_id INTEGER NOT NULL/);
    assert.doesNotMatch(pgMem, /"chainId"/);
    for (const col of KARGAIN_PASSPORT_PHYSICAL_COLUMNS) {
      if (col === "id") continue;
      assert.ok(pgMem.includes(col), `pg-mem DDL missing ${col}`);
    }
  });
});
