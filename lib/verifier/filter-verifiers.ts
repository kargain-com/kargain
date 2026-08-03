import type { VerifierDirectoryEntry } from "@/lib/verifier/parse-directory-entry";
import { categoryIndexToLabel } from "@/lib/kar-pro/kar-pro-metadata";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { showLightningChip } from "@/lib/verifier/payment-methods";
import { parseWeiString } from "@/lib/web3/parse-wei-string";

export type VerifierDirectorySortKey = "verifications" | "newest" | "lowestFee";

export type FilterVerifiersOptions = {
  query: string;
  categoryIndex: number | null;
  /** `null` = all commercial networks. */
  chainId: number | null;
  sortKey: VerifierDirectorySortKey;
  activeOnly: boolean;
  lightningOnly?: boolean;
  profiles?: Map<string, NostrProfileData | null>;
  /** Preferred Place from directory PlacePicker — blank placeId disables geo tiers. */
  preferredPlaceId?: string;
  preferredCountryCode?: string;
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

  const byAddress = a.address.localeCompare(b.address);
  if (byAddress !== 0) return byAddress;
  return a.chainId - b.chainId;
}

function compareSecondarySort(
  a: VerifierDirectoryEntry,
  b: VerifierDirectoryEntry,
  sortKey: VerifierDirectorySortKey,
): number {
  if (sortKey === "verifications") {
    const byCount = b.verificationCount - a.verificationCount;
    if (byCount !== 0) return byCount;
    const byAddress = a.address.localeCompare(b.address);
    if (byAddress !== 0) return byAddress;
    return a.chainId - b.chainId;
  }

  if (sortKey === "newest") {
    if (a.joinedAt === 0 && b.joinedAt === 0) {
      const byAddress = a.address.localeCompare(b.address);
      if (byAddress !== 0) return byAddress;
      return a.chainId - b.chainId;
    }
    if (a.joinedAt === 0) return 1;
    if (b.joinedAt === 0) return -1;
    if (a.joinedAt !== b.joinedAt) return b.joinedAt - a.joinedAt;
    const byAddress = a.address.localeCompare(b.address);
    if (byAddress !== 0) return byAddress;
    return a.chainId - b.chainId;
  }

  return compareLowestFee(a, b);
}

/** 0 = same placeId, 1 = same country, 2 = other. Lower ranks first. */
export function verifierPlaceRankTier(
  entry: VerifierDirectoryEntry,
  preferredPlaceId: string,
  preferredCountryCode: string,
): number {
  const prefId = preferredPlaceId.trim();
  if (!prefId) return 0;

  const entryId = entry.locationPlaceId.trim();
  if (entryId && entryId === prefId) return 0;

  const prefCc = preferredCountryCode.trim().toUpperCase();
  const entryCc = entry.locationCountryCode.trim().toUpperCase();
  if (prefCc.length === 2 && entryCc && entryCc === prefCc) return 1;

  return 2;
}

function sortVerifiers(
  entries: VerifierDirectoryEntry[],
  sortKey: VerifierDirectorySortKey,
  preferredPlaceId: string,
  preferredCountryCode: string,
): VerifierDirectoryEntry[] {
  const sorted = [...entries];
  const prefId = preferredPlaceId.trim();

  sorted.sort((a, b) => {
    if (prefId) {
      const tierA = verifierPlaceRankTier(a, preferredPlaceId, preferredCountryCode);
      const tierB = verifierPlaceRankTier(b, preferredPlaceId, preferredCountryCode);
      if (tierA !== tierB) return tierA - tierB;
    }
    return compareSecondarySort(a, b, sortKey);
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

  if (options.chainId != null) {
    result = result.filter((entry) => entry.chainId === options.chainId);
  }

  if (options.query.trim()) {
    result = result.filter((entry) => verifierMatchesQuery(entry, options.query));
  }

  if (options.categoryIndex !== null) {
    result = result.filter((entry) => entry.category === options.categoryIndex);
  }

  if (options.lightningOnly) {
    result = result.filter((entry) => {
      const profile = options.profiles?.get(entry.address.toLowerCase()) ?? null;
      return showLightningChip(profile);
    });
  }

  return sortVerifiers(
    result,
    options.sortKey,
    options.preferredPlaceId ?? "",
    options.preferredCountryCode ?? "",
  );
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
