/**
 * F-3a batch assembler tests — threshold matrix (record-verifier ×1,
 * independent ×2, wmi proposer + 1 independent), standing-reject freeze,
 * window boundary at tMet ± 1s, gate 1 replay defeat, inactive-attester
 * exclusion, future-clamp, baseline subtraction, byte-identical reruns,
 * and attestation-archive completeness.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Event, Filter } from "nostr-tools";

import {
  addressFromPrivateKey,
  claimHash,
  signPersonalMessage,
} from "@kargain/vincent/protocol";
import type { WmiInfo } from "@kargain/vincent/wmi";

import { buildCommonsClaimProposalEvent } from "../lib/nostr/commons-claims.ts";
import {
  assembleCommunityBatch,
  SECONDS_PER_DAY,
  serializeAssemblyReport,
  serializeAttestationArchive,
  serializeClaimsJsonl,
  type AssembleInput,
  type AssemblyResult,
} from "../lib/vincent-commons/assemble.ts";
import {
  deriveClaims,
  type VincentObservation,
} from "../lib/vincent-commons/derive-claims.ts";
import {
  buildCommonsReviewEvent,
  buildUnsignedCommonsReview,
  reviewSigningPayload,
  verifyCommonsReview,
  type CommonsReview,
  type CommonsReviewKind,
} from "../lib/vincent-commons/review.ts";
import { buildWmiClaim } from "../lib/vincent-commons/wmi-claim.ts";

const KEY_A = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B = "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const KEY_C = "0x1111111111111111111111111111111111111111111111111111111111111111";
const KEY_D = "0x2222222222222222222222222222222222222222222222222222222222222222";

const ADDR_A = addressFromPrivateKey(KEY_A);
const ADDR_B = addressFromPrivateKey(KEY_B);
const ADDR_C = addressFromPrivateKey(KEY_C);
const ADDR_D = addressFromPrivateKey(KEY_D);

const PUBKEY_A = "pubkey-a";
const PUBKEY_B = "pubkey-b";
const PUBKEY_C = "pubkey-c";
const PUBKEY_D = "pubkey-d";

const T0 = 1_700_000_000;
const WINDOW_DAYS = 14;
const WINDOW_SECONDS = WINDOW_DAYS * SECONDS_PER_DAY;

// NA VIN (check digit valid, WMI 1HG) + EU VIN (WMI WVW) + unknown-WMI VIN (TES).
const NA_VIN = "1HGBH41JXMN109186";
const EU_VIN = "WVWZZZ1JZXW000012";
const TES_VIN = "TESZZZ1JZXW000012";

const NA_OBSERVATION: VincentObservation = {
  tokenId: "t1",
  vin: NA_VIN,
  year: 1991,
  make: "Honda",
  fuelType: "Petrol",
  transmission: "Manual",
};

const EU_OBSERVATION: VincentObservation = {
  tokenId: "t2",
  vin: EU_VIN,
  year: 1999,
  make: "Volkswagen",
  fuelType: "Diesel",
};

const TES_OBSERVATION: VincentObservation = {
  tokenId: "t3",
  vin: TES_VIN,
  year: 1999,
  make: "Example",
};

const OBSERVATIONS = [NA_OBSERVATION, EU_OBSERVATION, TES_OBSERVATION];

/** Record verifier of every source passport is A. */
const VERIFIER_BY_TOKEN_ID: Record<string, string> = {
  t1: ADDR_A.toLowerCase(),
  t2: ADDR_A.toLowerCase(),
};

/** Deterministic offline WMI table: TES unknown, everything else known. */
const fixtureLookupWmi = async (vinOrWmi: string): Promise<WmiInfo | null> =>
  vinOrWmi.startsWith("TES")
    ? null
    : {
        wmi: vinOrWmi.slice(0, 3),
        manufacturer: "Known Manufacturer",
        country: null,
        vehicleType: null,
      };

const WMI_CLAIM = (() => {
  const built = buildWmiClaim({
    wmi: "TES",
    manufacturer: "Example Werke GmbH",
    country: "",
    vehicleType: "",
  });
  assert.ok(built.ok);
  return built;
})();

type DerivedFixture = {
  /** NA fuelType pattern (record verifier A via t1). */
  naFuelPatternHash: string;
  /** NA transmission pattern (same group). */
  naTransmissionPatternHash: string;
  naSchemaHash: string;
  naBindingHash: string;
  euPatternHash: string;
  euSchemaHash: string;
};

