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

import { parseAttributedSvmLandedInstructionError } from "../lib/web3/svm-landed-error.ts";
import { expectStandTransactionRefusal } from "../svm/stand/stand-tx-refusal.ts";

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

  it("custom_unattributed fails when InvalidReceiver expected (names failingProgram)", async () => {
    await assert.rejects(
      () =>
        expectStandTransactionRefusal({
          outcome: async () => ({
            kind: "landed_with_error",
            signature: "sig",
            err: { InstructionError: [0, { Custom: 144 }] },
          }),
          expected: { kind: "custom", name: "InvalidReceiver" },
          // No attributable ids / logs → unattributed
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /InvalidReceiver/);
        assert.match(err.message, /custom_unattributed/);
        assert.match(err.message, /program=/);
        return true;
      },
    );
  });

  it("attributed Custom matches InvalidReceiver expected (red→green)", async () => {
    const programId = "KarPass1111111111111111111111111111111111";
    const observed = await expectStandTransactionRefusal({
      outcome: async () => ({
        kind: "landed_with_error",
        signature: "sig",
        err: { InstructionError: [0, { Custom: 144 }] },
      }),
      expected: { kind: "custom", name: "InvalidReceiver" },
      attributableProgramIds: [programId],
      logMessages: [`Program ${programId} failed: custom program error: 0x90`],
    });
    assert.equal(observed.kind, "custom");
    if (observed.kind === "custom") {
      assert.equal(observed.name, "InvalidReceiver");
      assert.equal(observed.ordinal, 144);
    }
  });

  it("custom_unattributed expected matches Core InvalidAuthority ordinal (red→green)", async () => {
    const coreId = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
    const observed = await expectStandTransactionRefusal({
      outcome: async () => ({
        kind: "landed_with_error",
        signature: "sig",
        err: { InstructionError: [0, { Custom: 9 }] },
      }),
      expected: {
        kind: "custom_unattributed",
        ordinal: 9,
        failingProgram: coreId,
      },
      attributableProgramIds: ["KarPass1111111111111111111111111111111111"],
      logMessages: [`Program ${coreId} failed: custom program error: 0x9`],
    });
    assert.equal(observed.kind, "custom_unattributed");
    if (observed.kind === "custom_unattributed") {
      assert.equal(observed.ordinal, 9);
      assert.equal(observed.failingProgram, coreId);
    }
  });

  it("custom_unattributed expectation mismatches failingProgram (red→green)", async () => {
    const coreId = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
    await assert.rejects(
      () =>
        expectStandTransactionRefusal({
          outcome: async () => ({
            kind: "landed_with_error",
            signature: "sig",
            err: { InstructionError: [0, { Custom: 9 }] },
          }),
          expected: {
            kind: "custom_unattributed",
            ordinal: 9,
            failingProgram: "WrongProgram1111111111111111111111111111111",
          },
          attributableProgramIds: ["KarPass1111111111111111111111111111111111"],
          logMessages: [`Program ${coreId} failed: custom program error: 0x9`],
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /custom_unattributed\(9\)/);
        assert.match(err.message, /WrongProgram/);
        assert.match(err.message, /CoREEN/);
        return true;
      },
    );
  });

  it("custom_unattributed expectation requires failingProgram (omit plant)", () => {
    const incomplete = {
      kind: "custom_unattributed" as const,
      ordinal: 9,
    };
    assert.equal(
      "failingProgram" in incomplete,
      false,
      "plant: expectation without failingProgram must be incomplete",
    );
  });

  it("wrong Custom name when InvalidReceiver expected fails with both names (red→green)", async () => {
    // AssetFrozen = 137 — attributed so observed is named custom
    const programId = "KarPass1111111111111111111111111111111111";
    await assert.rejects(
      () =>
        expectStandTransactionRefusal({
          outcome: async () => ({
            kind: "landed_with_error",
            signature: "sig",
            err: { InstructionError: [0, { Custom: 137 }] },
          }),
          expected: { kind: "custom", name: "InvalidReceiver" },
          attributableProgramIds: [programId],
          logMessages: [
            `Program ${programId} failed: custom program error: 0x89`,
          ],
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

  it("parseAttributedSvmLandedInstructionError: structured InstructionError only; Display/JSON/nested invent null", () => {
    assert.deepEqual(
      parseAttributedSvmLandedInstructionError(
        { InstructionError: [2, "InvalidSeeds"] },
        null,
        null,
      ),
      { kind: "native", name: "InvalidSeeds", index: 2 },
    );
    assert.deepEqual(
      parseAttributedSvmLandedInstructionError(
        { InstructionError: [0, { Custom: 144 }] },
        null,
        null,
      ),
      {
        kind: "custom_unattributed",
        ordinal: 144,
        index: 0,
        failingProgram: null,
      },
    );

    // Nested err wrapper (pre-structured invent) → null
    assert.equal(
      parseAttributedSvmLandedInstructionError(
        { err: { InstructionError: [0, { Custom: 144 }] } },
        null,
        null,
      ),
      null,
    );
    // JSON-in-message invent → null
    assert.equal(
      parseAttributedSvmLandedInstructionError(
        new Error(
          'stand_tx_failed: signature=x err={"InstructionError":[1,"AccountAlreadyInitialized"]}',
        ),
        null,
        null,
      ),
      null,
    );
    // Free-text native name → null
    assert.equal(
      parseAttributedSvmLandedInstructionError(
        new Error("expected InvalidSeeds"),
        null,
        null,
      ),
      null,
    );
    // Solana ProgramError Display (preflight prose) must NOT invent index 0
    assert.equal(
      parseAttributedSvmLandedInstructionError(
        new Error(
          "Transaction simulation failed: Error processing Instruction 0: Provided seeds do not result in a valid address",
        ),
        null,
        null,
      ),
      null,
    );
    // AccountAlreadyInitialized Display phrase → null
    assert.equal(
      parseAttributedSvmLandedInstructionError(
        new Error(
          "Transaction simulation failed: Error processing Instruction 0: instruction requires an uninitialized account",
        ),
        null,
        null,
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

  it("STAND_NATIVE_IX_ERRORS deleted — pin absence (plant red→green)", () => {
    const refusal = readFileSync(join(STAND_DIR, "stand-tx-refusal.ts"), "utf8");
    assert.doesNotMatch(
      refusal,
      /\bSTAND_NATIVE_IX_ERRORS\b/,
      "STAND_NATIVE_IX_ERRORS must stay deleted",
    );
    const planted = "export const STAND_NATIVE_IX_ERRORS = [] as const;\n";
    assert.match(planted, /\bSTAND_NATIVE_IX_ERRORS\b/);
  });
});
