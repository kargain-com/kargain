/**
 * Writer-local ordering key — slot, tx_index_in_block, log_index admits no ties.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { structuredPayloadRowId } from "../lib/svm/ingest-refusal.js";
import { parseTransactionForIngest } from "../lib/svm/parse-transaction-ingest.js";
import {
  FIXTURE_BLOCK,
  FIXTURE_FOLLOWED_PROGRAMS,
  FIXTURE_NAMESPACE,
  FIXTURE_PASSPORT_PROGRAM,
  passportMintedProgramDataLine,
} from "./fixtures/svm-ingest/fixture-block.js";

describe("svm raw ordering", () => {
  it("row ids differ by log_index within same tx", () => {
    const logs = [
      `Program ${FIXTURE_PASSPORT_PROGRAM} invoke [1]`,
      passportMintedProgramDataLine(),
      passportMintedProgramDataLine(),
      `Program ${FIXTURE_PASSPORT_PROGRAM} success`,
    ];
    const parsed = parseTransactionForIngest({
      namespace: FIXTURE_NAMESPACE,
      slot: 100,
      txIndexInBlock: 2,
      txSignature: "multiLogSig",
      logMessages: logs,
      metaErr: null,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
    });
    assert.equal(parsed.payloads.length, 2);
    assert.notEqual(parsed.payloads[0]!.id, parsed.payloads[1]!.id);
    assert.equal(parsed.payloads[0]!.logIndex, 1);
    assert.equal(parsed.payloads[1]!.logIndex, 2);
  });

  it("row ids differ by tx_index within same slot", () => {
    const ids = [0, 1].map((txIndex) =>
      structuredPayloadRowId({
        namespace: FIXTURE_NAMESPACE,
        slot: FIXTURE_BLOCK.slot,
        txIndexInBlock: txIndex,
        logIndex: 1,
      }),
    );
    assert.notEqual(ids[0], ids[1]);
  });

  it("sort order is slot then tx_index then log_index", () => {
    const rows = [
      { slot: 2, txIndexInBlock: 0, logIndex: 0 },
      { slot: 1, txIndexInBlock: 99, logIndex: 99 },
      { slot: 2, txIndexInBlock: 1, logIndex: 0 },
    ].map((r) => ({ ...r, key: `${r.slot}:${r.txIndexInBlock}:${r.logIndex}` }));
    rows.sort((a, b) => {
      if (a.slot !== b.slot) return a.slot - b.slot;
      if (a.txIndexInBlock !== b.txIndexInBlock) return a.txIndexInBlock - b.txIndexInBlock;
      return a.logIndex - b.logIndex;
    });
    assert.deepEqual(
      rows.map((r) => r.key),
      ["1:99:99", "2:0:0", "2:1:0"],
    );
  });
});
