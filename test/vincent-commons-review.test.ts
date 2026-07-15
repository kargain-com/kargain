/**
 * F-2 Vincent Commons review tests — endorse/reject sign→verify roundtrips,
 * tamper + attester-mismatch rejection, kind 31860 envelope, and the additive
 * deriveClaims sources map determinism.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addressFromPrivateKey,
  attest,
  claimHash,
  signingPayload,
  signPersonalMessage,
} from "@kargain/vincent/protocol";

import {
  deriveClaims,
  type VincentObservation,
} from "../lib/vincent-commons/derive-claims.ts";
import {
  buildCommonsReviewEvent,
  buildUnsignedCommonsReview,
  commonsReviewFromEvent,
  COMMONS_REVIEW_KIND,
  parseCommonsReview,
  reviewSigningPayload,
  verifyCommonsReview,
  type CommonsReview,
} from "../lib/vincent-commons/review.ts";

const KNOWN_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_PRIVATE_KEY =
  "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const KNOWN_ADDRESS = addressFromPrivateKey(KNOWN_PRIVATE_KEY);
const OTHER_ADDRESS = addressFromPrivateKey(OTHER_PRIVATE_KEY);

const CLAIM_ID = `sha256:${"ab".repeat(32)}`;

function signReview(
  claim: string,
  attester: string,
  kind: "endorse" | "reject",
  privateKey: string,
): CommonsReview {
  const unsigned = buildUnsignedCommonsReview(claim, attester, kind);
  const signature = signPersonalMessage(reviewSigningPayload(unsigned), privateKey);
  return { ...unsigned, signature };
}

describe("commons review — endorse roundtrip", () => {
  it("verifies an npm attest() endorsement via verifyCommonsReview", () => {
    const attestation = attest(CLAIM_ID, KNOWN_PRIVATE_KEY);
    const parsed = parseCommonsReview(attestation);
    assert.ok(parsed.ok);

    const verified = verifyCommonsReview(parsed.value);
    assert.ok(verified.ok);
    assert.equal(verified.attester, KNOWN_ADDRESS);
  });

  it("locally built endorse payload is byte-identical to the npm signingPayload", () => {
    const attestation = attest(CLAIM_ID, KNOWN_PRIVATE_KEY);
    const unsigned = buildUnsignedCommonsReview(CLAIM_ID, KNOWN_ADDRESS, "endorse");
    assert.equal(reviewSigningPayload(unsigned), signingPayload(attestation));
  });

  it("verifies an endorse built locally (wallet signature path)", () => {
    const review = signReview(CLAIM_ID, KNOWN_ADDRESS, "endorse", KNOWN_PRIVATE_KEY);
    const verified = verifyCommonsReview(review);
    assert.ok(verified.ok);
    assert.equal(verified.attester, KNOWN_ADDRESS);
  });
});

describe("commons review — reject roundtrip", () => {
  it("verifies a reject signed over the same JCS payload discipline", () => {
    const review = signReview(CLAIM_ID, KNOWN_ADDRESS, "reject", KNOWN_PRIVATE_KEY);
    const verified = verifyCommonsReview(review);
    assert.ok(verified.ok);
    assert.equal(verified.attester, KNOWN_ADDRESS);
  });
});

describe("commons review — tamper rejection", () => {
  it("rejects a review whose claim was mutated after signing", () => {
    const review = signReview(CLAIM_ID, KNOWN_ADDRESS, "reject", KNOWN_PRIVATE_KEY);
    const tampered: CommonsReview = {
      ...review,
      claim: `sha256:${"cd".repeat(32)}`,
    };
    const verified = verifyCommonsReview(tampered);
    assert.ok(!verified.ok);
  });

  it("rejects a review whose kind was flipped after signing", () => {
    const endorse = signReview(CLAIM_ID, KNOWN_ADDRESS, "endorse", KNOWN_PRIVATE_KEY);
    const flipped: CommonsReview = { ...endorse, kind: "reject" };
    const verified = verifyCommonsReview(flipped);
    assert.ok(!verified.ok);
  });
});

describe("commons review — attester mismatch", () => {
  it("rejects when the signature recovers a different address than attester", () => {
    for (const kind of ["endorse", "reject"] as const) {
      const review = signReview(CLAIM_ID, OTHER_ADDRESS, kind, KNOWN_PRIVATE_KEY);
      const verified = verifyCommonsReview(review);
      assert.ok(!verified.ok, `${kind} must fail on attester mismatch`);
    }
  });
});

describe("commons review — wire parser", () => {
  it("rejects malformed documents fail-closed", () => {
    const valid = signReview(CLAIM_ID, KNOWN_ADDRESS, "endorse", KNOWN_PRIVATE_KEY);
    assert.ok(parseCommonsReview(valid).ok);

    assert.ok(!parseCommonsReview(null).ok);
    assert.ok(!parseCommonsReview([]).ok);
    assert.ok(!parseCommonsReview({ ...valid, extra: 1 }).ok);
    assert.ok(!parseCommonsReview({ ...valid, schemaVersion: "2.0" }).ok);
    assert.ok(!parseCommonsReview({ ...valid, claim: "not-a-hash" }).ok);
    assert.ok(!parseCommonsReview({ ...valid, attester: "0x123" }).ok);
    assert.ok(!parseCommonsReview({ ...valid, kind: "maybe" }).ok);
    assert.ok(!parseCommonsReview({ ...valid, signature: "0xzz" }).ok);
  });
});

describe("commons review — kind 31860 envelope", () => {
  it("builds a parameterized replaceable event with d tag = claimHash", () => {
    const review = signReview(CLAIM_ID, KNOWN_ADDRESS, "endorse", KNOWN_PRIVATE_KEY);
    const event = buildCommonsReviewEvent(review, 1_752_000_000);

    assert.equal(event.kind, COMMONS_REVIEW_KIND);
    assert.equal(event.kind, 31860);
    assert.deepEqual(event.tags, [["d", CLAIM_ID]]);
    assert.equal(event.created_at, 1_752_000_000);

    const parsed = parseCommonsReview(JSON.parse(event.content));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, review);
  });

  it("commonsReviewFromEvent verifies and returns the review", () => {
    const review = signReview(CLAIM_ID, KNOWN_ADDRESS, "reject", KNOWN_PRIVATE_KEY);
    const event = buildCommonsReviewEvent(review, 1_752_000_000);
    assert.deepEqual(commonsReviewFromEvent(event), review);
  });

  it("fails closed on d-tag mismatch, wrong kind, and bad signature", () => {
    const review = signReview(CLAIM_ID, KNOWN_ADDRESS, "endorse", KNOWN_PRIVATE_KEY);
    const event = buildCommonsReviewEvent(review, 1_752_000_000);

    assert.equal(
      commonsReviewFromEvent({ ...event, tags: [["d", `sha256:${"cd".repeat(32)}`]] }),
      null,
    );
    assert.equal(commonsReviewFromEvent({ ...event, kind: 30078 }), null);

    const tampered = { ...review, claim: `sha256:${"cd".repeat(32)}` };
    assert.equal(
      commonsReviewFromEvent({
        kind: COMMONS_REVIEW_KIND,
        tags: [["d", tampered.claim]],
        content: JSON.stringify(tampered),
      }),
      null,
    );
  });
});

// --- sources map -----------------------------------------------------------

// NA VIN with a valid check digit; EU VIN without (same fixtures as F-1 tests).
const NA_VIN = "1HGBH41JXMN109186";
const EU_VIN = "WVWZZZ1JZXW000012";

const NA_OBSERVATION: VincentObservation = {
  tokenId: "t1",
  vin: NA_VIN,
  year: 1991,
  make: "Honda",
  model: "Civic",
  modelVariant: "EX",
  bodyType: "Sedan",
  fuelType: "Petrol",
  transmission: "Manual",
  engine: "D15B2",
};

const EU_OBSERVATION: VincentObservation = {
  tokenId: "t2",
  vin: EU_VIN,
  year: 1999,
  make: "Volkswagen",
  model: "Golf",
  fuelType: "Diesel",
};

describe("deriveClaims — sources map", () => {
  it("is deterministic and order-insensitive (identical JSON)", async () => {
    const a = await deriveClaims([NA_OBSERVATION, EU_OBSERVATION]);
    const b = await deriveClaims([EU_OBSERVATION, NA_OBSERVATION]);
    assert.equal(JSON.stringify(a.sources), JSON.stringify(b.sources));
  });

  it("keys the map by every emitted claimHash, in claim order", async () => {
    const { claims, sources } = await deriveClaims([NA_OBSERVATION, EU_OBSERVATION]);
    assert.deepEqual(
      Object.keys(sources),
      claims.map((claim) => claimHash(claim)),
    );
  });

  it("attributes schema/binding/pattern claims to their group tokenIds", async () => {
    const { claims, sources } = await deriveClaims([NA_OBSERVATION, EU_OBSERVATION]);
    for (const claim of claims) {
      const entry = sources[claimHash(claim)];
      assert.ok(entry, `missing sources entry for ${claim.type}`);
      if (claim.type === "vds-binding") {
        assert.deepEqual(entry.tokenIds, claim.key.wmi === "1HG" ? ["t1"] : ["t2"]);
      } else {
        // schema and pattern claims from single-passport groups
        assert.equal(entry.tokenIds.length, 1);
      }
    }
  });

  it("merges tokenIds when identical observations dedupe by claimHash", async () => {
    const duplicate: VincentObservation = { ...NA_OBSERVATION, tokenId: "t1b" };
    const { claims, sources } = await deriveClaims([NA_OBSERVATION, duplicate]);
    for (const claim of claims) {
      assert.deepEqual(sources[claimHash(claim)].tokenIds, ["t1", "t1b"]);
    }
  });

  it("never embeds sources in the claim JSON", async () => {
    const { claims } = await deriveClaims([NA_OBSERVATION]);
    for (const claim of claims) {
      assert.ok(!JSON.stringify(claim).includes("tokenId"));
      assert.ok(!JSON.stringify(claim).includes("sources"));
    }
  });
});
