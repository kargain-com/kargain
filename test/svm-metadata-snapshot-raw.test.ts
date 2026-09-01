/**
 * Raw metadata_snapshot append-only + unavailable refusal semantics (S7c-4).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { newDb } from "pg-mem";

import { buildMetadataSnapshotDraft } from "../lib/svm/capture-metadata-at-ingest.js";
import {
  metadataSnapshotRowId,
  sha256Hex,
  type MetadataSnapshotDraft,
} from "../lib/svm/metadata-snapshot.js";
import type { StructuredPayloadDraft } from "../lib/svm/parse-transaction-ingest.js";
import { createSvmRawWriter } from "../src/lib/svm-raw-writer.js";
import {
  buildPassportMintedBody,
  globalTokenId,
  PASSPORT_MINTED_DISC,
} from "./fixtures/svm-ingest/borsh-fixtures.js";
import { FIXTURE_NAMESPACE } from "./fixtures/svm-ingest/fixture-block.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const METADATA_SNAPSHOT_DDL = `
CREATE SCHEMA IF NOT EXISTS kargain_svm_raw;
CREATE TABLE IF NOT EXISTS kargain_svm_raw.metadata_snapshot (
  id TEXT PRIMARY KEY,
  namespace INTEGER NOT NULL,
  uri TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  parsed_json JSONB,
  source_payload_id TEXT NOT NULL,
  slot BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('captured', 'unavailable')),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT metadata_snapshot_uri_order UNIQUE (namespace, uri, content_sha256)
);
`;

function mintPayload(id: string): StructuredPayloadDraft {
  const tokenId = globalTokenId(FIXTURE_NAMESPACE, 99);
  const body = buildPassportMintedBody({ tokenId, uri: "ar://unavailable-fixture" });
  const payloadBytes = Buffer.concat([
    Buffer.from(PASSPORT_MINTED_DISC, "hex"),
    body,
  ]);
  return {
    id,
    namespace: FIXTURE_NAMESPACE,
    slot: 100,
    txIndexInBlock: 0,
    logIndex: 0,
    txSignature: "sig",
    emittingProgram: "prog",
    discriminator: Buffer.from(PASSPORT_MINTED_DISC, "hex"),
    eventName: "PassportMinted",
    contractName: "KarPassport",
    payloadBytes,
  };
}

describe("svm metadata snapshot raw semantics", () => {
  it("append-only: same URI with new document hash creates a new row", async () => {
    const db = newDb();
    db.public.none(METADATA_SNAPSHOT_DDL);
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();
    const writer = createSvmRawWriter(pool);

    const uri = "ar://fixture-v1";
    const v1: MetadataSnapshotDraft = {
      id: metadataSnapshotRowId({
        namespace: FIXTURE_NAMESPACE,
        uri,
        contentSha256: sha256Hex('{"vin":"A"}'),
      }),
      namespace: FIXTURE_NAMESPACE,
      uri,
      contentSha256: sha256Hex('{"vin":"A"}'),
      parsedJson: { vin: "A" },
      denorm: null,
      sourcePayloadId: "payload-v1",
      slot: 100,
      status: "captured",
    };
    const v2: MetadataSnapshotDraft = {
      ...v1,
      id: metadataSnapshotRowId({
        namespace: FIXTURE_NAMESPACE,
        uri,
        contentSha256: sha256Hex('{"vin":"B"}'),
      }),
      contentSha256: sha256Hex('{"vin":"B"}'),
      parsedJson: { vin: "B" },
      sourcePayloadId: "payload-v2",
      slot: 200,
    };

    assert.equal(await writer.insertMetadataSnapshot(v1), true);
    assert.equal(await writer.insertMetadataSnapshot(v2), true);

    const rows = await pool.query<{ id: string; content_sha256: string }>(
      `SELECT id, content_sha256 FROM kargain_svm_raw.metadata_snapshot WHERE uri = $1 ORDER BY slot`,
      [uri],
    );
    assert.equal(rows.rows.length, 2);
    assert.notEqual(rows.rows[0]!.content_sha256, rows.rows[1]!.content_sha256);
  });

  it("append-only: duplicate id is a no-op (never overwrites)", async () => {
    const db = newDb();
    db.public.none(METADATA_SNAPSHOT_DDL);
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();
    const writer = createSvmRawWriter(pool);

    const row: MetadataSnapshotDraft = {
      id: metadataSnapshotRowId({
        namespace: FIXTURE_NAMESPACE,
        uri: "ar://same",
        contentSha256: sha256Hex('{"vin":"A"}'),
      }),
      namespace: FIXTURE_NAMESPACE,
      uri: "ar://same",
      contentSha256: sha256Hex('{"vin":"A"}'),
      parsedJson: { vin: "A" },
      denorm: null,
      sourcePayloadId: "payload-1",
      slot: 100,
      status: "captured",
    };

    assert.equal(await writer.insertMetadataSnapshot(row), true);
    await writer.insertMetadataSnapshot(row);

    const count = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM kargain_svm_raw.metadata_snapshot`,
    );
    assert.equal(count.rows[0]?.n, 1);
  });

  it("unavailable fetch writes a named snapshot row (not silent absence)", async () => {
    const draft = await buildMetadataSnapshotDraft({
      payload: mintPayload("payload-unavail"),
      fetcher: async () => ({
        status: "unavailable",
        reason: "fetch_or_parse_failed",
      }),
    });

    assert.ok(draft);
    assert.equal(draft!.status, "unavailable");
    assert.equal(draft!.contentSha256, "unavailable");
    assert.equal(draft!.parsedJson, null);

    const db = newDb();
    db.public.none(METADATA_SNAPSHOT_DDL);
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();
    const writer = createSvmRawWriter(pool);
    assert.equal(await writer.insertMetadataSnapshot(draft!), true);

    const row = await pool.query<{ status: string; parsed_json: unknown }>(
      `SELECT status, parsed_json FROM kargain_svm_raw.metadata_snapshot WHERE id = $1`,
      [draft!.id],
    );
    assert.equal(row.rows[0]?.status, "unavailable");
    assert.equal(row.rows[0]?.parsed_json, null);
  });

  it("ingest_refusal kinds unchanged — metadata failure is not a fifth refusal kind", () => {
    const sql = fs.readFileSync(
      path.join(ROOT, "src/svm-ingest/db/schema.sql"),
      "utf8",
    );
    const match = sql.match(/refusal_kind IN \(([\s\S]*?)\)/);
    assert.ok(match);
    assert.match(match![1]!, /log_truncated/);
    assert.match(match![1]!, /sequence_gap/);
    assert.doesNotMatch(match![1]!, /metadata_unavailable/);
  });
});
