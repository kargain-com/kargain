/**
 * F-1 Vincent Commons derivation — pure function per
 * docs/research/vincent-flywheel.md §4.2.
 *
 * Turns already-fetched VERIFIED-passport observations into Vincent claim
 * fact cores (vds-schema / vds-binding / vds-pattern only; no `wmi` claims —
 * decision §10.2 routes unknown WMIs to a document-required report list).
 * No network: the bundled-table WMI lookup is injectable and offline.
 */
import { validateVin } from "@kargain/vincent";
import { resolveWmiKey } from "@kargain/vincent/decoder";
import {
  claimHash,
  parseClaim,
  type Claim,
  type VdsBindingClaim,
  type VdsPatternClaim,
  type VdsSchemaClaim,
} from "@kargain/vincent/protocol";
import { lookupWmi, type WmiInfo } from "@kargain/vincent/wmi";

import { sortClaimsForJsonl } from "@/lib/vincent-commons/claim-sort";

/** One VERIFIED passport observation (metadata fields per SPEC Part III). */
export type VincentObservation = {
  tokenId: string;
  vin: string;
  year: number;
  make?: string;
  model?: string;
  modelVariant?: string;
  bodyType?: string;
  fuelType?: string;
  transmission?: string;
  engine?: string;
};

export type DeriveDeps = {
  /** Bundled-table WMI lookup (offline). Injectable for tests. */
  lookupWmi?: (vinOrWmi: string) => Promise<WmiInfo | null>;
};

/** Claim attribute names emitted by F-1 (subset of the §4.2 genesis registry). */
export type DerivedAttribute =
  | "model"
  | "series"
  | "bodyType"
  | "fuelType"
  | "transmission"
  | "engine";

export type DeriveSkipReason = "invalid-vin" | "legacy-vin" | "missing-year";

export type DeriveSkip = { tokenId: string; reason: DeriveSkipReason };

export type VocabularySkip = {
  tokenId: string;
  attribute: "fuelType" | "bodyType" | "transmission";
  value: string;
};

export type DeriveConflict = {
  wmi: string;
  year: number;
  vds: string;
  attribute: DerivedAttribute;
  values: string[];
  tokenIds: string[];
};

export type UnknownWmiCandidate = {
  wmi: string;
  makes: string[];
  tokenIds: string[];
};

export type DeriveReport = {
  observations: number;
  skipped: DeriveSkip[];
  vocabularySkips: VocabularySkip[];
  conflicts: DeriveConflict[];
  unknownWmiCandidates: UnknownWmiCandidate[];
  counts: {
    vdsSchema: number;
    vdsBinding: number;
    vdsPattern: number;
    total: number;
  };
};

/** claimHash → contributing VERIFIED-passport tokenIds (sorted, deduped). */
export type DeriveSources = Record<string, { tokenIds: string[] }>;

export type DeriveResult = {
  claims: Claim[];
  report: DeriveReport;
  /**
   * F-2 additive sources map for emitted claims only. Never embedded in the
   * claim JSON — claimHash stays independent of which passports contributed.
   */
  sources: DeriveSources;
};

/**
 * Kargain form vocabulary → vPIC-canonical codes recognized by the
 * `mapVpic*` reverse direction in lib/passport/vin-decode.ts. Unmapped
 * values (e.g. "Other") are skipped and reported, never guessed.
 */
export const VPIC_CANONICAL_CODES = {
  fuelType: {
    Petrol: "Gasoline",
    Diesel: "Diesel",
    Electric: "Electric",
    Hybrid: "Hybrid",
  },
  bodyType: {
    Sedan: "Sedan/Saloon",
    SUV: "SUV/MPV",
    Hatchback: "Hatchback",
    Coupe: "Coupe",
    Van: "Van",
    Truck: "Pickup",
  },
  transmission: {
    Manual: "Manual",
    Automatic: "Automatic",
  },
} as const;

type EnumeratedAttribute = keyof typeof VPIC_CANONICAL_CODES;

function vpicCanonicalCode(
  attribute: EnumeratedAttribute,
  raw: string,
): string | null {
  const table: Record<string, string> = VPIC_CANONICAL_CODES[attribute];
  return table[raw] ?? null;
}

/**
 * Literal `match.vds` from VIN positions 4–9; position 9 (NA check digit)
 * masked with `*` when the VIN passes check-digit validation.
 */
export function vdsFromVin(normalizedVin: string, checkDigitValid: boolean): string {
  const vds = normalizedVin.slice(3, 9);
  return checkDigitValid ? `${vds.slice(0, 5)}*` : vds;
}

type AttributeObservation = { attribute: DerivedAttribute; code: string };

type PatternAccumulator = {
  wmi: string;
  year: number;
  vds: string;
  attribute: DerivedAttribute;
  /** code → sorted set of contributing tokenIds */
  codes: Map<string, Set<string>>;
};

