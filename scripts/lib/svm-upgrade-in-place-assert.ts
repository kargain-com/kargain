/**
 * Pure checks for upgrade-in-place eligibility (no chain I/O).
 */

export function assertProgramShowAllowsUpgrade(args: {
  showText: string;
  programId: string;
  deployerPubkey: string;
  evidenceKey: string;
  caller?: string;
}): void {
  const caller = args.caller ?? "svm-upgrade-in-place";
  const { showText, programId, deployerPubkey, evidenceKey } = args;
  if (!/Owner:\s*BPFLoaderUpgradeab/i.test(showText)) {
    throw new Error(
      `${caller}: ${evidenceKey} (${programId}) is not owned by the upgradeable loader`,
    );
  }
  const authMatch = showText.match(/Authority:\s*(\S+)/);
  if (!authMatch) {
    throw new Error(
      `${caller}: ${evidenceKey} (${programId}) program show missing Authority line`,
    );
  }
  if (authMatch[1] !== deployerPubkey) {
    throw new Error(
      `${caller}: ${evidenceKey} (${programId}) upgrade authority ≠ deployer`,
    );
  }
}

/**
 * Allocated program-data capacity from `solana program show`.
 * Text form: `Data Length: <n> (... ) bytes`. JSON form: `"dataLen": <n>`.
 * Docs: this is total bytes allocated (room for future upgrades), not only
 * the currently occupied ELF length.
 */
export function parseProgramDataCapacityBytes(showText: string): number {
  const textMatch = showText.match(/Data Length:\s*(\d+)/i);
  if (textMatch) {
    const n = Number(textMatch[1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  const jsonMatch = showText.match(/"dataLen"\s*:\s*(\d+)/);
  if (jsonMatch) {
    const n = Number(jsonMatch[1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  throw new Error(
    `program show missing Data Length / dataLen (cannot establish program-data capacity)`,
  );
}

export const PROGRAM_DATA_CAPACITY_INSUFFICIENT =
  "program_data_capacity_insufficient" as const;

export type ArtifactCapacityFitResult =
  | {
      ok: true;
      evidenceKey: string;
      deployedCapacityBytes: number;
      artifactBytes: number;
      deficitBytes: 0;
    }
  | {
      ok: false;
      causeCode: typeof PROGRAM_DATA_CAPACITY_INSUFFICIENT;
      evidenceKey: string;
      programId: string;
      deployedCapacityBytes: number;
      artifactBytes: number;
      deficitBytes: number;
      message: string;
    };

/** Compare on-chain program-data capacity to the new .so size. */
export function evaluateArtifactCapacityFit(args: {
  evidenceKey: string;
  programId: string;
  deployedCapacityBytes: number;
  artifactBytes: number;
  caller?: string;
}): ArtifactCapacityFitResult {
  const caller = args.caller ?? "svm-upgrade-in-place";
  const {
    evidenceKey,
    programId,
    deployedCapacityBytes,
    artifactBytes,
  } = args;
  if (
    !Number.isInteger(deployedCapacityBytes) ||
    deployedCapacityBytes <= 0 ||
    !Number.isInteger(artifactBytes) ||
    artifactBytes <= 0
  ) {
    throw new Error(
      `${caller}: ${evidenceKey} capacity/artifact sizes must be positive integers ` +
        `(capacity=${deployedCapacityBytes}, artifact=${artifactBytes})`,
    );
  }
  if (artifactBytes <= deployedCapacityBytes) {
    return {
      ok: true,
      evidenceKey,
      deployedCapacityBytes,
      artifactBytes,
      deficitBytes: 0,
    };
  }
  const deficitBytes = artifactBytes - deployedCapacityBytes;
  return {
    ok: false,
    causeCode: PROGRAM_DATA_CAPACITY_INSUFFICIENT,
    evidenceKey,
    programId,
    deployedCapacityBytes,
    artifactBytes,
    deficitBytes,
    message:
      `${caller}: ${evidenceKey} (${programId}) program-data capacity insufficient — ` +
      `deployedCapacityBytes=${deployedCapacityBytes} artifactBytes=${artifactBytes} ` +
      `deficitBytes=${deficitBytes} (extend is a separate founder-approved operation; ` +
      `refusing upgrade)`,
  };
}

export function assertArtifactFitsProgramCapacity(args: {
  evidenceKey: string;
  programId: string;
  deployedCapacityBytes: number;
  artifactBytes: number;
  caller?: string;
}): void {
  const result = evaluateArtifactCapacityFit(args);
  if (!result.ok) {
    throw new Error(result.message);
  }
}

export const PAYER_BALANCE_INSUFFICIENT_FOR_UPGRADE =
  "payer_balance_insufficient_for_upgrade" as const;

export type PayerUpgradeCostResult =
  | {
      ok: true;
      payerLamports: number;
      estimatedCostLamports: number;
    }
  | {
      ok: false;
      causeCode: typeof PAYER_BALANCE_INSUFFICIENT_FOR_UPGRADE;
      payerLamports: number;
      estimatedCostLamports: number;
      message: string;
    };

/**
 * Cost basis: sum of rent-exempt minima for temporary upgrade buffers sized to
 * each artifact (`solana rent <DATA_LENGTH> --lamports`). Sequential upgrades
 * reclaim buffer rent after each close; summing still bounds capital the payer
 * must be able to hold. No invented fee constant.
 */
export function evaluatePayerCoversUpgradeCost(args: {
  payerLamports: number;
  estimatedCostLamports: number;
  caller?: string;
}): PayerUpgradeCostResult {
  const caller = args.caller ?? "svm-upgrade-in-place";
  const { payerLamports, estimatedCostLamports } = args;
  if (
    !Number.isInteger(payerLamports) ||
    payerLamports < 0 ||
    !Number.isInteger(estimatedCostLamports) ||
    estimatedCostLamports < 0
  ) {
    throw new Error(
      `${caller}: payer/estimated cost must be non-negative integers ` +
        `(payer=${payerLamports}, estimated=${estimatedCostLamports})`,
    );
  }
  if (payerLamports >= estimatedCostLamports) {
    return { ok: true, payerLamports, estimatedCostLamports };
  }
  return {
    ok: false,
    causeCode: PAYER_BALANCE_INSUFFICIENT_FOR_UPGRADE,
    payerLamports,
    estimatedCostLamports,
    message:
      `${caller}: payer balance insufficient for planned upgrades — ` +
      `payerLamports=${payerLamports} estimatedCostLamports=${estimatedCostLamports}`,
  };
}

export function assertPayerCoversUpgradeCost(args: {
  payerLamports: number;
  estimatedCostLamports: number;
  caller?: string;
}): void {
  const result = evaluatePayerCoversUpgradeCost(args);
  if (!result.ok) {
    throw new Error(result.message);
  }
}