let cachedFixture: Promise<DerivedFixture> | null = null;

function derivedFixture(): Promise<DerivedFixture> {
  cachedFixture ??= (async () => {
    const { claims } = await deriveClaims(OBSERVATIONS, { lookupWmi: fixtureLookupWmi });
    const find = (predicate: (claim: (typeof claims)[number]) => boolean): string => {
      const claim = claims.find(predicate);
      assert.ok(claim, "fixture claim present");
      return claimHash(claim);
    };
    const naSchemaHash = find(
      (c) => c.type === "vds-schema" && c.key.name.includes("1HG"),
    );
    return {
      naSchemaHash,
      naBindingHash: find((c) => c.type === "vds-binding" && c.key.wmi === "1HG"),
      naFuelPatternHash: find(
        (c) =>
          c.type === "vds-pattern" &&
          c.key.schema === naSchemaHash &&
          c.value.attribute === "fuelType",
      ),
      naTransmissionPatternHash: find(
        (c) =>
          c.type === "vds-pattern" &&
          c.key.schema === naSchemaHash &&
          c.value.attribute === "transmission",
      ),
      euSchemaHash: find((c) => c.type === "vds-schema" && c.key.name.includes("WVW")),
      euPatternHash: find(
        (c) => c.type === "vds-pattern" && c.key.schema !== naSchemaHash,
      ),
    };
  })();
  return cachedFixture;
}

function signReview(
  claim: string,
  attester: string,
  kind: CommonsReviewKind,
  privateKey: string,
): CommonsReview {
  const unsigned = buildUnsignedCommonsReview(claim, attester, kind);
  const signature = signPersonalMessage(reviewSigningPayload(unsigned), privateKey);
  return { ...unsigned, signature };
}

let eventCounter = 0;

function reviewEvent(options: {
  claim: string;
  privateKey: string;
  kind: CommonsReviewKind;
  createdAt: number;
  pubkey: string;
  id?: string;
}): Event {
  const attester = addressFromPrivateKey(options.privateKey);
  const review = signReview(options.claim, attester, options.kind, options.privateKey);
  const template = buildCommonsReviewEvent(review, options.createdAt);
  eventCounter += 1;
  return {
    ...template,
    id: options.id ?? `rev-${String(eventCounter).padStart(4, "0")}`,
    pubkey: options.pubkey,
    sig: "",
  };
}

function proposalEvent(options: {
  createdAt: number;
  pubkey: string;
  id?: string;
}): Event {
  const template = buildCommonsClaimProposalEvent(WMI_CLAIM.claim, options.createdAt);
  eventCounter += 1;
  return {
    ...template,
    id: options.id ?? `prop-${String(eventCounter).padStart(4, "0")}`,
    pubkey: options.pubkey,
    sig: "",
  };
}

function makeQueryEvents(events: readonly Event[]): (filter: Filter) => Promise<Event[]> {
  return async (filter) =>
    events.filter((event) => {
      if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
      const dTags = filter["#d"];
      if (dTags) {
        const d = event.tags.find((tag) => tag[0] === "d")?.[1];
        if (!d || !dTags.includes(d)) return false;
      }
      const wTags = filter["#w"];
      if (wTags) {
        const w = event.tags.find((tag) => tag[0] === "w")?.[1];
        if (!w || !wTags.includes(w)) return false;
      }
      return true;
    });
}

const DEFAULT_ATTESTED = new Map<string, string | null>([
  [ADDR_A.toLowerCase(), PUBKEY_A],
  [ADDR_B.toLowerCase(), PUBKEY_B],
  [ADDR_C.toLowerCase(), PUBKEY_C],
  [ADDR_D.toLowerCase(), PUBKEY_D],
]);

const ALL_ACTIVE = new Map<string, boolean>([
  [ADDR_A.toLowerCase(), true],
  [ADDR_B.toLowerCase(), true],
  [ADDR_C.toLowerCase(), true],
  [ADDR_D.toLowerCase(), true],
]);

