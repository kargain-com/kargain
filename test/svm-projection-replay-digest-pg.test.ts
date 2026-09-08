/**
 * Full projection digest: table/column coverage refuse, mutate-projection,
 * mutate-raw→replay, undefined value type.
 * Requires Postgres — RAW_SENTINEL_DATABASE_URL or docker postgres:16 on :55432.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import {
  ProjectionDigestAbsentColumnError,
  ProjectionDigestUncoveredColumnError,
  ProjectionDigestUncoveredTableError,
  assertProjectionDigestCoversTables,
} from "../lib/svm/svm-projection-catalog.ts";
import {
  ProjectionDigestUndefinedValueTypeError,
  assertProjectionDigestCoversLiveSchema,
  normalizeCanonicalValue,
  projectionReplayDigestFromPool,
} from "../lib/svm/projection-replay-digest.ts";
import { rebuildProjectionFromRaw } from "../src/svm-ingest/projection-rebuild.ts";
import {
  applySvmRawSchema,
  createSvmRawWriter,
} from "../src/lib/svm-raw-writer.ts";
import {
  FIXTURE_NAMESPACE,
  FIXTURE_PASSPORT_PROGRAM,
  FIXTURE_TOKEN_ID,
} from "./fixtures/svm-ingest/fixture-block.ts";
import {
  buildPassportMintedBody,
  PASSPORT_MINTED_DISC,
} from "./fixtures/svm-ingest/borsh-fixtures.ts";

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

async function seedMintPayload(pool: pg.Pool): Promise<void> {
  const disc = Buffer.from(PASSPORT_MINTED_DISC, "hex");
  const body = buildPassportMintedBody({
    tokenId: FIXTURE_TOKEN_ID,
    uri: "ar://digest-control-uri",
  });
  const writer = createSvmRawWriter(pool);
  await writer.insertStructuredPayload({
    id: `${FIXTURE_NAMESPACE}:500001:0:1`,
    namespace: FIXTURE_NAMESPACE,
    slot: 500_001,
    txIndexInBlock: 0,
    logIndex: 1,
    txSignature: "digestCtrlMintSig111111111111111111111111111111111111111",
    emittingProgram: FIXTURE_PASSPORT_PROGRAM,
    discriminator: disc,
    eventName: "PassportMinted",
    contractName: "KarPassport",
    payloadBytes: Buffer.concat([disc, body]),
  });
}

describe("svm projection replay digest (real Postgres)", async () => {
  const reachable = await canConnect(DATABASE_URL);
  if (!reachable) {
    it("SKIP — no Postgres at RAW_SENTINEL_DATABASE_URL / 127.0.0.1:55432", () => {
      assert.fail(
        "projection digest SQL controls require a real Postgres engine (start docker postgres:16 on :55432)",
      );
    });
    return;
  }

  let pool: pg.Pool;

  before(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    await pool.query(`DROP SCHEMA IF EXISTS kargain_svm_projection CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS kargain_svm_raw CASCADE`);
    await applySvmRawSchema(pool);
    await seedMintPayload(pool);
  });

  after(async () => {
    await pool.end();
  });

  it("live schema coverage assert passes after rebuild", async () => {
    await rebuildProjectionFromRaw(pool, FIXTURE_NAMESPACE);
    const live = await assertProjectionDigestCoversLiveSchema(pool);
    assert.ok(live.includes("passport"));
    assert.ok(live.includes("custody_determining_event"));
  });

  it("uncovered live table refuses by name (RED then green)", async () => {
    await rebuildProjectionFromRaw(pool, FIXTURE_NAMESPACE);
    await pool.query(`
      CREATE TABLE kargain_svm_projection.orphan_projection_table (
        id TEXT PRIMARY KEY
      )
    `);
    await assert.rejects(
      () => projectionReplayDigestFromPool(pool, FIXTURE_NAMESPACE),
      (err: unknown) => {
        assert.ok(err instanceof ProjectionDigestUncoveredTableError);
        assert.equal(err.uncoveredTable, "orphan_projection_table");
        assert.match(
          err.message,
          /projection_digest_uncovered_table: orphan_projection_table/,
        );
        return true;
      },
    );
    await pool.query(
      `DROP TABLE kargain_svm_projection.orphan_projection_table`,
    );
    const ok = await projectionReplayDigestFromPool(pool, FIXTURE_NAMESPACE);
    assert.equal(typeof ok.digest, "string");
    assert.equal(ok.digest.length, 64);
    assert.ok(ok.countsByKind.passport >= 1);
    assert.ok(ok.countsByKind.custody_determining_event >= 1);
  });

  it("uncovered live column refuses by name (RED then green)", async () => {
    await rebuildProjectionFromRaw(pool, FIXTURE_NAMESPACE);
    await pool.query(
      `ALTER TABLE kargain_svm_projection.passport ADD COLUMN orphan_digest_column TEXT`,
    );
    await assert.rejects(
      () => projectionReplayDigestFromPool(pool, FIXTURE_NAMESPACE),
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
    await pool.query(
      `ALTER TABLE kargain_svm_projection.passport DROP COLUMN orphan_digest_column`,
    );
    const ok = await projectionReplayDigestFromPool(pool, FIXTURE_NAMESPACE);
    assert.equal(ok.digest.length, 64);
  });

  it("absent covered column refuses by name (RED then green)", async () => {
    await rebuildProjectionFromRaw(pool, FIXTURE_NAMESPACE);
    await pool.query(
      `ALTER TABLE kargain_svm_projection.passport DROP COLUMN colour`,
    );
    await assert.rejects(
      () => projectionReplayDigestFromPool(pool, FIXTURE_NAMESPACE),
      (err: unknown) => {
        assert.ok(err instanceof ProjectionDigestAbsentColumnError);
        assert.equal(err.table, "passport");
        assert.equal(err.absentColumn, "colour");
        assert.match(
          err.message,
          /projection_digest_absent_column: passport\.colour/,
        );
        return true;
      },
    );
    await rebuildProjectionFromRaw(pool, FIXTURE_NAMESPACE);
    const ok = await projectionReplayDigestFromPool(pool, FIXTURE_NAMESPACE);
    assert.equal(ok.digest.length, 64);
  });

  it("undefined value type refuses by name (RED then green)", () => {
    assert.throws(
      () => normalizeCanonicalValue("verified_at", new Date(1)),
      (err: unknown) => {
        assert.ok(err instanceof ProjectionDigestUndefinedValueTypeError);
        assert.match(
          err.message,
          /projection_digest_undefined_value_type: verified_at:Date/,
        );
        return true;
      },
    );
    assert.equal(normalizeCanonicalValue("verified_at", 0), 0);
    assert.equal(normalizeCanonicalValue("owner", "x"), "x");
    assert.equal(normalizeCanonicalValue("duplicate_vin", false), false);
    assert.equal(normalizeCanonicalValue("dispute_deposit", null), null);
  });

  it("mutated projection row changes digest; rebuild restores", async () => {
    await rebuildProjectionFromRaw(pool, FIXTURE_NAMESPACE);
    const before = await projectionReplayDigestFromPool(pool, FIXTURE_NAMESPACE);
    assert.notEqual(before.digest, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

    await pool.query(
      `UPDATE kargain_svm_projection.passport SET owner = 'mutated-owner' WHERE chain_id = $1`,
      [FIXTURE_NAMESPACE],
    );
    const mutated = await projectionReplayDigestFromPool(pool, FIXTURE_NAMESPACE);
    assert.notEqual(mutated.digest, before.digest);

    await rebuildProjectionFromRaw(pool, FIXTURE_NAMESPACE);
    const restored = await projectionReplayDigestFromPool(pool, FIXTURE_NAMESPACE);
    assert.equal(restored.digest, before.digest);
  });

  it("different raw seed changes replayed digest (ephemeral reseed; never UPDATE live raw)", async () => {
    await rebuildProjectionFromRaw(pool, FIXTURE_NAMESPACE);
    const before = await projectionReplayDigestFromPool(pool, FIXTURE_NAMESPACE);

    // Append-only triggers refuse UPDATE/DELETE — reseed ephemeral raw with a
    // different PassportMinted body (production live raw is never rewritten).
    await pool.query(`DROP SCHEMA IF EXISTS kargain_svm_raw CASCADE`);
    await applySvmRawSchema(pool);
    const disc = Buffer.from(PASSPORT_MINTED_DISC, "hex");
    const body = buildPassportMintedBody({
      tokenId: FIXTURE_TOKEN_ID + 1n,
      uri: "ar://digest-control-uri-mutated",
      toSeed: 9,
    });
    const writer = createSvmRawWriter(pool);
    await writer.insertStructuredPayload({
      id: `${FIXTURE_NAMESPACE}:500002:0:1`,
      namespace: FIXTURE_NAMESPACE,
      slot: 500_002,
      txIndexInBlock: 0,
      logIndex: 1,
      txSignature: "digestCtrlMintSig222222222222222222222222222222222222222",
      emittingProgram: FIXTURE_PASSPORT_PROGRAM,
      discriminator: disc,
      eventName: "PassportMinted",
      contractName: "KarPassport",
      payloadBytes: Buffer.concat([disc, body]),
    });

    await rebuildProjectionFromRaw(pool, FIXTURE_NAMESPACE);
    const after = await projectionReplayDigestFromPool(pool, FIXTURE_NAMESPACE);
    assert.notEqual(
      after.digest,
      before.digest,
      "replay after raw reseed must not preserve prior projection digest",
    );
  });

  it("assertProjectionDigestCoversTables green on catalog-only set", () => {
    assert.doesNotThrow(() =>
      assertProjectionDigestCoversTables([
        "custody_determining_event",
        "passport",
        "passport_record",
        "passport_uri_history",
      ]),
    );
  });
});
