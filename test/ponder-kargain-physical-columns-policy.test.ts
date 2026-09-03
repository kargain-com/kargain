/**
 * EVM UNION / raw browse SQL must use Ponder 0.16 physical (snake_case) names.
 *
 * Source of truth: Ponder applies drizzle `toSnakeCase` at table build time.
 * Measured against a Ponder-created `DATABASE_SCHEMA=kargain` Postgres:
 * `chain_id` exists; `"chainId"` does not.
 *
 * Production master browse is Drizzle (`ponder-consignment-browse.ts`) — it
 * never used quoted camelCase raw SQL. That spelling existed only on the SVM
 * port branch and was incorrect against Ponder 0.16.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  HISTORICAL_CAMELCASE_BROWSE_FRAGMENT,
  KARGAIN_CONSIGNMENT_PHYSICAL_COLUMNS,
  KARGAIN_CUSTODY_DETERMINING_PHYSICAL_COLUMNS,
  KARGAIN_PASSPORT_PHYSICAL_COLUMNS,
  PASSPORT_JS_FIELDS,
  columnSetMismatch,
  extractSelectListBeforeFrom,
  findQuotedCamelCaseSqlIdentifiers,
  ponderPhysicalColumnName,
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
  const schema = read("ponder.schema.ts");
  const ponderOnchain = read("node_modules/ponder/dist/esm/drizzle/onchain.js");
  const ponderDb = read("node_modules/ponder/dist/esm/database/index.js");

  it("Ponder 0.16 hardcodes snake_case casing at schema build", () => {
    assert.match(ponderOnchain, /toSnakeCase\(name\)/);
    assert.match(ponderDb, /casing:\s*"snake_case"/);
  });

  it("ponderPhysicalColumnName matches measured passport information_schema", () => {
    assert.equal(ponderPhysicalColumnName("chainId"), "chain_id");
    assert.equal(ponderPhysicalColumnName("mileageKm"), "mileage_km");
    assert.equal(ponderPhysicalColumnName("locationPlaceId"), "location_place_id");
    assert.equal(ponderPhysicalColumnName("denominationKind"), "denomination_kind");
    assert.deepEqual(
      [...KARGAIN_PASSPORT_PHYSICAL_COLUMNS],
      [
        "id",
        "chain_id",
        "owner",
        "status",
        "verifier",
        "verified_at",
        "token_uri",
        "cover_photo_uri",
        "vin",
        "make",
        "model",
        "year",
        "mileage_km",
        "last_disputer",
        "dispute_reason",
        "dispute_withdrawn_at",
        "last_verification_reset_at",
        "duplicate_vin",
        "last_metadata_change_at",
        "verification_reset_count",
        "had_dispute",
        "last_dispute_resolved_at",
        "last_dispute_terminal",
        "dispute_opened_at",
        "fuel_type",
        "body_type",
        "transmission",
        "condition",
        "vehicle_type",
        "colour",
        "location_label",
        "location_place_id",
        "location_country_code",
        "dispute_deposit",
        "created_at",
        "updated_at",
      ],
    );
  });

  it("JS fields in fixture ⊆ ponder.schema.ts passport table", () => {
    for (const field of PASSPORT_JS_FIELDS) {
      if (field === "id") continue;
      assert.match(
        schema,
        new RegExp(`${field}:\\s*t\\.`, "m"),
        `ponder.schema.ts missing passport.${field}`,
      );
    }
  });

  it("kargain.passport SELECT list ≡ physical names from JS→snake_case", () => {
    const cols = extractSelectListBeforeFrom(entity, "kargain.passport");
    const gaps = columnSetMismatch(cols, KARGAIN_PASSPORT_PHYSICAL_COLUMNS);
    assert.deepEqual(gaps.missing, []);
    assert.deepEqual(gaps.extra, []);
  });

  it("historical camelCase browse SQL is red; current browse is green", () => {
    const redQuoted = findQuotedCamelCaseSqlIdentifiers(
      HISTORICAL_CAMELCASE_BROWSE_FRAGMENT,
    );
    assert.deepEqual(redQuoted, ["chainId", "denominationKind"]);

    const redSql = `SELECT id, "chainId" AS chain_id FROM kargain.passport`;
    assert.ok(findQuotedCamelCaseSqlIdentifiers(redSql).includes("chainId"));
    const redGaps = columnSetMismatch(
      extractSelectListBeforeFrom(redSql, "kargain.passport"),
      KARGAIN_PASSPORT_PHYSICAL_COLUMNS,
    );
    assert.ok(
      redGaps.missing.includes("chain_id") ||
        findQuotedCamelCaseSqlIdentifiers(redSql).includes("chainId"),
    );

    assert.deepEqual(findQuotedCamelCaseSqlIdentifiers(browse), []);
    assert.match(browse, /c\.chain_id AS "chainId"/);
    assert.match(browse, /c\.denomination_kind AS "denominationKind"/);
    assert.doesNotMatch(browse, /c\."chainId"/);
    assert.doesNotMatch(browse, /c\."denominationKind"/);
  });

  it("consignment physical names include chain_id / denomination_kind", () => {
    assert.ok(KARGAIN_CONSIGNMENT_PHYSICAL_COLUMNS.includes("chain_id"));
    assert.ok(KARGAIN_CONSIGNMENT_PHYSICAL_COLUMNS.includes("denomination_kind"));
    assert.ok(KARGAIN_CONSIGNMENT_PHYSICAL_COLUMNS.includes("token_id"));
  });

  it("custody EVM SQL has no quoted camelCase; uses token_id / chain_id", () => {
    assert.deepEqual(findQuotedCamelCaseSqlIdentifiers(custody), []);
    assert.match(custody, /FROM kargain\.custody_determining_event/);
    assert.match(custody, /token_id/);
    assert.match(custody, /chain_id/);
    for (const col of ["token_id", "chain_id", "block_number", "log_index"]) {
      assert.ok(
        KARGAIN_CUSTODY_DETERMINING_PHYSICAL_COLUMNS.includes(col),
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

  it("master production browse path is Drizzle, not historical camelCase raw SQL", () => {
    // Reachable proof that the live product path Claude cited is not the raw SQL file.
    const masterBrowse = path.join(ROOT, "src/lib/ponder-consignment-browse.ts");
    assert.ok(fs.existsSync(masterBrowse));
    const drizzleBrowse = read("src/lib/ponder-consignment-browse.ts");
    assert.match(drizzleBrowse, /from "ponder:schema"/);
    assert.match(drizzleBrowse, /consignment\.chainId/);
    assert.doesNotMatch(drizzleBrowse, /c\."chainId"/);
  });
});
