import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeEventPayloadBody,
  tokenIdFromBytes32,
} from "../lib/svm/event-payload-decode.js";
import {
  buildPassportUriUpdatedBody,
  buildRecordAppendedBody,
  globalTokenId,
  PASSPORT_URI_UPDATED_DISC,
  RECORD_APPENDED_DISC,
} from "./fixtures/svm-ingest/borsh-fixtures.js";
import { FIXTURE_NAMESPACE } from "./fixtures/svm-ingest/fixture-block.js";

describe("svm event payload decode", () => {
  const tokenId = globalTokenId(FIXTURE_NAMESPACE, 42);

  it("decodes RecordAppended fields", () => {
    const body = buildRecordAppendedBody({
      tokenId,
      recordType: "attestation",
      description: "decoded",
      evidenceCID: "ar://evidence",
    });
    const payload = Buffer.concat([Buffer.from(RECORD_APPENDED_DISC, "hex"), body]);
    const decoded = decodeEventPayloadBody({
      contractName: "KarPassport",
      eventName: "RecordAppended",
      payloadBytes: payload,
    });
    assert.equal(decoded.event, "RecordAppended");
    assert.equal(
      tokenIdFromBytes32(decoded.fields.find((f) => f.name === "tokenId")!.value as Uint8Array),
      tokenId.toString(),
    );
    assert.equal(
      decoded.fields.find((f) => f.name === "recordType")?.value,
      "attestation",
    );
  });

  it("decodes PassportURIUpdated with previousUri chain in projector", () => {
    const body = buildPassportUriUpdatedBody({
      tokenId,
      newUri: "ar://uri-a",
    });
    const payload = Buffer.concat([Buffer.from(PASSPORT_URI_UPDATED_DISC, "hex"), body]);
    const decoded = decodeEventPayloadBody({
      contractName: "KarPassport",
      eventName: "PassportURIUpdated",
      payloadBytes: payload,
    });
    assert.equal(
      decoded.fields.find((f) => f.name === "newURI")?.value,
      "ar://uri-a",
    );
  });
});
