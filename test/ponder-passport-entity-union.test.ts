/**
 * Live UNION + ordering + aggregate proofs for passport entity (S7c-4).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { replaceBigInts } from "ponder";

import {
  buildPassportEntityUnionSubquery,
  loadPassportEntitiesBrowse,
  loadPassportEntitiesByOwner,
  loadPassportEntityById,
  type PassportEntityRow,
} from "../src/lib/ponder-passport-entity.js";
import {
  createEntityMemoryPool,
  naivePerSideEntityBrowse,
  naivePerSideStatusCounts,
  unionStatusCounts,
} from "./fixtures/entity-memory-pool.js";
import {
  FIXTURE_NAMESPACE,
  FIXTURE_TOKEN_ID,
} from "./fixtures/svm-ingest/fixture-block.js";

const HUB = 84532;
const tokenId = FIXTURE_TOKEN_ID.toString();
const NS = [HUB, FIXTURE_NAMESPACE];
const OWNER = "0xowner0000000000000000000000000000000001";

function entityRow(args: Partial<PassportEntityRow> & Pick<PassportEntityRow, "id" | "chainId" | "status">): PassportEntityRow {
  return {
    owner: OWNER,
    verifier: "",
    verifiedAt: 0n,
    tokenUri: "",
    coverPhotoUri: "",
    vin: "",
    make: "",
    model: "",
    year: 0,
    mileageKm: 0,
    lastDisputer: "",
    disputeReason: "",
    disputeWithdrawnAt: 0n,
    lastVerificationResetAt: 0n,
    duplicateVin: false,
    lastMetadataChangeAt: 0n,
    verificationResetCount: 0,
    hadDispute: false,
    lastDisputeResolvedAt: 0n,
    lastDisputeTerminal: "",
    disputeOpenedAt: 0n,
    fuelType: "",
    bodyType: "",
    transmission: "",
    condition: "",
    vehicleType: "",
    colour: "",
    locationLabel: "",
    locationPlaceId: "",
    locationCountryCode: "",
    disputeDeposit: null,
    createdAt: 1000n,
    updatedAt: 1000n,
    ...args,
  };
}

function jsonBody<T>(value: T): T {
  return replaceBigInts(value, (v) => String(v)) as T;
}

describe("ponder passport entity union", () => {
  const evmPassports = [
    entityRow({
      id: "evm-1",
      chainId: HUB,
      status: "UNVERIFIED",
      createdAt: 4000n,
    }),
    entityRow({
      id: "evm-2",
      chainId: HUB,
      status: "VERIFIED",
      createdAt: 2000n,
      verifier: "0xverifier00000000000000000000000000000001",
      verifiedAt: 2000n,
    }),
  ];

  const svmPassports = [
    entityRow({
      id: tokenId,
      chainId: FIXTURE_NAMESPACE,
      status: "DISPUTED",
      owner: "SvmOwnerBase58Fixture",
      createdAt: 3000n,
      make: "Fixture",
      model: "SVM",
      vin: "SVMFIXTUREVIN001",
    }),
    entityRow({
      id: "svm-2",
      chainId: FIXTURE_NAMESPACE,
      status: "VERIFIED",
      createdAt: 5000n,
      verifier: "0xverifier00000000000000000000000000000001",
      verifiedAt: 5000n,
    }),
  ];

  const pool = createEntityMemoryPool({ evmPassports, svmPassports });

  it("UNION SQL is a single statement with UNION ALL", () => {
    const sql = buildPassportEntityUnionSubquery(NS, true);
    assert.match(sql, /UNION ALL/);
    assert.doesNotMatch(sql, /;\s*SELECT/);
  });

  it("live union returns SVM-born row by tokenId", async () => {
    const row = await loadPassportEntityById(tokenId, { namespaces: NS }, pool);
    assert.ok(row);
    assert.equal(row!.chainId, FIXTURE_NAMESPACE);
    assert.equal(row!.make, "Fixture");
  });

  it("profile owner inventory spans SVM arm", async () => {
    const rows = await loadPassportEntitiesByOwner(
      "SvmOwnerBase58Fixture",
      { namespaces: NS },
      pool,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, tokenId);
  });

  it("ordering: naive per-side sort differs from union ORDER BY", async () => {
    const unioned = await loadPassportEntitiesBrowse(
      { verifiedFirst: true, limit: 3, offset: 0 },
      { namespaces: NS },
      pool,
    );
    const naive = naivePerSideEntityBrowse(
      { evmPassports, svmPassports },
      {
        namespaces: NS,
        verifiedFirst: true,
        limit: 3,
        offset: 0,
        countOnly: false,
        groupByStatus: false,
        verifiedOnly: false,
      },
    );

    assert.notDeepEqual(
      unioned.rows.map((r) => r.id),
      naive.map((r) => r.id),
    );
    assert.deepEqual(
      unioned.rows.map((r) => r.id),
      ["svm-2", "evm-2", "evm-1"],
    );
  });

  it("aggregate: per-side status fold can differ from union groupBy", () => {
    const naive = naivePerSideStatusCounts({ evmPassports, svmPassports }, {
      namespaces: NS,
    });
    const unioned = unionStatusCounts(
      { evmPassports, svmPassports },
      { namespaces: NS, includeSvm: true },
    );
    assert.deepEqual(naive, unioned);

    const skewedSvm = [
      ...svmPassports,
      entityRow({
        id: "svm-dup-status",
        chainId: FIXTURE_NAMESPACE,
        status: "VERIFIED",
        createdAt: 6000n,
      }),
    ];
    const unionCorrect = unionStatusCounts(
      { evmPassports, svmPassports: skewedSvm },
      { namespaces: NS, includeSvm: true },
    );
    assert.equal(unionCorrect.VERIFIED, 3);
  });

  it("negative control: omitting SVM arm drops SVM row", async () => {
    const row = await loadPassportEntityById(
      tokenId,
      { namespaces: NS, includeSvmProjection: false },
      pool,
    );
    assert.equal(row, null);
  });

  it("EVM-only baseline JSON identity when SVM projection is empty", async () => {
    const emptySvmPool = createEntityMemoryPool({ evmPassports, svmPassports: [] });
    const withSvmPool = createEntityMemoryPool({ evmPassports, svmPassports });

    const baseline = await loadPassportEntityById(
      "evm-2",
      { namespaces: [HUB], includeSvmProjection: false },
      emptySvmPool,
    );
    const emptyUnion = await loadPassportEntityById(
      "evm-2",
      { namespaces: [HUB], includeSvmProjection: true },
      emptySvmPool,
    );
    const populated = await loadPassportEntityById(
      tokenId,
      { namespaces: NS },
      withSvmPool,
    );

    assert.equal(
      JSON.stringify(jsonBody(baseline)),
      JSON.stringify(jsonBody(emptyUnion)),
    );
    assert.notEqual(baseline?.id, populated?.id);
  });
});
