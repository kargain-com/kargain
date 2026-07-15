/**
 * Pure model builders for the Commons publishers panel (flywheel §9 F-2.2).
 * No network, no viem — fixture-testable. Chain reads live in
 * `registry-reads.ts`; this module only shapes their results for the UI.
 */

/** Structural subset of `@kargain/vincent/anchor` AnchorEpoch — type-only. */
export type RegistryEpoch = {
  epoch: number;
  merkleRoot: string;
  parentRoot: string | null;
  /** Manifest content id — the `d` tag of kind 31862 confirmations (F-4). */
  manifestHash: string;
  /** On-chain anchor timestamp (seconds) — acceptance-bar tiebreak (F-4). */
  timestamp: number;
};

export type PublisherEpochsInput = {
  address: `0x${string}`;
  epochCount: number;
  /** Ascending epoch order (index 0 = genesis). Empty when epochCount is 0. */
  epochs: RegistryEpoch[];
};

export type PublisherRow = {
  address: `0x${string}`;
  epochCount: number;
  latestRoot: string;
  lineageOk: boolean;
};

export type RegistryPanelModel = {
  publishers: PublisherRow[];
  zeroEpochCount: number;
};

/**
 * Anchor lineage continuity: genesis epoch has no parent; every later epoch's
 * `parentRoot` must equal the previous epoch's `merkleRoot`.
 */
export function checkLineageContinuity(epochs: RegistryEpoch[]): boolean {
  if (epochs.length === 0) return false;
  if (epochs[0].parentRoot !== null) return false;
  for (let i = 1; i < epochs.length; i++) {
    if (epochs[i].parentRoot !== epochs[i - 1].merkleRoot) return false;
  }
  return true;
}

/**
 * Build the publishers panel model: one row per verifier with ≥1 epoch
 * (epoch count desc, then address asc for determinism), plus a single count
 * of active verifiers that have not published yet.
 */
export function buildRegistryPanelModel(
  inputs: PublisherEpochsInput[],
): RegistryPanelModel {
  const publishers = inputs
    .filter((input) => input.epochCount > 0 && input.epochs.length > 0)
    .map((input) => ({
      address: input.address,
      epochCount: input.epochCount,
      latestRoot: input.epochs[input.epochs.length - 1].merkleRoot,
      lineageOk: checkLineageContinuity(input.epochs),
    }))
    .sort((a, b) =>
      a.epochCount !== b.epochCount
        ? b.epochCount - a.epochCount
        : a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
    );

  return {
    publishers,
    zeroEpochCount: inputs.length - publishers.length,
  };
}

/**
 * Truncate a content id (`sha256:…` root or 0x hash) for mono display;
 * render the full value in a `title` attribute.
 */
export function truncateContentId(value: string): string {
  if (value.length <= 20) return value;
  return `${value.slice(0, 14)}…${value.slice(-6)}`;
}
