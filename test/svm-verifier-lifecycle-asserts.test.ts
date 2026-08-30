/**
 * Unit predicates for svm-verifier-lifecycle-asserts (no chain I/O).
 * Gate: test:verify (architectural / deploy assert ownership class).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STAKE_ACCOUNT_SPACE,
  UNBOND_NOT_READY_CUSTOM,
  assertClaimSettled,
  assertPassClosed,
  assertPassportVerified,
  assertStakeActive,
  assertStakeClearedAfterClaim,
  assertUnbondNotReady,
  decodeStakeAccount,
  extractCustomProgramError,
  isLiveCoreAsset,
  MPL_CORE_PROGRAM_ID,
} from "../scripts/lib/svm-verifier-lifecycle-asserts.ts";

function encodeStake(opts: {
  amount: bigint;
  stakedAt: bigint;
  active: boolean;
  unlockAt: bigint;
  fee?: bigint;
}): Buffer {
  const buf = Buffer.alloc(STAKE_ACCOUNT_SPACE);
  buf.write("kps_stk\0", 0, 8, "ascii");
  // wallet zeros
  buf.writeBigUInt64LE(opts.amount, 40);
  buf.writeBigUInt64LE(opts.stakedAt, 48);
  buf[56] = opts.active ? 1 : 0;
  buf.writeBigUInt64LE(opts.unlockAt, 57);
  buf.writeBigUInt64LE(opts.fee ?? 0n, 65);
  buf[73] = 255;
  return buf;
}

describe("svm-verifier-lifecycle-asserts", () => {
  it("STAKE_ACCOUNT_SPACE matches kar-pro-staking state.rs sole owner (128)", () => {
    assert.equal(STAKE_ACCOUNT_SPACE, 128);
  });

  it("decodeStakeAccount + assertStakeActive", () => {
    const data = encodeStake({
      amount: 500_000_000n,
      stakedAt: 1n,
      active: true,
      unlockAt: 0n,
    });
    const s = decodeStakeAccount(data);
    assert.equal(s.amount, 500_000_000n);
    assert.equal(s.active, true);
    assertStakeActive(data, true, "join");
    assert.throws(() => assertStakeActive(data, false, "join"), /expected false/);
  });

  it("assertPassportVerified", () => {
    const verifier = Buffer.alloc(32, 7);
    const data = Buffer.alloc(8 + 32 + 1 + 32);
    data[8 + 32] = 1;
    verifier.copy(data, 8 + 32 + 1);
    assertPassportVerified(data, verifier, "verify");
    assert.throws(
      () => assertPassportVerified(data, Buffer.alloc(32, 1), "verify"),
      /verifier mismatch/,
    );
  });

  it("isLiveCoreAsset / assertPassClosed (D-17 / D-21)", () => {
    assert.equal(
      isLiveCoreAsset({
        owner: MPL_CORE_PROGRAM_ID,
        data: Buffer.alloc(100),
      }),
      true,
    );
    assert.equal(
      isLiveCoreAsset({
        owner: MPL_CORE_PROGRAM_ID,
        data: Buffer.from([0]),
      }),
      false,
    );
    assert.equal(isLiveCoreAsset(null), false);

    const inactive = encodeStake({
      amount: 1n,
      stakedAt: 1n,
      active: false,
      unlockAt: 99n,
    });
    assertPassClosed(
      { owner: MPL_CORE_PROGRAM_ID, data: Buffer.from([0]) },
      inactive,
      "close",
    );
    assert.throws(
      () =>
        assertPassClosed(
          { owner: MPL_CORE_PROGRAM_ID, data: Buffer.alloc(40) },
          inactive,
          "close",
        ),
      /still live/,
    );
  });

  it("assertClaimSettled — amount from stake; rent explicit; fee-adjusted verifier", () => {
    const amount = 500_000_000n;
    const rent = 1_500_000;
    assertClaimSettled(
      {
        amountFromStake: amount,
        stakeLamportsBefore: rent + Number(amount),
        stakeLamportsAfter: rent,
        verifierLamportsBefore: 10_000_000,
        verifierLamportsAfter: 10_000_000 - 5_000 + Number(amount),
        txFeeLamports: 5_000,
        rentExemptMin: rent,
      },
      "claim",
    );
    assert.throws(
      () =>
        assertClaimSettled(
          {
            amountFromStake: amount,
            stakeLamportsBefore: rent + Number(amount),
            stakeLamportsAfter: rent - 1,
            verifierLamportsBefore: 0,
            verifierLamportsAfter: Number(amount),
            txFeeLamports: 0,
            rentExemptMin: rent,
          },
          "claim",
        ),
      /stake lamports delta/,
    );
  });

  it("assertStakeClearedAfterClaim", () => {
    const cleared = encodeStake({
      amount: 0n,
      stakedAt: 0n,
      active: false,
      unlockAt: 0n,
    });
    assertStakeClearedAfterClaim(cleared, "post-claim");
  });

  it("UnbondNotReady Custom(48) extract + assert", () => {
    assert.equal(UNBOND_NOT_READY_CUSTOM, 48);
    const err = {
      message: "Simulation failed",
      logs: ['Program log: Error: custom program error: 0x30'],
    };
    // 0x30 = 48
    assert.equal(extractCustomProgramError(err), 48);
    assertUnbondNotReady(
      { err: { InstructionError: [0, { Custom: 48 }] } },
      "early-claim",
    );
    assert.throws(
      () => assertUnbondNotReady({ err: { InstructionError: [0, { Custom: 1 }] } }, "x"),
      /expected UnbondNotReady/,
    );
  });
});