function extractAttributes(
  obs: VincentObservation,
  vocabularySkips: VocabularySkip[],
): AttributeObservation[] {
  const out: AttributeObservation[] = [];

  const free: Array<[DerivedAttribute, string | undefined]> = [
    ["model", obs.model],
    ["series", obs.modelVariant],
    ["engine", obs.engine],
  ];
  for (const [attribute, raw] of free) {
    const code = raw?.trim();
    if (code) out.push({ attribute, code });
  }

  const enumerated: Array<[EnumeratedAttribute, string | undefined]> = [
    ["fuelType", obs.fuelType],
    ["bodyType", obs.bodyType],
    ["transmission", obs.transmission],
  ];
  for (const [attribute, raw] of enumerated) {
    const value = raw?.trim();
    if (!value) continue;
    const code = vpicCanonicalCode(attribute, value);
    if (code) {
      out.push({ attribute, code });
    } else {
      vocabularySkips.push({ tokenId: obs.tokenId, attribute, value });
    }
  }

  return out;
}

function baseClaimFields(): Pick<
  VdsSchemaClaim,
  "schemaVersion" | "provenance" | "license"
> {
  return {
    schemaVersion: "1.1",
    provenance: "community/observation",
    license: "CC0-1.0",
  };
}

/** Schema declaration for a (WMI, year) community group. */
export function communitySchemaName(wmi: string, year: number): string {
  return `Kargain community ${wmi} ${year}`;
}

function compareTuples(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) continue;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av) < String(bv) ? -1 : 1;
  }
  return a.length - b.length;
}

function validateClaimOrThrow(claim: Claim): Claim {
  const parsed = parseClaim(claim);
  if (!parsed.ok) {
    throw new Error(
      `derived claim failed protocol validation (${parsed.error.code}): ${parsed.error.message}`,
    );
  }
  return parsed.value;
}

/**
 * Derive Vincent claim fact cores from VERIFIED passport observations.
 * Deterministic: same input ⇒ identical claims (sorted per PROTOCOL §7.2,
 * deduped by claimHash) and identical report (sorted arrays).
 */
