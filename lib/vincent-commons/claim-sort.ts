/**
 * Canonical JSONL claim ordering per Vincent PROTOCOL.md §7.2:
 * (claim type, key fields, claim hash). Mirrors the reference compiler
 * comparator, restricted to the VDS claim types F-1 derivation emits.
 */
import { claimHash, type Claim } from "@kargain/vincent/protocol";

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareYearTo(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Compare claims for canonical JSONL sort: (type, key fields, claimHash). */
export function compareClaimsForJsonl(
  a: Claim,
  b: Claim,
  aHash: string,
  bHash: string,
): number {
  const typeCmp = compareStrings(a.type, b.type);
  if (typeCmp !== 0) return typeCmp;

  switch (a.type) {
    case "wmi": {
      if (b.type !== "wmi") return 0;
      const keyCmp = compareStrings(a.key.wmi, b.key.wmi);
      if (keyCmp !== 0) return keyCmp;
      break;
    }
    case "vds-schema": {
      if (b.type !== "vds-schema") return 0;
      const keyCmp = compareStrings(a.key.name, b.key.name);
      if (keyCmp !== 0) return keyCmp;
      break;
    }
    case "vds-binding": {
      if (b.type !== "vds-binding") return 0;
      let cmp = compareStrings(a.key.wmi, b.key.wmi);
      if (cmp !== 0) return cmp;
      cmp = a.key.yearFrom - b.key.yearFrom;
      if (cmp !== 0) return cmp;
      cmp = compareYearTo(a.key.yearTo, b.key.yearTo);
      if (cmp !== 0) return cmp;
      cmp = compareStrings(a.key.schema, b.key.schema);
      if (cmp !== 0) return cmp;
      break;
    }
    case "vds-pattern": {
      if (b.type !== "vds-pattern") return 0;
      let cmp = compareStrings(a.key.schema, b.key.schema);
      if (cmp !== 0) return cmp;
      cmp = compareStrings(a.key.match.vds, b.key.match.vds);
      if (cmp !== 0) return cmp;
      cmp = compareStrings(a.key.match.vis ?? "", b.key.match.vis ?? "");
      if (cmp !== 0) return cmp;
      break;
    }
    case "year-hint": {
      if (b.type !== "year-hint") return 0;
      const keyCmp = compareStrings(a.key.wmi, b.key.wmi);
      if (keyCmp !== 0) return keyCmp;
      break;
    }
  }

  return compareStrings(aHash, bHash);
}

/** Stable sort claims for canonical JSONL output (precomputes hashes once). */
export function sortClaimsForJsonl(claims: readonly Claim[]): Claim[] {
  const prepared = claims.map((claim) => ({ claim, hash: claimHash(claim) }));
  prepared.sort((a, b) => compareClaimsForJsonl(a.claim, b.claim, a.hash, b.hash));
  return prepared.map((entry) => entry.claim);
}