function runAssembly(options: {
  events: readonly Event[];
  nowSeconds: number;
  windowDays?: number;
  baselineHashes?: ReadonlySet<string>;
  attested?: Map<string, string | null>;
  active?: Map<string, boolean>;
  observations?: readonly VincentObservation[];
}): Promise<AssemblyResult> {
  const input: AssembleInput = {
    observations: options.observations ?? OBSERVATIONS,
    verifierByTokenId: VERIFIER_BY_TOKEN_ID,
    nowSeconds: options.nowSeconds,
    windowDays: options.windowDays ?? WINDOW_DAYS,
    baselineHashes: options.baselineHashes ?? new Set(),
    deps: {
      queryEvents: makeQueryEvents(options.events),
      attestedPubkeys: async (addresses) =>
        new Map(
          addresses.map((address) => [
            address,
            (options.attested ?? DEFAULT_ATTESTED).get(address) ?? null,
          ]),
        ),
      isActiveVerifier: async (addresses) =>
        new Map(
          addresses.map((address) => [
            address,
            (options.active ?? ALL_ACTIVE).get(address) === true,
          ]),
        ),
      lookupWmi: fixtureLookupWmi,
    },
  };
  return assembleCommunityBatch(input);
}

function exclusionFor(result: AssemblyResult, hash: string) {
  return result.report.excluded.find((e) => e.claimHash === hash);
}

function acceptedEntryFor(result: AssemblyResult, hash: string) {
  return result.report.accepted.find((e) => e.claimHash === hash);
}

describe("assemble — threshold matrix", () => {
  it("accepts a pattern on a single record-verifier endorse (minAccepts = 1)", async () => {
    const { naFuelPatternHash, naSchemaHash, naBindingHash } = await derivedFixture();
    const result = await runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_A,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_A,
        }),
      ],
      nowSeconds: T0 + WINDOW_SECONDS,
    });

    const entry = acceptedEntryFor(result, naFuelPatternHash);
    assert.ok(entry, "pattern accepted");
    assert.equal(entry.tMet, T0);
    assert.deepEqual(entry.endorsers, [ADDR_A.toLowerCase()]);

    const outputHashes = result.acceptedClaims.map((claim) => claimHash(claim));
    assert.deepEqual(
      [...outputHashes].sort(),
      [naFuelPatternHash, naSchemaHash, naBindingHash].sort(),
      "pattern + its group schema/binding declarations",
    );
  });

  it("requires two independent accepts when no record verifier endorsed", async () => {
    const { naFuelPatternHash } = await derivedFixture();

    const oneIndependent = await runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_B,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_B,
        }),
      ],
      nowSeconds: T0 + 10 * WINDOW_SECONDS,
    });
    const excluded = exclusionFor(oneIndependent, naFuelPatternHash);
    assert.equal(excluded?.reason, "below-threshold");
    assert.equal(excluded?.acceptCount, 1);

    const twoIndependent = await runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_B,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_B,
        }),
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_C,
          kind: "endorse",
          createdAt: T0 + 100,
          pubkey: PUBKEY_C,
        }),
      ],
      nowSeconds: T0 + 100 + WINDOW_SECONDS,
    });
    const entry = acceptedEntryFor(twoIndependent, naFuelPatternHash);
    assert.ok(entry, "accepted with two independents");
    assert.equal(entry.tMet, T0 + 100, "tMet = second independent accept");
  });

  it("accepts a wmi proposal on proposer endorse + one independent accept", async () => {
    const proposal = proposalEvent({ createdAt: T0, pubkey: PUBKEY_B });

    const proposerOnly = await runAssembly({
      events: [
        proposal,
        reviewEvent({
          claim: WMI_CLAIM.hash,
          privateKey: KEY_B,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_B,
        }),
      ],
      nowSeconds: T0 + 10 * WINDOW_SECONDS,
    });
    assert.equal(exclusionFor(proposerOnly, WMI_CLAIM.hash)?.reason, "below-threshold");

    const independentsOnly = await runAssembly({
      events: [
        proposal,
        reviewEvent({
          claim: WMI_CLAIM.hash,
          privateKey: KEY_C,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_C,
        }),
        reviewEvent({
          claim: WMI_CLAIM.hash,
          privateKey: KEY_D,
          kind: "endorse",
          createdAt: T0 + 10,
          pubkey: PUBKEY_D,
        }),
      ],
      nowSeconds: T0 + 10 * WINDOW_SECONDS,
    });
    assert.equal(
      exclusionFor(independentsOnly, WMI_CLAIM.hash)?.reason,
      "below-threshold",
      "proposer must endorse",
    );

    const met = await runAssembly({
      events: [
        proposal,
        reviewEvent({
          claim: WMI_CLAIM.hash,
          privateKey: KEY_B,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_B,
        }),
        reviewEvent({
          claim: WMI_CLAIM.hash,
          privateKey: KEY_C,
          kind: "endorse",
          createdAt: T0 + 50,
          pubkey: PUBKEY_C,
        }),
      ],
      nowSeconds: T0 + 50 + WINDOW_SECONDS,
    });
    const entry = acceptedEntryFor(met, WMI_CLAIM.hash);
    assert.ok(entry, "wmi proposal accepted");
    assert.equal(entry.claimType, "wmi");
    assert.equal(entry.tMet, T0 + 50);
    assert.ok(
      met.acceptedClaims.some((claim) => claimHash(claim) === WMI_CLAIM.hash),
      "wmi fact core in output",
    );
  });
});