export async function deriveClaims(
  observations: readonly VincentObservation[],
  deps?: DeriveDeps,
): Promise<DeriveResult> {
  const wmiLookup = deps?.lookupWmi ?? lookupWmi;

  const skipped: DeriveSkip[] = [];
  const vocabularySkips: VocabularySkip[] = [];

  /** groupKey (wmi\u0000year) → patternKey (vds\u0000attribute) → accumulator */
  const groups = new Map<string, Map<string, PatternAccumulator>>();
  const groupMeta = new Map<string, { wmi: string; year: number }>();
  /** wmi → { representative normalized VIN for table lookup, makes, tokenIds } */
  const wmiSeen = new Map<
    string,
    { representativeVin: string; makes: Set<string>; tokenIds: Set<string> }
  >();

  for (const obs of observations) {
    const validation = validateVin(obs.vin);
    if (validation.length !== 17 || !validation.ok) {
      skipped.push({
        tokenId: obs.tokenId,
        reason: validation.length === "legacy" ? "legacy-vin" : "invalid-vin",
      });
      continue;
    }
    if (!Number.isInteger(obs.year) || obs.year < 1) {
      skipped.push({ tokenId: obs.tokenId, reason: "missing-year" });
      continue;
    }

    const normalized = validation.normalized;
    const wmi = resolveWmiKey(normalized);
    const vds = vdsFromVin(normalized, validation.checkDigit.valid === true);

    const seen = wmiSeen.get(wmi) ?? {
      representativeVin: normalized,
      makes: new Set<string>(),
      tokenIds: new Set<string>(),
    };
    const make = obs.make?.trim();
    if (make) seen.makes.add(make);
    seen.tokenIds.add(obs.tokenId);
    wmiSeen.set(wmi, seen);

    const attributes = extractAttributes(obs, vocabularySkips);
    if (attributes.length === 0) continue;

    const groupKey = `${wmi}\u0000${obs.year}`;
    const group = groups.get(groupKey) ?? new Map<string, PatternAccumulator>();
    groups.set(groupKey, group);
    groupMeta.set(groupKey, { wmi, year: obs.year });

    for (const { attribute, code } of attributes) {
      const patternKey = `${vds}\u0000${attribute}`;
      const acc = group.get(patternKey) ?? {
        wmi,
        year: obs.year,
        vds,
        attribute,
        codes: new Map<string, Set<string>>(),
      };
      group.set(patternKey, acc);
      const tokenIds = acc.codes.get(code) ?? new Set<string>();
      tokenIds.add(obs.tokenId);
      acc.codes.set(code, tokenIds);
    }
  }

  // Conflicts: same (schema group, vds, attribute) with >1 distinct code —
  // exclude every side, record for the review layer.
  const conflicts: DeriveConflict[] = [];
  const claims: Claim[] = [];
  /** claimHash → contributing tokenIds (merged across duplicate emissions). */
  const sourceTokenIds = new Map<string, Set<string>>();

  const recordSource = (hash: string, tokenIds: Iterable<string>): void => {
    const set = sourceTokenIds.get(hash) ?? new Set<string>();
    for (const tokenId of tokenIds) set.add(tokenId);
    sourceTokenIds.set(hash, set);
  };

  const sortedGroupKeys = [...groups.keys()].sort((a, b) => {
    const ma = groupMeta.get(a);
    const mb = groupMeta.get(b);
    if (!ma || !mb) return 0;
    return compareTuples([ma.wmi, ma.year], [mb.wmi, mb.year]);
  });

  for (const groupKey of sortedGroupKeys) {
    const meta = groupMeta.get(groupKey);
    const group = groups.get(groupKey);
    if (!meta || !group) continue;

    const surviving: PatternAccumulator[] = [];
    for (const acc of group.values()) {
      if (acc.codes.size > 1) {
        conflicts.push({
          wmi: acc.wmi,
          year: acc.year,
          vds: acc.vds,
          attribute: acc.attribute,
          values: [...acc.codes.keys()].sort(),
          tokenIds: [...acc.codes.values()]
            .flatMap((ids) => [...ids])
            .sort(),
        });
      } else {
        surviving.push(acc);
      }
    }

    // A group whose patterns all conflicted emits no empty declarations.
    if (surviving.length === 0) continue;

    const groupTokenIds = new Set<string>();
    for (const acc of surviving) {
      for (const ids of acc.codes.values()) {
        for (const tokenId of ids) groupTokenIds.add(tokenId);
      }
    }

    const schemaClaim: VdsSchemaClaim = {
      ...baseClaimFields(),
      type: "vds-schema",
      key: { name: communitySchemaName(meta.wmi, meta.year) },
      value: {},
    };
    const schemaRef = claimHash(validateClaimOrThrow(schemaClaim));
    claims.push(schemaClaim);
    recordSource(schemaRef, groupTokenIds);

    const bindingClaim: VdsBindingClaim = {
      ...baseClaimFields(),
      type: "vds-binding",
      key: {
        wmi: meta.wmi,
        yearFrom: meta.year,
        yearTo: meta.year,
        schema: schemaRef,
      },
      value: {},
    };
    claims.push(validateClaimOrThrow(bindingClaim));
    recordSource(claimHash(bindingClaim), groupTokenIds);

    for (const acc of surviving) {
      const [entry] = acc.codes.entries();
      if (entry === undefined) continue;
      const [code, patternTokenIds] = entry;
      const patternClaim: VdsPatternClaim = {
        ...baseClaimFields(),
        type: "vds-pattern",
        key: { schema: schemaRef, match: { vds: acc.vds } },
        value: { attribute: acc.attribute, code },
      };
      claims.push(validateClaimOrThrow(patternClaim));
      recordSource(claimHash(patternClaim), patternTokenIds);
    }
  }

  // Unknown WMIs (no bundled ./wmi entry) → document-required candidates.
  const unknownWmiCandidates: UnknownWmiCandidate[] = [];
  for (const [wmi, seen] of wmiSeen) {
    const info = await wmiLookup(seen.representativeVin);
    if (info === null) {
      unknownWmiCandidates.push({
        wmi,
        makes: [...seen.makes].sort(),
        tokenIds: [...seen.tokenIds].sort(),
      });
    }
  }

  // Batch-level dedupe by claimHash, then canonical §7.2 sort.
  const byHash = new Map<string, Claim>();
  for (const claim of claims) {
    byHash.set(claimHash(claim), claim);
  }
  const deduped = sortClaimsForJsonl([...byHash.values()]);

  const dedupCounts = { vdsSchema: 0, vdsBinding: 0, vdsPattern: 0 };
  for (const claim of deduped) {
    if (claim.type === "vds-schema") dedupCounts.vdsSchema += 1;
    else if (claim.type === "vds-binding") dedupCounts.vdsBinding += 1;
    else if (claim.type === "vds-pattern") dedupCounts.vdsPattern += 1;
  }

  // Sources map keys follow the canonical §7.2 claim order; tokenIds sorted.
  const sources: DeriveSources = {};
  for (const claim of deduped) {
    const hash = claimHash(claim);
    const tokenIds = sourceTokenIds.get(hash);
    sources[hash] = { tokenIds: tokenIds ? [...tokenIds].sort() : [] };
  }

  conflicts.sort((a, b) =>
    compareTuples(
      [a.wmi, a.year, a.vds, a.attribute],
      [b.wmi, b.year, b.vds, b.attribute],
    ),
  );
  unknownWmiCandidates.sort((a, b) => compareTuples([a.wmi], [b.wmi]));
  skipped.sort((a, b) => compareTuples([a.tokenId, a.reason], [b.tokenId, b.reason]));
  vocabularySkips.sort((a, b) =>
    compareTuples([a.tokenId, a.attribute, a.value], [b.tokenId, b.attribute, b.value]),
  );

  return {
    claims: deduped,
    sources,
    report: {
      observations: observations.length,
      skipped,
      vocabularySkips,
      conflicts,
      unknownWmiCandidates,
      counts: {
        vdsSchema: dedupCounts.vdsSchema,
        vdsBinding: dedupCounts.vdsBinding,
        vdsPattern: dedupCounts.vdsPattern,
        total: deduped.length,
      },
    },
  };
}
