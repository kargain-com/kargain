/**
 * Four named ingest refusals — distinct, observable.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTransactionForIngest } from "../lib/svm/parse-transaction-ingest.js";
import { SOLANA_LOG_LIMITS } from "../lib/svm/program-data-decode.js";
import {
  FIXTURE_BLOCK,
  FIXTURE_BLOCK_UNKNOWN_DISC,
  FIXTURE_FOLLOWED_PROGRAMS,
  FIXTURE_NAMESPACE,
  FIXTURE_PASSPORT_PROGRAM,
  passportMintedProgramDataLine,
} from "./fixtures/svm-ingest/fixture-block.js";

describe("svm raw ingest refusal", () => {
  it("log_truncated on failed transaction", () => {
    const parsed = parseTransactionForIngest({
      namespace: FIXTURE_NAMESPACE,
      slot: 1,
      txIndexInBlock: 0,
      txSignature: "failSig",
      logMessages: [],
      metaErr: { InstructionError: [0, "Custom"] },
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
    });
    assert.equal(parsed.payloads.length, 0);
    assert.equal(parsed.refusals[0]?.refusalKind, "log_truncated");
  });

  it("log_truncated when log line cap exceeded", () => {
    const logs = Array.from({ length: SOLANA_LOG_LIMITS.maxLogLines }, () => "Program log: x");
    const parsed = parseTransactionForIngest({
      namespace: FIXTURE_NAMESPACE,
      slot: 1,
      txIndexInBlock: 0,
      txSignature: "capSig",
      logMessages: logs,
      metaErr: null,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
    });
    assert.equal(parsed.refusals[0]?.refusalKind, "log_truncated");
  });

  it("payload_malformed on invalid base64", () => {
    const parsed = parseTransactionForIngest({
      namespace: FIXTURE_NAMESPACE,
      slot: 1,
      txIndexInBlock: 0,
      txSignature: "badB64",
      logMessages: [
        `Program ${FIXTURE_PASSPORT_PROGRAM} invoke [1]`,
        "Program data: !!!",
        `Program ${FIXTURE_PASSPORT_PROGRAM} success`,
      ],
      metaErr: null,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
    });
    assert.equal(parsed.refusals[0]?.refusalKind, "payload_malformed");
  });

  it("unknown_discriminator when disc not in manifest", () => {
    const tx = FIXTURE_BLOCK_UNKNOWN_DISC.transactions[0]!;
    const parsed = parseTransactionForIngest({
      namespace: FIXTURE_NAMESPACE,
      slot: FIXTURE_BLOCK_UNKNOWN_DISC.slot,
      txIndexInBlock: 0,
      txSignature: tx.signature,
      logMessages: tx.logMessages,
      metaErr: null,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
    });
    assert.equal(parsed.payloads.length, 0);
    assert.equal(parsed.refusals[0]?.refusalKind, "unknown_discriminator");
  });

  it("accepts known discriminator as structured payload", () => {
    const tx = FIXTURE_BLOCK.transactions[0]!;
    const parsed = parseTransactionForIngest({
      namespace: FIXTURE_NAMESPACE,
      slot: FIXTURE_BLOCK.slot,
      txIndexInBlock: 0,
      txSignature: tx.signature,
      logMessages: tx.logMessages,
      metaErr: null,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
    });
    assert.equal(parsed.payloads.length, 1);
    assert.equal(parsed.payloads[0]!.eventName, "PassportMinted");
    assert.equal(parsed.refusals.length, 0);
    assert.ok(passportMintedProgramDataLine().startsWith("Program data:"));
  });
});