describe("assemble — standing-reject freeze", () => {
  it("freezes a claim on any gated reject, even when the threshold is met", async () => {
    const { naFuelPatternHash } = await derivedFixture();
    const result = await runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_A,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_A,
        }),
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_C,
          kind: "reject",
          createdAt: T0 + 10,
          pubkey: PUBKEY_C,
        }),
      ],
      nowSeconds: T0 + 10 * WINDOW_SECONDS,
    });

    const excluded = exclusionFor(result, naFuelPatternHash);
    assert.equal(excluded?.reason, "rejected");
    assert.deepEqual(excluded?.rejecters, [ADDR_C.toLowerCase()]);
    assert.equal(result.acceptedClaims.length, 0);
  });

  it("freezes on a reject arriving after the window elapsed", async () => {
    const { naFuelPatternHash } = await derivedFixture();
    const now = T0 + 2 * WINDOW_SECONDS;
    const result = await runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_A,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_A,
        }),
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_C,
          kind: "reject",
          createdAt: now - 5,
          pubkey: PUBKEY_C,
        }),
      ],
      nowSeconds: now,
    });
    assert.equal(exclusionFor(result, naFuelPatternHash)?.reason, "rejected");
  });
});

describe("assemble — optimistic window boundary", () => {
  it("excludes in-window one second before tMet + window and accepts at the boundary", async () => {
    const { naFuelPatternHash } = await derivedFixture();
    const events = [
      reviewEvent({
        claim: naFuelPatternHash,
        privateKey: KEY_A,
        kind: "endorse",
        createdAt: T0,
        pubkey: PUBKEY_A,
      }),
    ];

    const before = await runAssembly({ events, nowSeconds: T0 + WINDOW_SECONDS - 1 });
    const excluded = exclusionFor(before, naFuelPatternHash);
    assert.equal(excluded?.reason, "in-window");
    assert.equal(excluded?.tMet, T0);
    assert.equal(excluded?.remainingSeconds, 1);

    const at = await runAssembly({ events, nowSeconds: T0 + WINDOW_SECONDS });
    assert.ok(acceptedEntryFor(at, naFuelPatternHash), "accepted at now = tMet + window");
  });

  it("late supporting accepts never move tMet (no window restart)", async () => {
    const { naFuelPatternHash } = await derivedFixture();
    const result = await runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_B,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_B,
        }),
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_C,
          kind: "endorse",
          createdAt: T0 + 100,
          pubkey: PUBKEY_C,
        }),
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_D,
          kind: "endorse",
          createdAt: T0 + 200_000,
          pubkey: PUBKEY_D,
        }),
      ],
      nowSeconds: T0 + 100 + WINDOW_SECONDS,
    });

    const entry = acceptedEntryFor(result, naFuelPatternHash);
    assert.ok(entry, "accepted despite the later third accept");
    assert.equal(entry.tMet, T0 + 100, "tMet = threshold-first-met time");
    assert.deepEqual(
      entry.endorsers,
      [ADDR_B, ADDR_C, ADDR_D].map((a) => a.toLowerCase()).sort(),
    );
  });

  it("ignores accepts with created_at in the future of --now", async () => {
    const { naFuelPatternHash } = await derivedFixture();
    const now = T0 + WINDOW_SECONDS;
    const result = await runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_A,
          kind: "endorse",
          createdAt: now + 10,
          pubkey: PUBKEY_A,
        }),
      ],
      nowSeconds: now,
    });

    const excluded = exclusionFor(result, naFuelPatternHash);
    assert.equal(excluded?.reason, "below-threshold");
    assert.equal(excluded?.acceptCount, 0);
  });
});

