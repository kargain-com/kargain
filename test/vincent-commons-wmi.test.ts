/**
 * F-2.1 document-based wmi claim proposal tests — nullable canonical form
 * with a pinned claimHash, ISO 3166-1 alpha-2 rejection, kind 31861 envelope
 * d/hash integrity, fail-closed tamper drops, cross-author dedupe, and the
 * proposer-plus-independent threshold display logic.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalize, claimHash, parseClaim } from "@kargain/vincent/protocol";

import {
  buildCommonsClaimProposalEvent,
  commonsClaimProposalFilterForWmis,
  commonsWmiProposalEntryFromEvent,
  commonsWmiProposalFromEvent,
  COMMONS_CLAIM_PROPOSAL_KIND,
  dedupeCommonsWmiProposalEntries,
  type CommonsWmiProposalEntry,
} from "../lib/nostr/commons-claims.ts";
import {
  buildWmiClaim,
  wmiProposalThreshold,
} from "../lib/vincent-commons/wmi-claim.ts";

const FIXTURE_INPUT = {
  wmi: "TES",
  manufacturer: "Example Werke GmbH",
  country: "",
  vehicleType: "",
};

/** Pinned content id of the null-form fixture (present-as-null country/vehicleType). */
const FIXTURE_CLAIM_HASH =
  "sha256:08176300c8b25240f890c3562cc400e6bfb8f9aeadce59dd8112073276806a23";

function buildFixtureClaim() {
  const result = buildWmiClaim(FIXTURE_INPUT);
  assert.ok(result.ok);
  return result;
}

type ProposalEvent = {
  id: string;
  pubkey: string;
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
};

function proposalEvent(overrides: Partial<ProposalEvent> = {}): ProposalEvent {
  const built = buildFixtureClaim();
  const template = buildCommonsClaimProposalEvent(built.claim, 1_700_000_000);
  return {
    id: "e1",
    pubkey: "pubkey-a",
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    created_at: template.created_at,
    ...overrides,
  };
}

describe("buildWmiClaim — nullable canonical form", () => {
  it("keeps empty country/vehicleType present-as-null and pins the claimHash", () => {
    const result = buildFixtureClaim();

    assert.equal(result.claim.value.country, null);
    assert.equal(result.claim.value.vehicleType, null);
    assert.equal(result.claim.provenance, "community/document");
    assert.equal(result.claim.license, "CC0-1.0");
    // Region is derived from the WMI first character, never user input.
    assert.equal(result.claim.value.region, "europe");

    const canonical = canonicalize(result.claim);
    assert.ok(canonical.includes('"country":null'));
    assert.ok(canonical.includes('"vehicleType":null'));

    assert.equal(result.hash, FIXTURE_CLAIM_HASH);
    assert.equal(claimHash(result.claim), FIXTURE_CLAIM_HASH);
  });

  it("is idempotent and parseClaim-valid on the wire", () => {
    const first = buildFixtureClaim();
    const second = buildFixtureClaim();
    assert.equal(first.hash, second.hash);

    const roundtrip = parseClaim(JSON.parse(canonicalize(first.claim)));
    assert.ok(roundtrip.ok);
    assert.equal(claimHash(roundtrip.value), FIXTURE_CLAIM_HASH);
  });

  it("trims inputs and normalizes country to uppercase", () => {
    const result = buildWmiClaim({
      wmi: " TES ",
      manufacturer: " Example Werke GmbH ",
      country: "de",
      vehicleType: " Passenger car ",
    });
    assert.ok(result.ok);
    assert.equal(result.claim.key.wmi, "TES");
    assert.equal(result.claim.value.manufacturer, "Example Werke GmbH");
    assert.equal(result.claim.value.country, "DE");
    assert.equal(result.claim.value.vehicleType, "Passenger car");
    // Different fact core than the null form — country/vehicleType are meaningful.
    assert.notEqual(result.hash, FIXTURE_CLAIM_HASH);
  });

  it("rejects non-alpha-2 country values", () => {
    for (const country of ["USA", "D", "D1", "d-e", "🇩🇪"]) {
      const result = buildWmiClaim({ ...FIXTURE_INPUT, country });
      assert.ok(!result.ok, `country ${country} should fail`);
      assert.equal(result.reason, "invalid-country");
    }
  });

  it("requires a manufacturer", () => {
    const result = buildWmiClaim({ ...FIXTURE_INPUT, manufacturer: "   " });
    assert.ok(!result.ok);
    assert.equal(result.reason, "manufacturer-required");
  });

  it("fails when the WMI first character has no region", () => {
    for (const wmi of ["", "IAB"]) {
      const result = buildWmiClaim({ ...FIXTURE_INPUT, wmi });
      assert.ok(!result.ok, `wmi ${JSON.stringify(wmi)} should fail`);
      assert.equal(result.reason, "unknown-region");
    }
  });

  it("fails closed on invalid WMI codes via parseClaim", () => {
    const tooLong = buildWmiClaim({ ...FIXTURE_INPUT, wmi: "TESLA" });
    assert.ok(!tooLong.ok);

    const badChar = buildWmiClaim({ ...FIXTURE_INPUT, wmi: "TEQ" });
    assert.ok(!badChar.ok);
  });
});

