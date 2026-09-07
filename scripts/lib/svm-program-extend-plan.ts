/**
 * Sole owner of “how many bytes to allocate” for a founder-approved
 * `solana program extend` before upgrade-in-place.
 *
 * Policy (S9-B extend): target capacity = ceil(artifactBytes × 5/4) — 125 % of
 * the new .so — so near-term S9 growth does not require another irreversible
 * extend. Exact-deficit extends are intentionally not offered here.
 */

export const ARTIFACT_CAPACITY_HEADROOM_NUMERATOR = 5 as const;
export const ARTIFACT_CAPACITY_HEADROOM_DENOMINATOR = 4 as const;

/** ceil(artifact × 5/4) via integer arithmetic (no float). */
export function targetCapacityAtArtifactHeadroom(
  artifactBytes: number,
): number {
  if (!Number.isInteger(artifactBytes) || artifactBytes <= 0) {
    throw new Error(
      `targetCapacityAtArtifactHeadroom: artifactBytes must be a positive integer (got ${artifactBytes})`,
    );
  }
  return Math.ceil(
    (artifactBytes * ARTIFACT_CAPACITY_HEADROOM_NUMERATOR) /
      ARTIFACT_CAPACITY_HEADROOM_DENOMINATOR,
  );
}

export type ProgramExtendPlan =
  | {
      ok: true;
      skip: true;
      reason: "already_at_or_above_target";
      deployedCapacityBytes: number;
      artifactBytes: number;
      targetCapacityBytes: number;
      additionalBytes: 0;
    }
  | {
      ok: true;
      skip: false;
      deployedCapacityBytes: number;
      artifactBytes: number;
      targetCapacityBytes: number;
      additionalBytes: number;
    };

/**
 * ADDITIONAL_BYTES for `solana program extend <PROGRAM_ID> <ADDITIONAL_BYTES>`.
 * Skip when deployed capacity already meets the 125 % target.
 */
export function planProgramExtend(args: {
  deployedCapacityBytes: number;
  artifactBytes: number;
}): ProgramExtendPlan {
  const { deployedCapacityBytes, artifactBytes } = args;
  if (
    !Number.isInteger(deployedCapacityBytes) ||
    deployedCapacityBytes <= 0
  ) {
    throw new Error(
      `planProgramExtend: deployedCapacityBytes must be a positive integer (got ${deployedCapacityBytes})`,
    );
  }
  const targetCapacityBytes = targetCapacityAtArtifactHeadroom(artifactBytes);
  if (deployedCapacityBytes >= targetCapacityBytes) {
    return {
      ok: true,
      skip: true,
      reason: "already_at_or_above_target",
      deployedCapacityBytes,
      artifactBytes,
      targetCapacityBytes,
      additionalBytes: 0,
    };
  }
  return {
    ok: true,
    skip: false,
    deployedCapacityBytes,
    artifactBytes,
    targetCapacityBytes,
    additionalBytes: targetCapacityBytes - deployedCapacityBytes,
  };
}

/**
 * Rent delta for growing program-data from `fromBytes` to `toBytes`.
 * Rent is linear in data length: Δ = rent(to) − rent(from).
 */
export function rentDeltaLamports(args: {
  rentExemptFromLamports: number;
  rentExemptToLamports: number;
}): number {
  const { rentExemptFromLamports, rentExemptToLamports } = args;
  if (
    !Number.isInteger(rentExemptFromLamports) ||
    rentExemptFromLamports < 0 ||
    !Number.isInteger(rentExemptToLamports) ||
    rentExemptToLamports < 0
  ) {
    throw new Error(
      `rentDeltaLamports: rent figures must be non-negative integers`,
    );
  }
  if (rentExemptToLamports < rentExemptFromLamports) {
    throw new Error(
      `rentDeltaLamports: to-rent ${rentExemptToLamports} < from-rent ${rentExemptFromLamports}`,
    );
  }
  return rentExemptToLamports - rentExemptFromLamports;
}