describe("assemble — gates", () => {
  it("gate 1: a review republished under a foreign Nostr key is not counted", async () => {
    const { naFuelPatternHash } = await derivedFixture();
    const result = await runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_A,
          kind: "endorse",
          createdAt: T0,
          pubkey: "pubkey-mallory",
        }),
      ],
      nowSeconds: T0 + WINDOW_SECONDS,
    });

    const excluded = exclusionFor(result, naFuelPatternHash);
    assert.equal(excluded?.reason, "below-threshold");
    assert.equal(excluded?.acceptCount, 0);
  });

  it("gate 1 replay defeat: a stale endorse under a fresh key cannot override a later reject", async () => {
    const { naFuelPatternHash } = await derivedFixture();
    const result = await runAssembly({
      events: [
        // A's genuine standing verdict: reject.
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_A,
          kind: "reject",
          createdAt: T0 + 100,
          pubkey: PUBKEY_A,
        }),
        // Replayed old signed endorse from A, republished later by an
        // attacker under a fresh Nostr key with a newer created_at.
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_A,
          kind: "endorse",
          createdAt: T0 + 200,
          pubkey: "pubkey-attacker",
        }),
      ],
      nowSeconds: T0 + 10 * WINDOW_SECONDS,
    });

    assert.equal(
      exclusionFor(result, naFuelPatternHash)?.reason,
      "rejected",
      "the attested reject stands; the replayed endorse is discarded",
    );
  });

  it("gate 2: reports inactive-attester when only inactive accepts would meet the threshold", async () => {
    const { naFuelPatternHash } = await derivedFixture();
    const result = await runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_B,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_B,
        }),
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_C,
          kind: "endorse",
          createdAt: T0 + 50,
          pubkey: PUBKEY_C,
        }),
      ],
      active: new Map([
        [ADDR_B.toLowerCase(), true],
        [ADDR_C.toLowerCase(), false],
      ]),
      nowSeconds: T0 + 10 * WINDOW_SECONDS,
    });

    const excluded = exclusionFor(result, naFuelPatternHash);
    assert.equal(excluded?.reason, "inactive-attester");
    assert.deepEqual(excluded?.inactiveAttesters, [ADDR_C.toLowerCase()]);
  });

  it("a reject from an inactive attester does not freeze", async () => {
    const { naFuelPatternHash } = await derivedFixture();
    const result = await runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_A,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_A,
        }),
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_C,
          kind: "reject",
          createdAt: T0 + 10,
          pubkey: PUBKEY_C,
        }),
      ],
      active: new Map([
        [ADDR_A.toLowerCase(), true],
        [ADDR_C.toLowerCase(), false],
      ]),
      nowSeconds: T0 + WINDOW_SECONDS,
    });

    assert.ok(
      acceptedEntryFor(result, naFuelPatternHash),
      "record-verifier accept stands; inactive reject is not counted",
    );
  });
});

describe("assemble — output composition", () => {
  it("emits schema/binding only for groups with at least one accepted pattern", async () => {
    const { naFuelPatternHash, naSchemaHash, naBindingHash, euSchemaHash, euPatternHash } =
      await derivedFixture();
    const result = await runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_A,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_A,
        }),
      ],
      nowSeconds: T0 + WINDOW_SECONDS,
    });

    const hashes = new Set(result.acceptedClaims.map((claim) => claimHash(claim)));
    assert.ok(hashes.has(naFuelPatternHash));
    assert.ok(hashes.has(naSchemaHash));
    assert.ok(hashes.has(naBindingHash));
    assert.ok(!hashes.has(euSchemaHash), "unreviewed EU group emits no schema");
    assert.ok(!hashes.has(euPatternHash), "unreviewed EU pattern excluded");
    // The NA transmission pattern was not endorsed — not in the output.
    assert.equal(
      result.acceptedClaims.filter((c) => c.type === "vds-pattern").length,
      1,
    );
  });

  it("subtracts baseline claimHashes from the output", async () => {
    const { naFuelPatternHash, naSchemaHash, naBindingHash } = await derivedFixture();
    const events = [
      reviewEvent({
        claim: naFuelPatternHash,
        privateKey: KEY_A,
        kind: "endorse",
        createdAt: T0,
        pubkey: PUBKEY_A,
      }),
    ];

    const partial = await runAssembly({
      events,
      nowSeconds: T0 + WINDOW_SECONDS,
      baselineHashes: new Set([naSchemaHash]),
    });
    const partialHashes = partial.acceptedClaims.map((claim) => claimHash(claim));
    assert.deepEqual(
      [...partialHashes].sort(),
      [naFuelPatternHash, naBindingHash].sort(),
    );
    assert.equal(partial.report.baseline.subtracted, 1);

    const full = await runAssembly({
      events,
      nowSeconds: T0 + WINDOW_SECONDS,
      baselineHashes: new Set([naFuelPatternHash, naSchemaHash, naBindingHash]),
    });
    assert.equal(full.acceptedClaims.length, 0);
    assert.equal(full.report.baseline.subtracted, 3);
    assert.equal(serializeClaimsJsonl(full.acceptedClaims), "");
  });
});

