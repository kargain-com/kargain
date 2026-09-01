/**
 * S7a log budget decoder — fail-closed measurement gate (D-28).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertStructuredPayloadPresent,
  decodeProgramDataBase64,
  measureTxLogBudgetFromMeta,
  type TxLogBudget,
} from "../svm/stand/measure-tx-logs.ts";

/** Golden Agave-style line (payload = 4 zero bytes). */
const GOLDEN_LINE = `Program data: ${Buffer.from([0, 0, 0, 0]).toString("base64")}`;

describe("measure-tx-logs", () => {
  it("decodes base64 Program data line to byte length", () => {
    assert.equal(decodeProgramDataBase64(GOLDEN_LINE.slice("Program data: ".length)).length, 4);
  });

  it("malformed payload throws (not silent zero)", () => {
    assert.throws(
      () => decodeProgramDataBase64("!!!not-base64!!!"),
      /base64 alphabet invalid|decoded to zero bytes|empty Program data/,
    );
    assert.throws(() => decodeProgramDataBase64(""), /empty Program data/);
  });

  it("assertStructuredPayloadPresent rejects zero program-data lines", () => {
    const budget: TxLogBudget = {
      logMessageBytes: 100,
      logLineCount: 3,
      programDataBytes: 0,
      programDataLineCount: 0,
      computeUnits: 1,
    };
    assert.throws(
      () => assertStructuredPayloadPresent(budget, "fixture"),
      /no Program data: log lines/,
    );
  });

  it("assertStructuredPayloadPresent rejects decoded-zero budget", () => {
    const budget: TxLogBudget = {
      logMessageBytes: 100,
      logLineCount: 3,
      programDataBytes: 0,
      programDataLineCount: 1,
      computeUnits: 1,
    };
    assert.throws(
      () => assertStructuredPayloadPresent(budget, "fixture"),
      /programDataBytes=0/,
    );
  });

  it("measureTxLogBudgetFromMeta sums program-data bytes from log lines", () => {
    const budget = measureTxLogBudgetFromMeta({
      logMessages: ["invoke", GOLDEN_LINE, "success"],
      computeUnitsConsumed: 42,
    });
    assert.ok(budget);
    assert.equal(budget!.programDataLineCount, 1);
    assert.equal(budget!.programDataBytes, 4);
    assert.equal(budget!.logLineCount, 3);
    assert.equal(budget!.computeUnits, 42);
    assertStructuredPayloadPresent(budget!, "golden");
  });
});
