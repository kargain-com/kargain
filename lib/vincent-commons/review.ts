/**
 * F-2 Vincent Commons review documents (docs/research/vincent-flywheel.md §4.3).
 *
 * `endorse` is exactly the PROTOCOL §4.9 attestation — built and verified via
 * `@kargain/vincent/protocol`. `reject` follows the same JCS signing-payload
 * discipline (EIP-191 recover must equal `attester`) with a local mirror,
 * because the npm `AttestationKind` union is `'endorse'`-only in v0.8.0.
 *
 * Pure module: Nostr transport lives in lib/nostr/commons-reviews.ts.
 */
import {
  canonicalize,
  isValidChecksumAddress,
  parseAttestation,
  recoverPersonalSignAddress,
  toChecksumAddress,
  verifyAttestation,
} from "@kargain/vincent/protocol";

/** Parameterized replaceable Nostr kind carrying one review per (author, claim). */
export const COMMONS_REVIEW_KIND = 31860;

export type CommonsReviewKind = "endorse" | "reject";

/** Review wire format — for `endorse` identical to the §4.9 attestation. */
export type CommonsReview = {
  schemaVersion: "1.0";
  claim: string;
  attester: string;
  kind: CommonsReviewKind;
  signature: string;
};

export type UnsignedCommonsReview = Omit<CommonsReview, "signature">;

export type CommonsReviewVerifyResult =
  | { ok: true; attester: string }
  | { ok: false; reason: string };

export type CommonsReviewParseResult =
  | { ok: true; value: CommonsReview }
  | { ok: false; reason: string };

const REVIEW_KINDS: readonly CommonsReviewKind[] = ["endorse", "reject"];
const REVIEW_KEYS_SORTED: readonly string[] = [
  "attester",
  "claim",
  "kind",
  "schemaVersion",
  "signature",
];

const CLAIM_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/;

/** Normalized unsigned review for a wallet signature (attester checksummed). */
export function buildUnsignedCommonsReview(
  claim: string,
  attester: string,
  kind: CommonsReviewKind,
): UnsignedCommonsReview {
  return {
    schemaVersion: "1.0",
    claim,
    attester: toChecksumAddress(attester),
    kind,
  };
}

/** JCS-canonical signing payload excluding `signature` (mirrors npm signingPayload). */
export function reviewSigningPayload(
  review: UnsignedCommonsReview | CommonsReview,
): string {
  const rest: Record<string, unknown> = { ...review };
  delete rest.signature;
  return canonicalize(rest);
}

/** Fail-closed wire parser for both review kinds; rejects unknown keys. */
export function parseCommonsReview(json: unknown): CommonsReviewParseResult {
  if (json == null || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, reason: "not-an-object" };
  }
  const record = json as Record<string, unknown>;

  const keys = Object.keys(record).sort();
  if (
    keys.length !== REVIEW_KEYS_SORTED.length ||
    keys.some((key, index) => key !== REVIEW_KEYS_SORTED[index])
  ) {
    return { ok: false, reason: "unexpected-keys" };
  }

  if (record.schemaVersion !== "1.0") return { ok: false, reason: "schema-version" };

  const claim = record.claim;
  if (typeof claim !== "string" || !CLAIM_HASH_RE.test(claim)) {
    return { ok: false, reason: "invalid-claim" };
  }

  const attester = record.attester;
  if (typeof attester !== "string" || !ADDRESS_RE.test(attester)) {
    return { ok: false, reason: "invalid-attester" };
  }

  const kind = record.kind;
  if (typeof kind !== "string" || !REVIEW_KINDS.includes(kind as CommonsReviewKind)) {
    return { ok: false, reason: "invalid-kind" };
  }

  const signature = record.signature;
  if (typeof signature !== "string" || !SIGNATURE_RE.test(signature)) {
    return { ok: false, reason: "invalid-signature" };
  }

  return {
    ok: true,
    value: {
      schemaVersion: "1.0",
      claim,
      attester,
      kind: kind as CommonsReviewKind,
      signature,
    },
  };
}

/**
 * Verify a review signature. Endorse delegates to the npm §4.9 verifier;
 * reject mirrors it: valid EIP-55 attester, EIP-191 recover over the JCS
 * payload must equal `attester` exactly.
 */
export function verifyCommonsReview(review: CommonsReview): CommonsReviewVerifyResult {
  if (review.kind === "endorse") {
    const parsed = parseAttestation(review);
    if (!parsed.ok) return { ok: false, reason: parsed.error.code };
    return verifyAttestation(parsed.value);
  }

  if (!isValidChecksumAddress(review.attester)) {
    return { ok: false, reason: "invalid-checksum" };
  }
  let recovered: string;
  try {
    recovered = recoverPersonalSignAddress(reviewSigningPayload(review), review.signature);
  } catch {
    return { ok: false, reason: "invalid-signature" };
  }
  if (recovered !== review.attester) {
    return { ok: false, reason: "address-mismatch" };
  }
  return { ok: true, attester: review.attester };
}

/** Unsigned Nostr event template: `d` tag = claimHash, content = JCS review JSON. */
export type CommonsReviewEventTemplate = {
  kind: typeof COMMONS_REVIEW_KIND;
  created_at: number;
  tags: string[][];
  content: string;
};

export function buildCommonsReviewEvent(
  review: CommonsReview,
  createdAt: number,
): CommonsReviewEventTemplate {
  return {
    kind: COMMONS_REVIEW_KIND,
    created_at: createdAt,
    tags: [["d", review.claim]],
    content: canonicalize(review),
  };
}

type CommonsReviewEventShape = {
  kind: number;
  tags: string[][];
  content: string;
};

/**
 * Parse + verify a kind 31860 event into a review. Fail-closed: wrong kind,
 * invalid JSON, failed signature, or `d` tag ≠ `review.claim` all yield null.
 */
export function commonsReviewFromEvent(
  event: CommonsReviewEventShape,
): CommonsReview | null {
  if (event.kind !== COMMONS_REVIEW_KIND) return null;

  let json: unknown;
  try {
    json = JSON.parse(event.content);
  } catch {
    return null;
  }

  const parsed = parseCommonsReview(json);
  if (!parsed.ok) return null;

  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
  if (dTag !== parsed.value.claim) return null;

  const verified = verifyCommonsReview(parsed.value);
  if (!verified.ok) return null;

  return parsed.value;
}
