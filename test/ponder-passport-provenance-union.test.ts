/**
 * Live UNION + pagination + EVM identity proofs for passport provenance (S7c-2).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { replaceBigInts } from "ponder";

import {
  buildUnionPassportRecordsSql,
  loadAttestationsByAuthor,
  loadPassportRecordsByTokenId,
} from "../src/lib/ponder-passport-provenance.js";
import {
  attestationFromRecord,
  createProvenanceMemoryPool,
  naiveMergeAttestations,
} from "./fixtures/provenance-memory-pool.js";
import {
  FIXTURE_NAMESPACE,
  FIXTURE_TOKEN_ID,
} from "./fixtures/svm-ingest/fixture-block.js";

const HUB = 84532;
const AUTHOR = "0xverifier00000000000000000000000000000001";
const tokenId = FIXTURE_TOKEN_ID.toString();
const NS = [HUB, FIXTURE_NAMESPACE];

function jsonBody<T>(value: T): T {
  return replaceBigInts(value, (v) => String(v)) as T;
}

describe("ponder passport provenance union", () => {
  const evmRecords = [
    {
      id: "evm-r1",
      tokenId,
      chainId: HUB,
      author: AUTHOR,
      recordType: "attestation",
      description: "hub attestation",
      evidenceCID: "ar://evm-1",
      timestamp: 3000n,
    },
    {
      id: "evm-r2",
      tokenId,
      chainId: HUB,
      author: AUTHOR,
      recordType: "attestation",
      description: "hub older",
      evidenceCID: "ar://evm-2",
      timestamp: 1000n,
    },
  ];

  const svmRecords = [
    {
      id: "svm-r1",
      tokenId,
      chainId: FIXTURE_NAMESPACE,
      author: AUTHOR,
      recordType: "attestation",
      description: "svm attestation",
      evidenceCID: "ar://svm-attestation",
      timestamp: 500010n,
    },
    {
      id: "svm-r2",
      tokenId,
      chainId: FIXTURE_NAMESPACE,
      author: AUTHOR,
      recordType: "attestation",
      description: "svm second",
      evidenceCID: "ar://svm-2",
      timestamp: 500005n,
    },
  ];

  const pool = createProvenanceMemoryPool({
    evmRecords,
    svmRecords,
  });

  it("UNION SQL is a single statement with UNION ALL", () => {
    const { sql } = buildUnionPassportRecordsSql({
      tokenId,
      namespaces: NS,
      includeSvmProjection: true,
    });
    assert.match(sql, /UNION ALL/);
    assert.doesNotMatch(sql, /;\s*SELECT/);
  });

  it("live union returns EVM + SVM provenance for one tokenId", async () => {
    const records = await loadPassportRecordsByTokenId(
      tokenId,
      { namespaces: NS },
      pool,
    );
    const chainIds = [...new Set(records.map((r) => r.chainId))].sort((a, b) => a - b);
    assert.deepEqual(chainIds, [HUB, FIXTURE_NAMESPACE]);
    assert.equal(records.length, 4);
  });

  it("negative control: omitting SVM arm drops SVM row", async () => {
    const records = await loadPassportRecordsByTokenId(
      tokenId,
      { namespaces: NS, includeSvmProjection: false },
      pool,
    );
    assert.throws(() => {
      assert.ok(records.some((r) => r.chainId === FIXTURE_NAMESPACE));
    });
    assert.equal(records.length, 2);
    assert.ok(records.every((r) => r.chainId === HUB));
  });

  it("pagination: naive per-side merge differs from single UNION", async () => {
    const evmAtt = evmRecords.map(attestationFromRecord);
    const svmAtt = svmRecords.map(attestationFromRecord);
    const naive = naiveMergeAttestations(evmAtt, svmAtt, 2, 1);
    const unioned = await loadAttestationsByAuthor(
      AUTHOR,
      { limit: 2, offset: 1, namespaces: NS },
      pool,
    );

    assert.notDeepEqual(
      naive.map((r) => r.description),
      unioned.map((r) => r.description),
    );
    assert.deepEqual(
      unioned.map((r) => r.description),
      ["svm second", "hub attestation"],
    );
    assert.deepEqual(
      naive.map((r) => r.description),
      ["svm second", "hub older"],
    );
  });

  it("EVM-only baseline JSON identity when SVM projection is empty", async () => {
    const emptySvmPool = createProvenanceMemoryPool({
      evmRecords,
      svmRecords: [],
    });
    const withSvmPool = createProvenanceMemoryPool({
      evmRecords,
      svmRecords,
    });

    const baselineRecords = await loadPassportRecordsByTokenId(
      tokenId,
      { namespaces: [HUB], includeSvmProjection: false },
      emptySvmPool,
    );
    const emptySvmUnion = await loadPassportRecordsByTokenId(
      tokenId,
      { namespaces: [HUB], includeSvmProjection: true },
      emptySvmPool,
    );
    const populated = await loadPassportRecordsByTokenId(
      tokenId,
      { namespaces: NS },
      withSvmPool,
    );

    const baselineJson = JSON.stringify(
      jsonBody({ records: baselineRecords, uriHistory: [] }),
    );
    const emptyUnionJson = JSON.stringify(
      jsonBody({ records: emptySvmUnion, uriHistory: [] }),
    );
    assert.equal(baselineJson, emptyUnionJson);
    assert.notEqual(
      baselineJson,
      JSON.stringify(jsonBody({ records: populated, uriHistory: [] })),
    );
  });
});
