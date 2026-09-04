/**
 * Real-engine controls for metadata_snapshot digest CHECK + partial unique
 * (raw-sentinel). Requires Postgres — set RAW_SENTINEL_DATABASE_URL or defaults
 * to the ephemeral docker listener on 127.0.0.1:55432.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { applySvmRawSchema } from "../src/lib/svm-raw-writer.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DATABASE_URL =
  process.env.RAW_SENTINEL_DATABASE_URL?.trim() ||
  "postgresql://test:test@127.0.0.1:55432/kargain_test";

async function canConnect(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return false;
  }
}

describe("svm metadata snapshot raw-sentinel (real Postgres)", async () => {
  const reachable = await canConnect(DATABASE_URL);
  if (!reachable) {
    it("SKIP — no Postgres at RAW_SENTINEL_DATABASE_URL / 127.0.0.1:55432", () => {
      assert.fail(
        "raw-sentinel SQL controls require a real Postgres engine (start docker postgres:16 on :55432)",
      );
    });
    return;
  }

  let pool: pg.Pool;

  before(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    await pool.query(`DROP SCHEMA IF EXISTS kargain_svm_raw CASCADE`);
    await applySvmRawSchema(pool);
  });

  after(async () => {
    await pool?.end();
  });

  it("CHECK rejects captured with NULL digest and unavailable with a digest", async () => {
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO kargain_svm_raw.metadata_snapshot (
            id, namespace, uri, content_sha256, parsed_json, source_payload_id, slot, status
          ) VALUES ($1,1,'ar://a',NULL,NULL,'p',1,'captured')`,
          ["bad-captured-null"],
        ),
      /metadata_snapshot_digest_status_ck|check constraint/i,
    );

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO kargain_svm_raw.metadata_snapshot (
            id, namespace, uri, content_sha256, parsed_json, source_payload_id, slot, status
          ) VALUES ($1,1,'ar://a',$2,NULL,'p',1,'unavailable')`,
          ["bad-unavail-digest", "a".repeat(64)],
        ),
      /metadata_snapshot_digest_status_ck|check constraint/i,
    );
  });

  it("partial unique: two digests for same URI ok; same digest twice rejected", async () => {
    const digestA = "a".repeat(64);
    const digestB = "b".repeat(64);
    await pool.query(
      `INSERT INTO kargain_svm_raw.metadata_snapshot (
        id, namespace, uri, content_sha256, parsed_json, source_payload_id, slot, status
      ) VALUES
        ('cap-a', 1, 'ar://same', $1, '{}'::jsonb, 'p1', 10, 'captured'),
        ('cap-b', 1, 'ar://same', $2, '{}'::jsonb, 'p2', 20, 'captured')`,
      [digestA, digestB],
    );

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO kargain_svm_raw.metadata_snapshot (
            id, namespace, uri, content_sha256, parsed_json, source_payload_id, slot, status
          ) VALUES ('cap-a2', 1, 'ar://same', $1, '{}'::jsonb, 'p3', 30, 'captured')`,
          [digestA],
        ),
      /unique|duplicate/i,
    );
  });

  it("two unavailable observations of same URI at different slots → two rows; replay → one", async () => {
    await pool.query(
      `INSERT INTO kargain_svm_raw.metadata_snapshot (
        id, namespace, uri, content_sha256, parsed_json, source_payload_id, slot, status
      ) VALUES
        ('1:ar://fail:obs:payload-a:100', 1, 'ar://fail', NULL, NULL, 'payload-a', 100, 'unavailable'),
        ('1:ar://fail:obs:payload-b:200', 1, 'ar://fail', NULL, NULL, 'payload-b', 200, 'unavailable')`,
    );

    const count = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM kargain_svm_raw.metadata_snapshot
       WHERE uri = 'ar://fail' AND status = 'unavailable'`,
    );
    assert.equal(count.rows[0]?.n, 2);

    const replay = await pool.query(
      `INSERT INTO kargain_svm_raw.metadata_snapshot (
        id, namespace, uri, content_sha256, parsed_json, source_payload_id, slot, status
      ) VALUES
        ('1:ar://fail:obs:payload-a:100', 1, 'ar://fail', NULL, NULL, 'payload-a', 100, 'unavailable')
      ON CONFLICT (id) DO NOTHING`,
    );
    assert.equal(replay.rowCount, 0);

    const after = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM kargain_svm_raw.metadata_snapshot
       WHERE uri = 'ar://fail' AND status = 'unavailable'`,
    );
    assert.equal(after.rows[0]?.n, 2);
  });

  it("schema.sql has CHECK both directions and partial unique; no total UNIQUE on digest", () => {
    const sql = fs.readFileSync(
      path.join(ROOT, "src/svm-ingest/db/schema.sql"),
      "utf8",
    );
    assert.match(sql, /metadata_snapshot_digest_status_ck/);
    assert.match(
      sql,
      /status = 'captured' AND content_sha256 IS NOT NULL/,
    );
    assert.match(
      sql,
      /status = 'unavailable' AND content_sha256 IS NULL/,
    );
    assert.match(sql, /metadata_snapshot_captured_uri_digest_uidx/);
    assert.match(sql, /WHERE status = 'captured'/);
    assert.doesNotMatch(sql, /CONSTRAINT metadata_snapshot_uri_order UNIQUE/);
    assert.doesNotMatch(sql, /content_sha256 TEXT NOT NULL/);
  });
});
