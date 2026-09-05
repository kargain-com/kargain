/**
 * Read-path readiness route: prove required projection relations exist and the
 * same UNION read forms as product routes are executable.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { DataType, newDb } from "pg-mem";
import type pg from "pg";

import {
  READ_PATH_REQUIRED_RELATIONS,
  resolveReadPathReadiness,
} from "../src/lib/ponder-read-path-ready.js";
import { buildPassportEntityUnionSubquery } from "../src/lib/ponder-passport-entity.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EVM_DDL = `
CREATE SCHEMA IF NOT EXISTS kargain;
CREATE TABLE IF NOT EXISTS kargain.passport (
  id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL,
  verifier TEXT NOT NULL DEFAULT '',
  verified_at BIGINT NOT NULL DEFAULT 0,
  token_uri TEXT NOT NULL DEFAULT '',
  cover_photo_uri TEXT NOT NULL DEFAULT '',
  vin TEXT NOT NULL DEFAULT '',
  make TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  year INTEGER NOT NULL DEFAULT 0,
  mileage_km INTEGER NOT NULL DEFAULT 0,
  last_disputer TEXT NOT NULL DEFAULT '',
  dispute_reason TEXT NOT NULL DEFAULT '',
  dispute_withdrawn_at BIGINT NOT NULL DEFAULT 0,
  last_verification_reset_at BIGINT NOT NULL DEFAULT 0,
  duplicate_vin BOOLEAN NOT NULL DEFAULT false,
  last_metadata_change_at BIGINT NOT NULL DEFAULT 0,
  verification_reset_count INTEGER NOT NULL DEFAULT 0,
  had_dispute BOOLEAN NOT NULL DEFAULT false,
  last_dispute_resolved_at BIGINT NOT NULL DEFAULT 0,
  last_dispute_terminal TEXT NOT NULL DEFAULT '',
  dispute_opened_at BIGINT NOT NULL DEFAULT 0,
  fuel_type TEXT NOT NULL DEFAULT '',
  body_type TEXT NOT NULL DEFAULT '',
  transmission TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  vehicle_type TEXT NOT NULL DEFAULT '',
  colour TEXT NOT NULL DEFAULT '',
  location_label TEXT NOT NULL DEFAULT '',
  location_place_id TEXT NOT NULL DEFAULT '',
  location_country_code TEXT NOT NULL DEFAULT '',
  dispute_deposit BIGINT,
  created_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kargain.passport_record (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  record_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  evidence_cid TEXT NOT NULL DEFAULT '',
  timestamp BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kargain.passport_uri_history (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  previous_uri TEXT NOT NULL DEFAULT '',
  new_uri TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  verification_reset BOOLEAN NOT NULL DEFAULT false,
  timestamp BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kargain.bridge_crossing (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  observing_chain_id INTEGER NOT NULL,
  peer_namespace INTEGER,
  peer_namespace_refusal TEXT,
  block_number INTEGER NOT NULL DEFAULT 0,
  log_index INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kargain.custody_determining_event (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  block_number INTEGER NOT NULL DEFAULT 0,
  log_index INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kargain.consignment (
  id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  mode_contract TEXT NOT NULL,
  token_id TEXT NOT NULL,
  sale_ordinal INTEGER NOT NULL DEFAULT 1,
  seller TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL DEFAULT '',
  asset TEXT NOT NULL DEFAULT '',
  denomination_kind INTEGER NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT '',
  floor BIGINT NOT NULL DEFAULT 0,
  compensation_form INTEGER NOT NULL DEFAULT 0,
  commission_bps INTEGER NOT NULL DEFAULT 0,
  price BIGINT NOT NULL DEFAULT 0,
  platform_fee_bps INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'offered',
  close_reason INTEGER,
  opened_at BIGINT NOT NULL DEFAULT 0,
  closed_at BIGINT,
  recall_requested_at BIGINT,
  buyer TEXT NOT NULL DEFAULT '',
  settlement_note_set_at BIGINT,
  settlement_note_setter TEXT NOT NULL DEFAULT '',
  open_tx_hash TEXT NOT NULL DEFAULT '',
  open_log_index INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0
);
`;

function projectionDdl(): string {
  return fs.readFileSync(
    path.join(ROOT, "src/svm-ingest/db/projection-schema.sql"),
    "utf8",
  );
}

async function createReadinessPool(args: { withProjection: boolean }): Promise<pg.Pool> {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const existingRelations = new Set<string>([
    "kargain.consignment",
    "kargain.passport",
    "kargain.passport_record",
    "kargain.passport_uri_history",
    "kargain.bridge_crossing",
    "kargain.custody_determining_event",
  ]);
  db.public.none(EVM_DDL);
  if (args.withProjection) {
    db.public.none(projectionDdl());
    existingRelations.add("kargain_svm_projection.passport");
    existingRelations.add("kargain_svm_projection.passport_record");
    existingRelations.add("kargain_svm_projection.passport_uri_history");
    existingRelations.add("kargain_svm_projection.custody_determining_event");
  }
  db.public.registerFunction({
    name: "to_regclass",
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string | null) =>
      value != null && existingRelations.has(value) ? value : null,
  });
  const adapter = db.adapters.createPg();
  return new adapter.Pool() as unknown as pg.Pool;
}

function strictSqlPool(pool: pg.Pool): pg.Pool {
  return {
    ...pool,
    query: (async (text: string, values?: readonly unknown[]) => {
      const matches = [...text.matchAll(/\$(\d+)/g)];
      const highestParam = matches.reduce((max, match) => {
        const value = Number.parseInt(match[1] ?? "0", 10);
        return Number.isFinite(value) && value > max ? value : max;
      }, 0);
      const paramCount = values?.length ?? 0;
      if (highestParam > 0 && paramCount < highestParam) {
        throw new Error(
          `missing SQL parameters: expected ${highestParam}, received ${paramCount}`,
        );
      }
      if (highestParam === 0 && paramCount > 0) {
        throw new Error(
          `unexpected SQL parameters: expected 0, received ${paramCount}`,
        );
      }
      return pool.query(text, values as unknown[]);
    }) as pg.Pool["query"],
  } as pg.Pool;
}

function readinessApp(pool: pg.Pool): Hono {
  const app = new Hono();
  const strictPool = strictSqlPool(pool);
  app.get("/ready", (c) => c.text(""));
  app.get("/read-path-ready", async (c) => {
    const readiness = await resolveReadPathReadiness(strictPool);
    return c.json(
      readiness.ready
        ? {
            status: "ready",
            checkedRelations: readiness.checkedRelations,
            probeQueries: readiness.probeQueries,
          }
        : {
            status: "not_ready",
            checkedRelations: readiness.checkedRelations,
            missingRelations: readiness.missingRelations,
          },
      readiness.ready ? 200 : 503,
    );
  });
  app.get("/consignments", async (c) => {
    await strictPool.query(`SELECT c.id
      FROM kargain.consignment c
      LEFT JOIN ${buildPassportEntityUnionSubquery([84532, 11155111], true)} p
        ON c.token_id = p.id
      LIMIT 0`, [[84532, 11155111]]);
    return c.json({
      consignments: [],
      total: 0,
      statusCounts: { UNVERIFIED: 0, VERIFIED: 0, DISPUTED: 0 },
    });
  });
  return app;
}

describe("ponder read-path readiness", () => {
  it("names missing projection relations while /ready can stay green", async () => {
    const pool = await createReadinessPool({ withProjection: false });
    const app = readinessApp(pool);

    const reservedReady = await app.request("/ready");
    assert.equal(reservedReady.status, 200);

    const readReady = await app.request("/read-path-ready");
    assert.equal(readReady.status, 503);
    const body = await readReady.json();
    assert.equal(body.status, "not_ready");
    assert.deepEqual(body.checkedRelations, [...READ_PATH_REQUIRED_RELATIONS]);
    assert.ok(body.missingRelations.includes("kargain_svm_projection.passport"));
    assert.ok(body.missingRelations.includes("kargain_svm_projection.passport_record"));
    assert.ok(body.missingRelations.includes("kargain_svm_projection.passport_uri_history"));
    assert.ok(body.missingRelations.includes("kargain_svm_projection.custody_determining_event"));
  });

  it("goes green with an empty projection arm and consignment browse still answers 200", async () => {
    const pool = await createReadinessPool({ withProjection: true });
    const app = readinessApp(pool);

    const readReady = await app.request("/read-path-ready");
    assert.equal(readReady.status, 200);
    const readyBody = await readReady.json();
    assert.equal(readyBody.status, "ready");
    assert.deepEqual(readyBody.probeQueries, [
      "passport_entity_union",
      "consignment_entity_union_join",
      "passport_record_union",
      "passport_uri_history_union",
      "passport_custody_sources",
    ]);

    const consignments = await app.request("/consignments");
    assert.equal(consignments.status, 200);
    assert.deepEqual(await consignments.json(), {
      consignments: [],
      total: 0,
      statusCounts: { UNVERIFIED: 0, VERIFIED: 0, DISPUTED: 0 },
    });
  });

  it("constructed violation: dropping the SVM arm changes the browse probe form", () => {
    const live = buildPassportEntityUnionSubquery([84532, 11155111], true);
    const dirty = buildPassportEntityUnionSubquery([84532, 11155111], false);

    assert.match(live, /UNION ALL/);
    assert.match(live, /kargain_svm_projection\.passport/);
    assert.doesNotMatch(dirty, /UNION ALL/);
    assert.doesNotMatch(dirty, /kargain_svm_projection\.passport/);
  });
});
