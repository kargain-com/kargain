/**
 * Stand transaction-refusal owner — in-memory reds (no validator).
 *
 * 1. landed_ok when InvalidSeeds expected → red (succeeded)
 * 2. landed_with_error wrong native → red (both names)
 * 3. Custom wrong name → red (both names)
 * 4. stand_blockhash_expired when program error expected → red (named confirm)
 * 5. Prose Display / JSON-in-message / invent-index → null (fallbacks gone)
 * 6. Typed boundary: no eslint-disable / public `: any` under svm/stand
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  expectStandTransactionRefusal,
  parseStandInstructionError,
} from "../svm/stand/stand-tx-refusal.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAND_DIR = join(ROOT, "svm/stand");

function walkStandTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkStandTs(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Plantable: eslint-disable or public `: any` export under stand sources. */
export function findStandTypedBoundaryViolations(
  sources: ReadonlyArray<{ path: string; text: string }>,
): string[] {
  const violations: string[] = [];
  for (const { path: filePath, text } of sources) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const loc = `${filePath}:${i + 1}`;
      if (/eslint-disable/.test(line)) {
        violations.push(`${loc}: eslint-disable`);
      }
      // Public export typed as any (transport invent)
      if (
        /^\s*export\s+(type\s+)?\w+.*=\s*any\b/.test(line) ||
        /^\s*export\s+(async\s+)?function\s+\w+\([^)]*:\s*any\b/.test(line)
      ) {
        violations.push(`${loc}: public any`);
      }
    }
  }
  return violations;
}

describe("svm-stand-tx-refusal-policy", () => {
  it("landed_ok when InvalidSeeds expected fails with succeeded (red→green)", async () => {
    await assert.rejects(
      () =>
        expectStandTransactionRefusal({
          outcome: async () => ({
            kind: "landed_ok",
            signature: "ok-signature",
            slot: 1n,
          }),
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
          outcome: async () => ({
            kind: "landed_with_error",
            signature: "sig",
            err: { InstructionError: [0, "MissingRequiredSignature"] },
          }),
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
          outcome: async () => ({
            kind: "landed_with_error",
            signature: "sig",
            err: { InstructionError: [0, { Custom: 137 }] },
          }),
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

  it("stand_blockhash_expired when InvalidSeeds expected fails with named confirm (red→green)", async () => {
    await assert.rejects(
      () =>
        expectStandTransactionRefusal({
          outcome: async () => ({
            kind: "stand_blockhash_expired",
            tipHeight: 200,
            lastValidBlockHeight: 100,
            blockhash: "bh",
          }),
          expected: { kind: "native", name: "InvalidSeeds" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /InvalidSeeds/);
        assert.match(err.message, /stand_blockhash_expired/);
        return true;
      },
    );
  });

  it("parseStandInstructionError: structured InstructionError only; Display/JSON/nested invent null", () => {
    assert.deepEqual(
      parseStandInstructionError({
        InstructionError: [2, "InvalidSeeds"],
      }),
      { kind: "native", name: "InvalidSeeds", index: 2 },
    );
    assert.deepEqual(
      parseStandInstructionError({
        InstructionError: [0, { Custom: 144 }],
      }),
      { kind: "custom", name: "InvalidReceiver", ordinal: 144, index: 0 },
    );

    // Nested err wrapper (pre-structured invent) → null
    assert.equal(
      parseStandInstructionError({
        err: { InstructionError: [0, { Custom: 144 }] },
      }),
      null,
    );
    // JSON-in-message invent → null
    assert.equal(
      parseStandInstructionError(
        new Error(
          'stand_tx_failed: signature=x err={"InstructionError":[1,"AccountAlreadyInitialized"]}',
        ),
      ),
      null,
    );
    // Free-text native name → null
    assert.equal(
      parseStandInstructionError(new Error("expected InvalidSeeds")),
      null,
    );
    // Solana ProgramError Display (preflight prose) must NOT invent index 0
    assert.equal(
      parseStandInstructionError(
        new Error(
          "Transaction simulation failed: Error processing Instruction 0: Provided seeds do not result in a valid address",
        ),
      ),
      null,
    );
    // AccountAlreadyInitialized Display phrase → null
    assert.equal(
      parseStandInstructionError(
        new Error(
          "Transaction simulation failed: Error processing Instruction 0: instruction requires an uninitialized account",
        ),
      ),
      null,
    );
  });

  it("typed boundary: no eslint-disable / public any under svm/stand (plant red→green)", () => {
    const planted = findStandTypedBoundaryViolations([
      {
        path: "plant/stand-tx-confirm.ts",
        text: [
          "// eslint-disable-next-line @typescript-eslint/no-explicit-any",
          "export type StandWeb3Connection = any;",
          "export async function send(conn: any) { return conn; }",
        ].join("\n"),
      },
    ]);
    assert.ok(
      planted.some((v) => v.includes("eslint-disable")),
      "plant must catch eslint-disable",
    );
    assert.ok(
      planted.some((v) => v.includes("public any")),
      "plant must catch StandWeb3Connection = any",
    );

    const live = walkStandTs(STAND_DIR).map((p) => ({
      path: p.slice(ROOT.length + 1),
      text: readFileSync(p, "utf8"),
    }));
    assert.deepEqual(
      findStandTypedBoundaryViolations(live),
      [],
      "svm/stand must have zero eslint-disable and zero public any exports",
    );

    const types = readFileSync(
      join(STAND_DIR, "solana-web3-types.ts"),
      "utf8",
    );
    assert.match(types, /export type StandConnection/);
    assert.match(types, /export type StandTransaction/);
    assert.doesNotMatch(types, /=\s*any\b/);

    const confirm = readFileSync(join(STAND_DIR, "stand-tx-confirm.ts"), "utf8");
    assert.match(confirm, /StandConnection/);
    assert.match(confirm, /StandTransaction/);
    assert.doesNotMatch(confirm, /StandWeb3Connection/);
  });
});
