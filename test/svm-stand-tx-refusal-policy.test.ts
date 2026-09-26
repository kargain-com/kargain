/**
 * Stand transaction-refusal owner — in-memory reds (no validator).
 *
 * 1. Successful send when InvalidSeeds expected → red (expected + succeeded)
 * 2. Wrong native thrown when InvalidSeeds expected → red (expected vs observed)
 * 3. Wrong Custom name when InvalidReceiver expected → red (both names)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  expectStandTransactionRefusal,
  parseStandInstructionError,
} from "../svm/stand/stand-tx-refusal.ts";

describe("svm-stand-tx-refusal-policy", () => {
  it("successful send when InvalidSeeds expected fails with succeeded (red→green)", async () => {
    await assert.rejects(
      () =>
        expectStandTransactionRefusal({
          send: async () => "ok-signature",
          expected: { kind: "native", name: "InvalidSeeds" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /InvalidSeeds/);
        assert.match(err.message, /succeeded/);
        return true;
      },
    );
  });

  it("wrong native MissingRequiredSignature when InvalidSeeds expected fails with both (red→green)", async () => {
    await assert.rejects(
      () =>
        expectStandTransactionRefusal({
          send: async () => {
            throw {
              InstructionError: [0, "MissingRequiredSignature"],
            };
          },
          expected: { kind: "native", name: "InvalidSeeds" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /InvalidSeeds/);
        assert.match(err.message, /MissingRequiredSignature/);
        return true;
      },
    );
  });

  it("wrong Custom name when InvalidReceiver expected fails with both names (red→green)", async () => {
    // AssetFrozen = 137
    await assert.rejects(
      () =>
        expectStandTransactionRefusal({
          send: async () => {
            throw {
              InstructionError: [0, { Custom: 137 }],
            };
          },
          expected: { kind: "custom", name: "InvalidReceiver" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /InvalidReceiver/);
        assert.match(err.message, /AssetFrozen/);
        return true;
      },
    );
  });

  it("parseStandInstructionError: structured native + Custom + JSON blob; no free-text native regex", () => {
    assert.deepEqual(
      parseStandInstructionError({
        InstructionError: [2, "InvalidSeeds"],
      }),
      { kind: "native", name: "InvalidSeeds", index: 2 },
    );
    assert.deepEqual(
      parseStandInstructionError({
        err: { InstructionError: [0, { Custom: 144 }] },
      }),
      { kind: "custom", name: "InvalidReceiver", ordinal: 144, index: 0 },
    );
    assert.deepEqual(
      parseStandInstructionError(
        new Error(
          'stand_tx_failed: signature=x err={"InstructionError":[1,"AccountAlreadyInitialized"]}',
        ),
      ),
      {
        kind: "native",
        name: "AccountAlreadyInitialized",
        index: 1,
      },
    );
    // Free-text "InvalidSeeds" in a success-shaped assert message must NOT parse as native
    assert.equal(
      parseStandInstructionError(new Error("expected InvalidSeeds")),
      null,
    );
    // Solana ProgramError Display (preflight) → native discriminant
    assert.deepEqual(
      parseStandInstructionError(
        new Error(
          "Transaction simulation failed: Error processing Instruction 0: Provided seeds do not result in a valid address",
        ),
      ),
      { kind: "native", name: "InvalidSeeds", index: 0 },
    );
  });
});
