/**
 * F-2.1 document-based `wmi` claim proposals (docs/research/vincent-flywheel.md
 * §10.2). Unknown WMIs cannot be derived from observations — the fact core is
 * authored by a verifier who sighted a document (CoC, registration, or type
 * approval) and travels as a Nostr kind 31861 proposal
 * (lib/nostr/commons-claims.ts).
 *
 * Pure module: no transport, no React.
 */
import { vinRegion } from "@kargain/vincent";
import { claimHash, parseClaim, type WmiClaim } from "@kargain/vincent/protocol";

export type WmiClaimInput = {
  wmi: string;
  manufacturer: string;
  country: string;
  vehicleType: string;
};

export type WmiClaimBuildResult =
  | { ok: true; claim: WmiClaim; hash: string }
  | { ok: false; reason: string };

const COUNTRY_ALPHA2_RE = /^[A-Z]{2}$/;

/**
 * Build a PROTOCOL §4.2 `wmi` fact core from document-sighted inputs.
 *
 * - Inputs are trimmed; `manufacturer` is required.
 * - Empty `country` / `vehicleType` become `null` — the keys are
 *   required-nullable on the wire (present-as-null is meaningful for JCS and
 *   the claimHash).
 * - `country`, when present, is normalized to uppercase and must be ISO
 *   3166-1 alpha-2.
 * - `region` is never user input — derived from the WMI first character
 *   (ISO 3780 via `vinRegion`); the npm parser requires it non-empty.
 * - The result is `parseClaim`-validated (fail-closed), which also enforces
 *   the 3-character VIN-alphabet WMI code.
 */
export function buildWmiClaim(input: WmiClaimInput): WmiClaimBuildResult {
  const wmi = input.wmi.trim();
  const manufacturer = input.manufacturer.trim();
  const countryRaw = input.country.trim().toUpperCase();
  const vehicleTypeRaw = input.vehicleType.trim();

  if (!manufacturer) {
    return { ok: false, reason: "manufacturer-required" };
  }

  if (countryRaw && !COUNTRY_ALPHA2_RE.test(countryRaw)) {
    return { ok: false, reason: "invalid-country" };
  }
  const country = countryRaw || null;
  const vehicleType = vehicleTypeRaw || null;

  const region = wmi ? vinRegion(wmi[0]) : null;
  if (region === null) {
    return { ok: false, reason: "unknown-region" };
  }

  const candidate = {
    schemaVersion: "1.0",
    type: "wmi",
    provenance: "community/document",
    license: "CC0-1.0",
    key: { wmi },
    value: { manufacturer, country, vehicleType, region },
  };

  const parsed = parseClaim(candidate);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.error.code };
  }
  if (parsed.value.type !== "wmi") {
    return { ok: false, reason: "not-a-wmi-claim" };
  }

  return { ok: true, claim: parsed.value, hash: claimHash(parsed.value) };
}

export type WmiProposalEndorser = {
  /** Verified attester address (lowercased upstream). */
  address: string;
  /** Nostr event author pubkey bound to the attester. */
  pubkey: string;
};

export type WmiProposalThreshold = {
  /** §10.2 F-2.1: proposer endorse + at least one independent accept. */
  met: boolean;
  proposerEndorsed: boolean;
  independentAccepts: number;
};

/** Threshold state for a 31861 proposal from verified endorse reviews. */
export function wmiProposalThreshold(
  proposalAuthorPubkey: string,
  endorsers: readonly WmiProposalEndorser[],
): WmiProposalThreshold {
  const proposer = proposalAuthorPubkey.trim().toLowerCase();

  const byAddress = new Map<string, string>();
  for (const endorser of endorsers) {
    const address = endorser.address.trim().toLowerCase();
    if (!address) continue;
    byAddress.set(address, endorser.pubkey.trim().toLowerCase());
  }

  let proposerEndorsed = false;
  let independentAccepts = 0;
  for (const pubkey of byAddress.values()) {
    if (pubkey === proposer) {
      proposerEndorsed = true;
    } else {
      independentAccepts += 1;
    }
  }

  return {
    met: proposerEndorsed && independentAccepts >= 1,
    proposerEndorsed,
    independentAccepts,
  };
}
