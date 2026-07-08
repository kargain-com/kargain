import type { VerifierDirectoryEntry } from "@/app/actions/verifier-directory";
import { categoryIndexToLabel } from "@/lib/kar-pro/kar-pro-metadata";
import { parseWeiString } from "@/lib/web3/parse-wei-string";

export type VerifierDirectorySortKey = "verifications" | "newest" | "lowestFee";

export type FilterVerifiersOptions = {
  query: string;
  categoryIndex: number | null;
  sortKey: VerifierDirectorySortKey;
  activeOnly: boolean;
};

function normalizeHex(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
}

export function verifierMatchesQuery(
  entry: VerifierDirectoryEntry,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  if (entry.name.toLowerCase().includes(q)) return true;
  if (entry.slug.toLowerCase().includes(q)) return true;
  if (categoryIndexToLabel(entry.category).toLowerCase().includes(q)) return true;

  const hexQuery = normalizeHex(q);
  if (hexQuery.length > 0 && /^[0-9a-f]*$/.test(hexQuery)) {
    const addressHex = normalizeHex(entry.address);
    if (addressHex.includes(hexQuery)) return true;
  }

  return false;
}

function compareLowestFee(a: VerifierDirectoryEntry, b: VerifierDirectoryEntry): number {
  const feeA = parseWeiString(a.verificationFee);
  const feeB = parseWeiString(b.verificationFee);

  const aZero = feeA === 0n;
  const bZero = feeB === 0n;
  if (aZero && !bZero) return 1;
  if (!aZero && bZero) return -1;
  if (!aZero && !bZero && feeA !== feeB) return feeA < feeB ? -1 : 1;

  if (a.verificationCount !== b.verificationCount) {
    return b.verificationCount - a.verificationCount;
  }

  return a.address.localeCompare(b.address);
}

function sortVerifiers(
  entries: VerifierDirectoryEntry[],
  sortKey: VerifierDirectorySortKey,
): VerifierDirectoryEntry[] {
  const sorted = [...entries];

  sorted.sort((a, b) => {
    if (sortKey === "verifications") {
      return b.verificationCount - a.verificationCount;
    }

    if (sortKey === "newest") {
      if (a.joinedAt === 0 && b.joinedAt === 0) return 0;
      if (a.joinedAt === 0) return 1;
      if (b.joinedAt === 0) return -1;
      return b.joinedAt - a.joinedAt;
    }

    return compareLowestFee(a, b);
  });

  return sorted;
}

export function filterVerifiers(
  entries: VerifierDirectoryEntry[],
  options: FilterVerifiersOptions,
): VerifierDirectoryEntry[] {
  let result = [...entries];

  if (options.activeOnly) {
    result = result.filter((entry) => entry.active);
  }

  if (options.query.trim()) {
    result = result.filter((entry) => verifierMatchesQuery(entry, options.query));
  }

  if (options.categoryIndex !== null) {
    result = result.filter((entry) => entry.category === options.categoryIndex);
  }

  return sortVerifiers(result, options.sortKey);
}

function formatVerifierCount(count: number): string {
  return count === 1 ? "1 verifier" : `${count} verifiers`;
}

export function formatVerifierDirectoryResultCount(
  total: number,
  matched: number,
  filtersActive: boolean,
): string {
  const totalLabel = formatVerifierCount(total);
  if (!filtersActive) return totalLabel;
  return `${totalLabel} · ${matched} match`;
}