describe("kind 31861 envelope", () => {
  it("builds d = claimHash, w = WMI, content = JCS claim", () => {
    const built = buildFixtureClaim();
    const template = buildCommonsClaimProposalEvent(built.claim, 1_700_000_000);

    assert.equal(template.kind, COMMONS_CLAIM_PROPOSAL_KIND);
    assert.deepEqual(template.tags, [
      ["d", FIXTURE_CLAIM_HASH],
      ["w", "TES"],
    ]);
    assert.equal(template.content, canonicalize(built.claim));
  });

  it("roundtrips through commonsWmiProposalFromEvent", () => {
    const proposal = commonsWmiProposalFromEvent(proposalEvent());
    assert.ok(proposal);
    assert.equal(proposal.claimHash, FIXTURE_CLAIM_HASH);
    assert.equal(proposal.claim.key.wmi, "TES");
  });

  it("builds a #w discovery filter", () => {
    const filter = commonsClaimProposalFilterForWmis(["TES", "TES", "XX9"]);
    assert.deepEqual(filter.kinds, [COMMONS_CLAIM_PROPOSAL_KIND]);
    assert.deepEqual(filter["#w"], ["TES", "XX9"]);
  });

  it("drops tampered content (hash no longer matches d)", () => {
    const built = buildFixtureClaim();
    const tampered = {
      ...built.claim,
      value: { ...built.claim.value, manufacturer: "Someone Else AG" },
    };
    const event = proposalEvent({ content: canonicalize(tampered) });
    assert.equal(commonsWmiProposalFromEvent(event), null);
  });

  it("drops d-tag and w-tag mismatches", () => {
    const dMismatch = proposalEvent({
      tags: [
        ["d", `sha256:${"00".repeat(32)}`],
        ["w", "TES"],
      ],
    });
    assert.equal(commonsWmiProposalFromEvent(dMismatch), null);

    const wMismatch = proposalEvent({
      tags: [
        ["d", FIXTURE_CLAIM_HASH],
        ["w", "XX9"],
      ],
    });
    assert.equal(commonsWmiProposalFromEvent(wMismatch), null);
  });

  it("drops wrong kinds, invalid JSON, and non-wmi claims", () => {
    assert.equal(commonsWmiProposalFromEvent(proposalEvent({ kind: 31860 })), null);
    assert.equal(commonsWmiProposalFromEvent(proposalEvent({ content: "{" })), null);

    const schemaClaim = parseClaim({
      schemaVersion: "1.1",
      provenance: "regulatory/us-vpic",
      license: "CC0-1.0",
      type: "vds-schema",
      key: { name: "vds:TES:2020" },
      value: {},
    });
    assert.ok(schemaClaim.ok);
    const nonWmi = proposalEvent({
      tags: [
        ["d", claimHash(schemaClaim.value)],
        ["w", "TES"],
      ],
      content: canonicalize(schemaClaim.value),
    });
    assert.equal(commonsWmiProposalFromEvent(nonWmi), null);
  });
});

describe("cross-author dedupe", () => {
  function entriesFromEvents(events: ProposalEvent[]): CommonsWmiProposalEntry[] {
    return dedupeCommonsWmiProposalEntries(
      events
        .map((event) => commonsWmiProposalEntryFromEvent(event))
        .filter((entry): entry is CommonsWmiProposalEntry => entry !== null),
    );
  }

  it("keeps one entry per claimHash — the earliest event wins", () => {
    const entries = entriesFromEvents([
      proposalEvent({ id: "e2", pubkey: "pubkey-b", created_at: 1_700_000_100 }),
      proposalEvent({ id: "e1", pubkey: "pubkey-a", created_at: 1_700_000_000 }),
    ]);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].authorPubkey, "pubkey-a");
    assert.equal(entries[0].createdAt, 1_700_000_000);
  });

  it("resolves created_at ties to the lower event id", () => {
    const entries = entriesFromEvents([
      proposalEvent({ id: "e9", pubkey: "pubkey-b", created_at: 1_700_000_000 }),
      proposalEvent({ id: "e1", pubkey: "pubkey-a", created_at: 1_700_000_000 }),
    ]);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].eventId, "e1");
    assert.equal(entries[0].authorPubkey, "pubkey-a");
  });

  it("ignores invalid events entirely", () => {
    const entries = entriesFromEvents([proposalEvent({ content: "not json" })]);
    assert.equal(entries.length, 0);
  });
});

describe("wmiProposalThreshold — display logic", () => {
  const PROPOSER = "proposer-pubkey";

  it("is not met with the proposer endorse alone", () => {
    const threshold = wmiProposalThreshold(PROPOSER, [
      { address: "0xaa", pubkey: PROPOSER },
    ]);
    assert.equal(threshold.met, false);
    assert.equal(threshold.proposerEndorsed, true);
    assert.equal(threshold.independentAccepts, 0);
  });

  it("is met with the proposer plus one independent accept", () => {
    const threshold = wmiProposalThreshold(PROPOSER, [
      { address: "0xaa", pubkey: PROPOSER },
      { address: "0xbb", pubkey: "other-pubkey" },
    ]);
    assert.equal(threshold.met, true);
    assert.equal(threshold.proposerEndorsed, true);
    assert.equal(threshold.independentAccepts, 1);
  });

  it("is not met with independents only — the proposer must endorse", () => {
    const threshold = wmiProposalThreshold(PROPOSER, [
      { address: "0xbb", pubkey: "other-pubkey" },
      { address: "0xcc", pubkey: "third-pubkey" },
    ]);
    assert.equal(threshold.met, false);
    assert.equal(threshold.proposerEndorsed, false);
    assert.equal(threshold.independentAccepts, 2);
  });

  it("dedupes endorsers by address and is empty-safe", () => {
    const duplicated = wmiProposalThreshold(PROPOSER, [
      { address: "0xBB", pubkey: "other-pubkey" },
      { address: "0xbb", pubkey: "other-pubkey" },
      { address: "0xaa", pubkey: PROPOSER },
    ]);
    assert.equal(duplicated.met, true);
    assert.equal(duplicated.independentAccepts, 1);

    assert.equal(wmiProposalThreshold(PROPOSER, []).met, false);
  });
});
