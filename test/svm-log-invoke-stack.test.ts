/**
 * Invoke stack attributes Program data to innermost followed program.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProgramDataFromLogMessages } from "../lib/svm/log-invoke-stack.js";
import {
  FIXTURE_BLOCK,
  FIXTURE_PASSPORT_PROGRAM,
} from "./fixtures/svm-ingest/fixture-block.js";

describe("svm log invoke stack", () => {
  it("attributes program data to inner invoke program", () => {
    const tx = FIXTURE_BLOCK.transactions[0]!;
    const followed = new Set([FIXTURE_PASSPORT_PROGRAM]);
    const parsed = parseProgramDataFromLogMessages(tx.logMessages, followed);
    assert.equal(parsed.lines.length, 1);
    assert.equal(parsed.lines[0]!.emittingProgram, FIXTURE_PASSPORT_PROGRAM);
    assert.equal(parsed.lines[0]!.logIndex, 1);
  });

  it("ignores program data from unfollowed programs", () => {
    const logs = [
      "Program UnfollowedProg111111111111111111111111 invoke [1]",
      "Program data: AQID",
      "Program UnfollowedProg111111111111111111111111 success",
    ];
    const parsed = parseProgramDataFromLogMessages(logs, new Set([FIXTURE_PASSPORT_PROGRAM]));
    assert.equal(parsed.lines.length, 0);
  });

  it("nested CPI attributes to inner program", () => {
    const inner = FIXTURE_PASSPORT_PROGRAM;
    const outer = "OuterProg111111111111111111111111111111111";
    const logs = [
      `Program ${outer} invoke [1]`,
      `Program ${inner} invoke [2]`,
      "Program data: AQIDBA==",
      `Program ${inner} success`,
      `Program ${outer} success`,
    ];
    const parsed = parseProgramDataFromLogMessages(logs, new Set([inner]));
    assert.equal(parsed.lines[0]!.emittingProgram, inner);
  });
});
