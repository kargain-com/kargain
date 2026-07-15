/**
 * F-3c Vincent Commons epoch confirmation documents
 * (docs/research/vincent-flywheel.md §4.4, PROTOCOL §6 ManifestAttestation).
 *
 * A confirmation records that an independent active verifier rebuilt a
 * published epoch byte-for-byte (`rebuilt` — the only kind that carries
 * compilation weight). Same JCS + EIP-191 signing discipline as reviews:
 * the recover over the canonical payload must equal `attester` exactly.
 *
 * Pure module: Nostr transport lives in lib/nostr/commons-confirmations.ts;
 * the rebuild gate lives in lib/vincent-commons/confirm-epoch.ts.
 */
import {
  addressFromPrivateKey,
  canonicalize,
  isValidChecksumAddress,
  recoverPersonalSignAddress,
  signPersonalMessage,
  toChecksumAddress,
} from "@kargain/vincent/protocol";

/** Parameterized replaceable Nostr kind carrying one confirmation per (author, manifest). */
export const COMMONS_CONFIRMATION_KIND = 31862;

export type CommonsConfirmationKind = "rebuilt";

/** Confirmation wire format — PROTOCOL §6 ManifestAttestation as a signed document. */
export type CommonsConfirmation = {
  schemaVersion: "1.0";
  manifest: string;
  attester: string;
  kind: CommonsConfirmationKind;
  signature: string;
};

export type UnsignedCommonsConfirmation = Omit<CommonsConfirmation, "signature">;

export type CommonsConfirmationVerifyResult =
  | { ok: true; attester: string }
  | { ok: false; reason: string };

export type CommonsConfirmationParseResult =
  | { ok: true; value: CommonsConfirmation }
  | { ok: false; reason: string };

const CONFIRMATION_KEYS_SORTED: readonly string[] = [
  "attester",
  "kind",
  "manifest",
  "schemaVersion",
  "signature",
];

const MANIFEST_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/;

/** Normalized unsigned confirmation for a wallet signature (attester checksummed). */
export function buildUnsignedCommonsConfirmation(
  manifest: string,
  attester: string,
): UnsignedCommonsConfirmation {
  return {
    schemaVersion: "1.0",
    manifest,
    attester: toChecksumAddress(attester),
    kind: "rebuilt",
  };
}

/** JCS-canonical signing payload excluding `signature` (mirrors reviews). */
export function confirmationSigningPayload(
  confirmation: UnsignedCommonsConfirmation | CommonsConfirmation,
): string {
  const rest: Record<string, unknown> = { ...confirmation };
  delete rest.signature;
  return canonicalize(rest);
}

/**
 * Sign a `rebuilt` confirmation for a manifestHash with a raw wallet private
 * key (CLI path — no npm helper exists for the rebuilt kind, local mirror
 * like review rejects). The attester is derived from the key. Never call
 * this before the rebuild gate passes.
 */
export function signCommonsConfirmation(
  manifest: string,
  privateKeyHex: string,
): CommonsConfirmation {
  const unsigned = buildUnsignedCommonsConfirmation(
    manifest,
    addressFromPrivateKey(privateKeyHex),
  );
  const signature = signPersonalMessage(
    confirmationSigningPayload(unsigned),
    privateKeyHex,
  );
  return { ...unsigned, signature };
}

/** Fail-closed wire parser; rejects unknown keys. */
export function parseCommonsConfirmation(
  json: unknown,
): CommonsConfirmationParseResult {
  if (json == null || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, reason: "not-an-object" };
  }
  const record = json as Record<string, unknown>;

  const keys = Object.keys(record).sort();
  if (
    keys.length !== CONFIRMATION_KEYS_SORTED.length ||
    keys.some((key, index) => key !== CONFIRMATION_KEYS_SORTED[index])
  ) {
    return { ok: false, reason: "unexpected-keys" };
  }

  if (record.schemaVersion !== "1.0") return { ok: false, reason: "schema-version" };

  const manifest = record.manifest;
  if (typeof manifest !== "string" || !MANIFEST_HASH_RE.test(manifest)) {
    return { ok: false, reason: "invalid-manifest" };
  }

  const attester = record.attester;
  if (typeof attester !== "string" || !ADDRESS_RE.test(attester)) {
    return { ok: false, reason: "invalid-attester" };
  }

  if (record.kind !== "rebuilt") return { ok: false, reason: "invalid-kind" };

  const signature = record.signature;
  if (typeof signature !== "string" || !SIGNATURE_RE.test(signature)) {
    return { ok: false, reason: "invalid-signature" };
  }

  return {
    ok: true,
    value: {
      schemaVersion: "1.0",
      manifest,
      attester,
      kind: "rebuilt",
      signature,
    },
  };
}

/**
 * Verify a confirmation signature: valid EIP-55 attester, EIP-191 recover
 * over the JCS payload must equal `attester` exactly.
 */
export function verifyCommonsConfirmation(
  confirmation: CommonsConfirmation,
): CommonsConfirmationVerifyResult {
  if (!isValidChecksumAddress(confirmation.attester)) {
    return { ok: false, reason: "invalid-checksum" };
  }
  let recovered: string;
  try {
    recovered = recoverPersonalSignAddress(
      confirmationSigningPayload(confirmation),
      confirmation.signature,
    );
  } catch {
    return { ok: false, reason: "invalid-signature" };
  }
  if (recovered !== confirmation.attester) {
    return { ok: false, reason: "address-mismatch" };
  }
  return { ok: true, attester: confirmation.attester };
}

/** Unsigned Nostr event template: `d` tag = manifestHash, content = JCS JSON. */
export type CommonsConfirmationEventTemplate = {
  kind: typeof COMMONS_CONFIRMATION_KIND;
  created_at: number;
  tags: string[][];
  content: string;
};

export function buildCommonsConfirmationEvent(
  confirmation: CommonsConfirmation,
  createdAt: number,
): CommonsConfirmationEventTemplate {
  return {
    kind: COMMONS_CONFIRMATION_KIND,
    created_at: createdAt,
    tags: [["d", confirmation.manifest]],
    content: canonicalize(confirmation),
  };
}

type CommonsConfirmationEventShape = {
  kind: number;
  tags: string[][];
  content: string;
};

/**
 * Parse + verify a kind 31862 event into a confirmation. Fail-closed: wrong
 * kind, invalid JSON, failed signature, or `d` tag ≠ `manifest` all yield
 * null. Author↔attester binding is checked by callers (as with reviews).
 */
export function commonsConfirmationFromEvent(
  event: CommonsConfirmationEventShape,
): CommonsConfirmation | null {
  if (event.kind !== COMMONS_CONFIRMATION_KIND) return null;

  let json: unknown;
  try {
    json = JSON.parse(event.content);
  } catch {
    return null;
  }

  const parsed = parseCommonsConfirmation(json);
  if (!parsed.ok) return null;

  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
  if (dTag !== parsed.value.manifest) return null;

  const verified = verifyCommonsConfirmation(parsed.value);
  if (!verified.ok) return null;

  return parsed.value;
}
