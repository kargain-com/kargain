/**
 * F-4 client acceptance-bar evaluator (flywheel §4.4, §10.1 F-4 refinement).
 *
 * Pure module: no network, no viem — fixture-testable. Inputs are registry
 * epoch chains (registry-reads.ts) and gate-verified confirmation attesters
 * (hooks/use-commons-confirmations.ts); the policy is the pinned
 * `VINCENT_REGISTRY.acceptancePolicy` descriptor.
 *
 * Scope note — review-policy compliance of the claim set (§4.3 thresholds)
 * is checkable only against the Arweave archive, so it is out of scope for
 * the in-app evaluator; it is verified by confirmers rebuilding the epoch
 * (vincent COMMUNITY-CANON.md). Likewise `manifest-unverified` is a
 * passthrough: only callers that actually verify manifests (the confirm CLI
 * path) set `manifestVerified: false` — the in-app panel never does, since
 * every `rebuilt` confirmation already implies the confirmer verified the
 * manifest signature.
 */
import {
  checkLineageContinuity,
  type RegistryEpoch,
} from "@/lib/vincent-commons/registry-panel";

export type AcceptancePolicy = {
  minIndependentConfirmations: number;
};

export type AcceptanceEpochInput = RegistryEpoch & {
  /** Passthrough from callers that verify manifests; omit when unchecked. */
  manifestVerified?: boolean;
};

export type AcceptancePublisherInput = {
  address: `0x${string}`;
  /**
   * Current `isActiveVerifier` snapshot — the in-app approximation of the
   * §4.4 "active at the anchor block" rule (same approximation as review
   * gating).
   */
  active: boolean;
  /** Ascending epoch order (index 0 = genesis). */
  epochs: AcceptanceEpochInput[];
};

export type AcceptanceReason =
  | { code: "publisher-not-active-verifier" }
  | { code: "lineage-broken" }
  | { code: "insufficient-confirmations"; have: number; need: number }
  | { code: "manifest-unverified" };

export type EpochVerdict = {
  publisher: `0x${string}`;
  epoch: number;
  merkleRoot: string;
  manifestHash: string;
  anchorTimestamp: number;
  independentConfirmations: number;
  eligible: boolean;
  reasons: AcceptanceReason[];
};

export type AcceptanceInput = {
  publishers: AcceptancePublisherInput[];
  /** manifestHash → gate-verified confirmation attester addresses. */
  confirmationsByManifest: Map<string, string[]>;
  policy: AcceptancePolicy;
};

export type AcceptanceResult = {
  verdicts: EpochVerdict[];
  /**
   * Most independent confirmations among eligible epochs; tie → earliest
   * anchor; final deterministic tiebreak → publisher address asc, epoch asc.
   */
  bestEligible: EpochVerdict | null;
};

/**
 * Independent confirmations for one epoch: deduped attesters for its
 * manifestHash, excluding the publisher confirming their own epoch
 * (non-independent), case-insensitive.
 */
function countIndependentConfirmations(
  attesters: string[] | undefined,
  publisher: string,
): number {
  if (!attesters || attesters.length === 0) return 0;
  const own = publisher.toLowerCase();
  const independent = new Set<string>();
  for (const attester of attesters) {
    const normalized = attester.toLowerCase();
    if (normalized === own) continue;
    independent.add(normalized);
  }
  return independent.size;
}

function compareVerdicts(a: EpochVerdict, b: EpochVerdict): number {
  if (a.independentConfirmations !== b.independentConfirmations) {
    return b.independentConfirmations - a.independentConfirmations;
  }
  if (a.anchorTimestamp !== b.anchorTimestamp) {
    return a.anchorTimestamp - b.anchorTimestamp;
  }
  const byAddress = a.publisher
    .toLowerCase()
    .localeCompare(b.publisher.toLowerCase());
  if (byAddress !== 0) return byAddress;
  return a.epoch - b.epoch;
}

/** Evaluate the §4.4 acceptance bar for every epoch of every publisher. */
export function evaluateAcceptance(input: AcceptanceInput): AcceptanceResult {
  const need = input.policy.minIndependentConfirmations;
  const verdicts: EpochVerdict[] = [];

  for (const publisher of input.publishers) {
    if (publisher.epochs.length === 0) continue;
    const lineageOk = checkLineageContinuity(publisher.epochs);

    for (const epoch of publisher.epochs) {
      const have = countIndependentConfirmations(
        input.confirmationsByManifest.get(epoch.manifestHash),
        publisher.address,
      );

      const reasons: AcceptanceReason[] = [];
      if (!publisher.active) {
        reasons.push({ code: "publisher-not-active-verifier" });
      }
      if (!lineageOk) {
        reasons.push({ code: "lineage-broken" });
      }
      if (have < need) {
        reasons.push({ code: "insufficient-confirmations", have, need });
      }
      if (epoch.manifestVerified === false) {
        reasons.push({ code: "manifest-unverified" });
      }

      verdicts.push({
        publisher: publisher.address,
        epoch: epoch.epoch,
        merkleRoot: epoch.merkleRoot,
        manifestHash: epoch.manifestHash,
        anchorTimestamp: epoch.timestamp,
        independentConfirmations: have,
        eligible: reasons.length === 0,
        reasons,
      });
    }
  }

  const eligible = verdicts.filter((verdict) => verdict.eligible);
  eligible.sort(compareVerdicts);

  return {
    verdicts,
    bestEligible: eligible[0] ?? null,
  };
}

export type PinnedRootComparison = "matches-pinned" | "switch-pending";

/**
 * Compare the best eligible root to the pinned dataset root. The result is
 * informational, not a trust state: switching the pin stays a recorded
 * maintainer edit (lib/passport/vincent-dataset.ts, flywheel §10.3).
 */
export function comparePinnedRoot(
  bestRoot: string,
  pinnedRoot: string,
): PinnedRootComparison {
  return bestRoot === pinnedRoot ? "matches-pinned" : "switch-pending";
}
