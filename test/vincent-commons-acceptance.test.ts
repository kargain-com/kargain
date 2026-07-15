/**
 * Vincent F-4 — client acceptance-bar evaluator.
 * Pure fixtures only: no network, no viem client.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  comparePinnedRoot,
  evaluateAcceptance,
  type AcceptanceEpochInput,
  type AcceptancePublisherInput,
  type AcceptanceReason,
} from "../lib/vincent-commons/acceptance.ts";
import { VINCENT_REGISTRY } from "../lib/vincent-commons/registry-config.ts";

const ROOT_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ROOT_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ROOT_C =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const MANIFEST_1 =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const MANIFEST_2 =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const MANIFEST_3 =
  "sha256:3333333333333333333333333333333333333333333333333333333333333333";

const PUBLISHER_1 = "0x1111111111111111111111111111111111111111" as const;
const PUBLISHER_2 = "0x2222222222222222222222222222222222222222" as const;
const CONFIRMER_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CONFIRMER_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function epoch(
  index: number,
  merkleRoot: string,
  parentRoot: string | null,
  manifestHash: string,
  overrides?: Partial<AcceptanceEpochInput>,
): AcceptanceEpochInput {
  return {
    epoch: index,
    merkleRoot,
    parentRoot,
    manifestHash,
    timestamp: 1_700_000_000 + index,
    ...overrides,
  };
}

function publisher(
  address: `0x${string}`,
  epochs: AcceptanceEpochInput[],
  active = true,
): AcceptancePublisherInput {
  return { address, active, epochs };
}

function confirmations(
  entries: [string, string[]][],
): Map<string, string[]> {
  return new Map(entries);
}

function reasonCodes(reasons: AcceptanceReason[]): string[] {
  return reasons.map((reason) => reason.code);
}

const POLICY_1 = { minIndependentConfirmations: 1 };

describe("VINCENT_REGISTRY acceptance policy", () => {
  it("pins minIndependentConfirmations 1 on Base Sepolia validation", () => {
    assert.equal(
      VINCENT_REGISTRY.acceptancePolicy.minIndependentConfirmations,
      1,
    );
  });
});

describe("evaluateAcceptance eligibility matrix", () => {
  it("accepts a confirmed epoch from an active publisher with intact lineage", () => {
    const result = evaluateAcceptance({
      publishers: [publisher(PUBLISHER_1, [epoch(0, ROOT_A, null, MANIFEST_1)])],
      confirmationsByManifest: confirmations([[MANIFEST_1, [CONFIRMER_A]]]),
      policy: POLICY_1,
    });
    assert.equal(result.verdicts.length, 1);
    const [verdict] = result.verdicts;
    assert.equal(verdict.eligible, true);
    assert.deepEqual(verdict.reasons, []);
    assert.equal(verdict.independentConfirmations, 1);
    assert.equal(result.bestEligible?.merkleRoot, ROOT_A);
  });

  it("flags publisher-not-active-verifier", () => {
    const result = evaluateAcceptance({
      publishers: [
        publisher(PUBLISHER_1, [epoch(0, ROOT_A, null, MANIFEST_1)], false),
      ],
      confirmationsByManifest: confirmations([[MANIFEST_1, [CONFIRMER_A]]]),
      policy: POLICY_1,
    });
    const [verdict] = result.verdicts;
    assert.equal(verdict.eligible, false);
    assert.deepEqual(reasonCodes(verdict.reasons), [
      "publisher-not-active-verifier",
    ]);
    assert.equal(result.bestEligible, null);
  });

  it("flags lineage-broken on every epoch of a broken chain", () => {
    const result = evaluateAcceptance({
      publishers: [
        publisher(PUBLISHER_1, [
          epoch(0, ROOT_A, null, MANIFEST_1),
          // Parent link does not match the previous root.
          epoch(1, ROOT_B, ROOT_C, MANIFEST_2),
        ]),
      ],
      confirmationsByManifest: confirmations([
        [MANIFEST_1, [CONFIRMER_A]],
        [MANIFEST_2, [CONFIRMER_A]],
      ]),
      policy: POLICY_1,
    });
    assert.equal(result.verdicts.length, 2);
    for (const verdict of result.verdicts) {
      assert.equal(verdict.eligible, false);
      assert.deepEqual(reasonCodes(verdict.reasons), ["lineage-broken"]);
    }
    assert.equal(result.bestEligible, null);
  });

  it("flags insufficient-confirmations with have/need", () => {
    const result = evaluateAcceptance({
      publishers: [publisher(PUBLISHER_1, [epoch(0, ROOT_A, null, MANIFEST_1)])],
      confirmationsByManifest: confirmations([[MANIFEST_1, [CONFIRMER_A]]]),
      policy: { minIndependentConfirmations: 2 },
    });
    const [verdict] = result.verdicts;
    assert.equal(verdict.eligible, false);
    assert.deepEqual(verdict.reasons, [
      { code: "insufficient-confirmations", have: 1, need: 2 },
    ]);
  });

  it("flags manifest-unverified only on explicit false", () => {
    const flagged = evaluateAcceptance({
      publishers: [
        publisher(PUBLISHER_1, [
          epoch(0, ROOT_A, null, MANIFEST_1, { manifestVerified: false }),
        ]),
      ],
      confirmationsByManifest: confirmations([[MANIFEST_1, [CONFIRMER_A]]]),
      policy: POLICY_1,
    });
    assert.deepEqual(reasonCodes(flagged.verdicts[0].reasons), [
      "manifest-unverified",
    ]);

    const unchecked = evaluateAcceptance({
      publishers: [
        publisher(PUBLISHER_1, [epoch(0, ROOT_A, null, MANIFEST_1)]),
      ],
      confirmationsByManifest: confirmations([[MANIFEST_1, [CONFIRMER_A]]]),
      policy: POLICY_1,
    });
    assert.equal(unchecked.verdicts[0].eligible, true);
  });

  it("stacks every applicable reason on one verdict", () => {
    const result = evaluateAcceptance({
      publishers: [
        publisher(
          PUBLISHER_1,
          [epoch(0, ROOT_A, ROOT_B, MANIFEST_1, { manifestVerified: false })],
          false,
        ),
      ],
      confirmationsByManifest: confirmations([]),
      policy: POLICY_1,
    });
    assert.deepEqual(reasonCodes(result.verdicts[0].reasons), [
      "publisher-not-active-verifier",
      "lineage-broken",
      "insufficient-confirmations",
      "manifest-unverified",
    ]);
  });

  it("emits no verdicts for publishers without epochs", () => {
    const result = evaluateAcceptance({
      publishers: [publisher(PUBLISHER_1, [])],
      confirmationsByManifest: confirmations([]),
      policy: POLICY_1,
    });
    assert.deepEqual(result.verdicts, []);
    assert.equal(result.bestEligible, null);
  });
});

describe("evaluateAcceptance self-confirmation exclusion", () => {
  it("never counts the publisher confirming their own epoch", () => {
    const result = evaluateAcceptance({
      publishers: [publisher(PUBLISHER_1, [epoch(0, ROOT_A, null, MANIFEST_1)])],
      confirmationsByManifest: confirmations([[MANIFEST_1, [PUBLISHER_1]]]),
      policy: POLICY_1,
    });
    const [verdict] = result.verdicts;
    assert.equal(verdict.independentConfirmations, 0);
    assert.deepEqual(verdict.reasons, [
      { code: "insufficient-confirmations", have: 0, need: 1 },
    ]);
  });

  it("excludes self case-insensitively and dedupes attesters", () => {
    const result = evaluateAcceptance({
      publishers: [publisher(PUBLISHER_1, [epoch(0, ROOT_A, null, MANIFEST_1)])],
      confirmationsByManifest: confirmations([
        [
          MANIFEST_1,
          [
            PUBLISHER_1.toUpperCase().replace("0X", "0x"),
            CONFIRMER_A,
            CONFIRMER_A.toUpperCase().replace("0X", "0x"),
          ],
        ],
      ]),
      policy: POLICY_1,
    });
    assert.equal(result.verdicts[0].independentConfirmations, 1);
    assert.equal(result.verdicts[0].eligible, true);
  });

  it("keeps independent confirmations from another publisher", () => {
    const result = evaluateAcceptance({
      publishers: [publisher(PUBLISHER_1, [epoch(0, ROOT_A, null, MANIFEST_1)])],
      confirmationsByManifest: confirmations([
        [MANIFEST_1, [PUBLISHER_1, PUBLISHER_2]],
      ]),
      policy: POLICY_1,
    });
    assert.equal(result.verdicts[0].independentConfirmations, 1);
    assert.equal(result.verdicts[0].eligible, true);
  });
});

describe("evaluateAcceptance best root", () => {
  it("prefers the most independent confirmations among eligible epochs", () => {
    const result = evaluateAcceptance({
      publishers: [
        publisher(PUBLISHER_1, [epoch(0, ROOT_A, null, MANIFEST_1)]),
        publisher(PUBLISHER_2, [epoch(0, ROOT_B, null, MANIFEST_2)]),
      ],
      confirmationsByManifest: confirmations([
        [MANIFEST_1, [CONFIRMER_A]],
        [MANIFEST_2, [CONFIRMER_A, CONFIRMER_B]],
      ]),
      policy: POLICY_1,
    });
    assert.equal(result.bestEligible?.merkleRoot, ROOT_B);
    assert.equal(result.bestEligible?.independentConfirmations, 2);
  });

  it("breaks confirmation ties by earliest anchor timestamp", () => {
    const result = evaluateAcceptance({
      publishers: [
        publisher(PUBLISHER_1, [
          epoch(0, ROOT_A, null, MANIFEST_1, { timestamp: 1_700_000_500 }),
        ]),
        publisher(PUBLISHER_2, [
          epoch(0, ROOT_B, null, MANIFEST_2, { timestamp: 1_700_000_100 }),
        ]),
      ],
      confirmationsByManifest: confirmations([
        [MANIFEST_1, [CONFIRMER_A]],
        [MANIFEST_2, [CONFIRMER_B]],
      ]),
      policy: POLICY_1,
    });
    assert.equal(result.bestEligible?.merkleRoot, ROOT_B);
    assert.equal(result.bestEligible?.anchorTimestamp, 1_700_000_100);
  });

  it("breaks full ties deterministically by publisher address then epoch", () => {
    const shared = { timestamp: 1_700_000_100 };
    const result = evaluateAcceptance({
      publishers: [
        publisher(PUBLISHER_2, [epoch(0, ROOT_B, null, MANIFEST_2, shared)]),
        publisher(PUBLISHER_1, [epoch(0, ROOT_A, null, MANIFEST_1, shared)]),
      ],
      confirmationsByManifest: confirmations([
        [MANIFEST_1, [CONFIRMER_A]],
        [MANIFEST_2, [CONFIRMER_A]],
      ]),
      policy: POLICY_1,
    });
    assert.equal(result.bestEligible?.publisher, PUBLISHER_1);
  });

  it("selects an eligible older epoch over an ineligible newer one", () => {
    const result = evaluateAcceptance({
      publishers: [
        publisher(PUBLISHER_1, [
          epoch(0, ROOT_A, null, MANIFEST_1),
          epoch(1, ROOT_C, ROOT_A, MANIFEST_3),
        ]),
      ],
      confirmationsByManifest: confirmations([[MANIFEST_1, [CONFIRMER_A]]]),
      policy: POLICY_1,
    });
    assert.equal(result.bestEligible?.epoch, 0);
    assert.equal(result.bestEligible?.merkleRoot, ROOT_A);
  });
});

describe("evaluateAcceptance policy parameter", () => {
  const base = () => ({
    publishers: [publisher(PUBLISHER_1, [epoch(0, ROOT_A, null, MANIFEST_1)])],
    confirmationsByManifest: confirmations([[MANIFEST_1, [CONFIRMER_A]]]),
  });

  it("threshold 0 — eligible with no confirmations at all", () => {
    const result = evaluateAcceptance({
      publishers: [publisher(PUBLISHER_1, [epoch(0, ROOT_A, null, MANIFEST_1)])],
      confirmationsByManifest: confirmations([]),
      policy: { minIndependentConfirmations: 0 },
    });
    assert.equal(result.verdicts[0].eligible, true);
  });

  it("threshold 1 — one independent confirmation suffices", () => {
    const result = evaluateAcceptance({
      ...base(),
      policy: { minIndependentConfirmations: 1 },
    });
    assert.equal(result.verdicts[0].eligible, true);
  });

  it("threshold 2 (mainnet rule) — one confirmation is insufficient", () => {
    const result = evaluateAcceptance({
      ...base(),
      policy: { minIndependentConfirmations: 2 },
    });
    assert.equal(result.verdicts[0].eligible, false);
    assert.deepEqual(result.verdicts[0].reasons, [
      { code: "insufficient-confirmations", have: 1, need: 2 },
    ]);
  });
});

describe("comparePinnedRoot", () => {
  it("matches-pinned when the best root equals the pin", () => {
    assert.equal(comparePinnedRoot(ROOT_A, ROOT_A), "matches-pinned");
  });

  it("switch-pending when the best root differs from the pin", () => {
    assert.equal(comparePinnedRoot(ROOT_B, ROOT_A), "switch-pending");
  });
});