describe("assemble — determinism and archive", () => {
  function fullScenarioEvents(): Event[] {
    // Fixed ids so reruns serialize identically.
    return [
      reviewEvent({
        claim: WMI_CLAIM.hash,
        privateKey: KEY_B,
        kind: "endorse",
        createdAt: T0,
        pubkey: PUBKEY_B,
        id: "rev-wmi-proposer",
      }),
      reviewEvent({
        claim: WMI_CLAIM.hash,
        privateKey: KEY_C,
        kind: "endorse",
        createdAt: T0 + 50,
        pubkey: PUBKEY_C,
        id: "rev-wmi-independent",
      }),
      proposalEvent({ createdAt: T0, pubkey: PUBKEY_B, id: "prop-tes" }),
    ];
  }

  async function fullScenario(): Promise<AssemblyResult> {
    const { naFuelPatternHash } = await derivedFixture();
    return runAssembly({
      events: [
        reviewEvent({
          claim: naFuelPatternHash,
          privateKey: KEY_A,
          kind: "endorse",
          createdAt: T0,
          pubkey: PUBKEY_A,
          id: "rev-na-record",
        }),
        ...fullScenarioEvents(),
      ],
      nowSeconds: T0 + 50 + WINDOW_SECONDS,
    });
  }

  it("reruns are byte-identical across all three serialized outputs", async () => {
    const first = await fullScenario();
    const second = await fullScenario();

    assert.equal(
      serializeClaimsJsonl(first.acceptedClaims),
      serializeClaimsJsonl(second.acceptedClaims),
    );
    assert.equal(
      serializeAttestationArchive(first.archive),
      serializeAttestationArchive(second.archive),
    );
    assert.equal(
      serializeAssemblyReport(first.report),
      serializeAssemblyReport(second.report),
    );
    assert.ok(serializeClaimsJsonl(first.acceptedClaims).endsWith("\n"));
  });

  it("archives the counted reviews (and proposal) for every accepted claim", async () => {
    const result = await fullScenario();
    assert.ok(result.report.accepted.length >= 2, "pattern + wmi accepted");

    for (const entry of result.report.accepted) {
      const archived = result.archive[entry.claimHash];
      assert.ok(archived, `archive entry for ${entry.claimHash}`);
      assert.ok(archived.reviews.length > 0, "reviews archived");
      assert.deepEqual(
        archived.reviews.map((r) => r.review.attester.toLowerCase()).sort(),
        entry.endorsers,
        "archived reviews cover exactly the counted attesters",
      );
      for (const archivedReview of archived.reviews) {
        const verified = verifyCommonsReview(archivedReview.review);
        assert.ok(verified.ok, "archived review doc verifies offline");
        assert.ok(archivedReview.eventId.length > 0);
      }
      if (entry.claimType === "wmi") {
        assert.ok(archived.proposal, "wmi archive carries the 31861 proposal");
        assert.equal(archived.proposal.eventId, "prop-tes");
        assert.equal(archived.proposal.authorPubkey, PUBKEY_B);
        assert.equal(claimHash(archived.proposal.claim), entry.claimHash);
      } else {
        assert.equal(archived.proposal, undefined);
      }
    }

    // Schema/binding declarations follow their patterns — no archive entries.
    const outputHashes = result.acceptedClaims
      .filter((c) => c.type === "vds-schema" || c.type === "vds-binding")
      .map((c) => claimHash(c));
    for (const hash of outputHashes) {
      assert.equal(result.archive[hash], undefined);
    }
  });
});
