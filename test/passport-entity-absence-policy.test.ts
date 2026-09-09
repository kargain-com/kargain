/**
 * Named passport entity absence — discriminant decides; emptiness does not.
 * Outcomes identical for EVM and SVM namespaces.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeEventPayloadBody } from "../lib/svm/event-payload-decode.js";
import {
  emptyEntityProjectionReplayState,
  projectEntityFromPayload,
} from "../lib/svm/passport-entity-projection.js";
import type { RawPayloadForProjection } from "../lib/svm/projection-common.js";
import { parsePassportEntityOrigin } from "../lib/passport/passport-entity-origin.js";
import {
  classifyPassportEntityRow,
  resolvePassportEntityById,
  type PassportEntityRow,
} from "../src/lib/ponder-passport-entity.js";
import { createEntityPgPoolForTests } from "./fixtures/entity-pg-pool.js";
import {
  buildPassportMintedBody,
  buildPassportUriUpdatedBody,
  decodeFixturePayload,
  PASSPORT_MINTED_DISC,
  PASSPORT_URI_UPDATED_DISC,
} from "./fixtures/svm-ingest/borsh-fixtures.js";
import {
  FIXTURE_NAMESPACE,
  FIXTURE_TOKEN_ID,
} from "./fixtures/svm-ingest/fixture-block.js";

const HUB = 84532;
const OWNER = "0xowner0000000000000000000000000000000001";
const tokenId = FIXTURE_TOKEN_ID.toString();

function entityRow(
  args: Partial<PassportEntityRow> &
    Pick<PassportEntityRow, "id" | "chainId" | "entityOrigin" | "status">,
): PassportEntityRow {
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

function rawBase(eventName: string, logIndex: number, payloadBytes: Buffer): RawPayloadForProjection {
  return {
    id: `raw-${eventName}-${logIndex}`,
    namespace: FIXTURE_NAMESPACE,
    slot: 100,
    txIndexInBlock: 0,
    logIndex,
    contractName: "KarPassport",
    eventName,
    payloadBytes,
  };
}

describe("passport entity named absence (VM-neutral)", () => {
  it("unknown token → not_found on EVM and SVM namespaces identically", async () => {
    const { pool } = await createEntityPgPoolForTests({
      evmPassports: [],
      svmPassports: [],
    });
    const unknown = "99999999999999999999999999999999999999";

    const evm = await resolvePassportEntityById(
      unknown,
      { namespaces: [HUB], includeSvmProjection: true },
      pool,
    );
    const svm = await resolvePassportEntityById(
      unknown,
      { namespaces: [FIXTURE_NAMESPACE], includeSvmProjection: true },
      pool,
    );

    assert.equal(evm.kind, "not_found");
    assert.equal(svm.kind, "not_found");
    assert.deepEqual(evm, svm);
  });

  it("pre-mint accumulator → not_indexed on EVM and SVM identically", async () => {
    const evmPre = entityRow({
      id: "evm-pre",
      chainId: HUB,
      entityOrigin: "pre_mint",
      status: "VERIFIED",
      owner: OWNER,
      tokenUri: "ar://populated",
      make: "Populated",
    });
    const svmPre = entityRow({
      id: tokenId,
      chainId: FIXTURE_NAMESPACE,
      entityOrigin: "pre_mint",
      status: "VERIFIED",
      owner: "SvmOwner",
      tokenUri: "ar://populated",
      make: "Populated",
    });
    const { pool } = await createEntityPgPoolForTests({
      evmPassports: [evmPre],
      svmPassports: [svmPre],
    });

    const evm = await resolvePassportEntityById(
      "evm-pre",
      { namespaces: [HUB, FIXTURE_NAMESPACE] },
      pool,
    );
    const svm = await resolvePassportEntityById(
      tokenId,
      { namespaces: [HUB, FIXTURE_NAMESPACE] },
      pool,
    );

    assert.equal(evm.kind, "not_indexed");
    assert.equal(svm.kind, "not_indexed");
  });

  it("minted sparse → found; pre_mint populated → still not_indexed (discriminant wins)", () => {
    const sparseMinted = entityRow({
      id: "sparse",
      chainId: HUB,
      entityOrigin: "minted",
      status: "UNVERIFIED",
      owner: OWNER,
      tokenUri: "",
      make: "",
    });
    const populatedPre = entityRow({
      id: "pre-pop",
      chainId: HUB,
      entityOrigin: "pre_mint",
      status: "VERIFIED",
      owner: OWNER,
      tokenUri: "ar://full",
      make: "Honda",
      model: "Civic",
      vin: "VIN123",
    });

    assert.equal(classifyPassportEntityRow(sparseMinted).kind, "found");
    assert.equal(classifyPassportEntityRow(populatedPre).kind, "not_indexed");
  });

  it("entity row without discriminant value fails", () => {
    assert.throws(
      () => parsePassportEntityOrigin(undefined),
      /passport_entity_origin_unlabeled/,
    );
    assert.throws(
      () => parsePassportEntityOrigin(""),
      /passport_entity_origin_unlabeled/,
    );
    assert.throws(
      () => parsePassportEntityOrigin("accumulator"),
      /passport_entity_origin_unlabeled/,
    );
  });

  it("same token transitions pre_mint → minted through the reducer", () => {
    const state = emptyEntityProjectionReplayState();
    const tid = FIXTURE_TOKEN_ID;

    const uriPayload = Buffer.concat([
      Buffer.from(PASSPORT_URI_UPDATED_DISC, "hex"),
      decodeFixturePayload({
        discriminatorHex: PASSPORT_URI_UPDATED_DISC,
        body: buildPassportUriUpdatedBody({
          tokenId: tid,
          newUri: "ar://pre-mint-uri",
        }),
      }),
    ]);
    const uriDecoded = decodeEventPayloadBody({
      contractName: "KarPassport",
      eventName: "PassportURIUpdated",
      payloadBytes: uriPayload,
    });
    assert.ok(uriDecoded);
    const uriRow = projectEntityFromPayload(
      rawBase("PassportURIUpdated", 0, uriPayload),
      uriDecoded,
      state,
    );
    assert.ok(uriRow);
    assert.equal(uriRow.entityOrigin, "pre_mint");
    assert.equal(classifyPassportEntityRow(uriRow).kind, "not_indexed");

    const mintPayload = Buffer.concat([
      Buffer.from(PASSPORT_MINTED_DISC, "hex"),
      decodeFixturePayload({
        discriminatorHex: PASSPORT_MINTED_DISC,
        body: buildPassportMintedBody({
          tokenId: tid,
          uri: "ar://minted-uri",
        }),
      }),
    ]);
    const mintDecoded = decodeEventPayloadBody({
      contractName: "KarPassport",
      eventName: "PassportMinted",
      payloadBytes: mintPayload,
    });
    assert.ok(mintDecoded);
    const mintedRow = projectEntityFromPayload(
      rawBase("PassportMinted", 1, mintPayload),
      mintDecoded,
      state,
    );
    assert.ok(mintedRow);
    assert.equal(mintedRow.entityOrigin, "minted");
    assert.equal(classifyPassportEntityRow(mintedRow).kind, "found");
    assert.equal(state.entities.get(tokenId)?.entityOrigin, "minted");
  });
});
