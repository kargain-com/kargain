/**
 * Sole owner of read-path readiness for Ponder HTTP UNION reads.
 *
 * Ponder reserved `/ready` answers sync state only. This owner proves that the
 * product read path can execute the same EVM + empty-SVM-arm SQL forms the API
 * serves, and names missing relations when the path is unreadable.
 */
import pg from "pg";

import { buildPassportEntityUnionSubquery, getEntityPool } from "./ponder-passport-entity.js";
import {
  buildUnionPassportRecordsSql,
  buildUnionUriHistorySql,
} from "./ponder-passport-provenance.js";
import { indexerReadNamespaceIds } from "./ponder-read-namespaces.js";

export const READ_PATH_REQUIRED_RELATIONS = [
  "kargain.consignment",
  "kargain.passport",
  "kargain.passport_record",
  "kargain.passport_uri_history",
  "kargain.bridge_crossing",
  "kargain.custody_determining_event",
  "kargain_svm_projection.passport",
  "kargain_svm_projection.passport_record",
  "kargain_svm_projection.passport_uri_history",
  "kargain_svm_projection.custody_determining_event",
] as const;

export const READ_PATH_PROBE_NAMES = [
  "passport_entity_union",
  "consignment_entity_union_join",
  "passport_record_union",
  "passport_uri_history_union",
  "passport_custody_sources",
] as const;

export type ReadPathProbeName = (typeof READ_PATH_PROBE_NAMES)[number];

export type ReadPathReadyResult =
  | {
      ready: true;
      checkedRelations: readonly string[];
      probeQueries: readonly ReadPathProbeName[];
    }
  | {
      ready: false;
      checkedRelations: readonly string[];
      missingRelations: string[];
    };

async function missingRelations(pool: pg.Pool): Promise<string[]> {
  const checks = await Promise.all(
    READ_PATH_REQUIRED_RELATIONS.map(async (rel) => {
      const res = await pool.query<{ reg: string | null }>(
        "SELECT to_regclass($1::text) AS reg",
        [rel],
      );
      return res.rows[0]?.reg == null ? rel : null;
    }),
  );
  const absent: string[] = [];
  for (const rel of checks) {
    if (rel != null) absent.push(rel);
  }
  absent.sort();
  return absent;
}

async function runProbeQueries(
  pool: pg.Pool,
  namespaces: readonly number[],
): Promise<readonly ReadPathProbeName[]> {
  const entitySql = `SELECT 1
    FROM ${buildPassportEntityUnionSubquery(namespaces, true)} AS passport_union
    LIMIT 0`;
  const provenanceSql = buildUnionPassportRecordsSql({
    tokenId: "0",
    namespaces,
    includeSvmProjection: true,
    limit: 0,
  });
  const uriSql = buildUnionUriHistorySql({
    tokenId: "0",
    namespaces,
    includeSvmProjection: true,
  });
  const browseSql = `SELECT c.id
    FROM kargain.consignment c
    LEFT JOIN ${buildPassportEntityUnionSubquery(namespaces, true)} p ON c.token_id = p.id
    LIMIT 0`;
  const custodySql = `SELECT token_id
    FROM kargain.custody_determining_event
    WHERE token_id = $1
    UNION ALL
    SELECT token_id
    FROM kargain_svm_projection.custody_determining_event
    WHERE token_id = $1 AND chain_id = ANY($2::int[])
    UNION ALL
    SELECT token_id
    FROM kargain.bridge_crossing
    WHERE token_id = $1
    LIMIT 0`;

  await Promise.all([
    pool.query(entitySql),
    pool.query(browseSql),
    pool.query(provenanceSql.sql, provenanceSql.params),
    pool.query(uriSql.sql, uriSql.params),
    pool.query(custodySql, ["0", [...namespaces]]),
  ]);

  return READ_PATH_PROBE_NAMES;
}

export async function resolveReadPathReadiness(
  pool: pg.Pool = getEntityPool(),
): Promise<ReadPathReadyResult> {
  const absent = await missingRelations(pool);
  if (absent.length > 0) {
    return {
      ready: false,
      checkedRelations: READ_PATH_REQUIRED_RELATIONS,
      missingRelations: absent,
    };
  }

  const namespaces = indexerReadNamespaceIds();
  const probeQueries = await runProbeQueries(pool, namespaces);
  return {
    ready: true,
    checkedRelations: READ_PATH_REQUIRED_RELATIONS,
    probeQueries,
  };
}
