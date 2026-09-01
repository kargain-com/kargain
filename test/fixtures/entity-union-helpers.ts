/**
 * Naive per-side merge helpers — negative controls for UNION acceptance (S7c-4).
 * Intentionally wrong; not SQL parsers.
 */
import type { PassportEntityRow } from "../../src/lib/ponder-passport-entity.js";

const STATUS_ORDER: Record<string, number> = {
  VERIFIED: 0,
  UNVERIFIED: 1,
  DISPUTED: 2,
};

function statusRank(status: string): number {
  return STATUS_ORDER[status] ?? 3;
}

function sortEntityRows(
  rows: PassportEntityRow[],
  verifiedFirst: boolean,
): PassportEntityRow[] {
  return rows.slice().sort((a, b) => {
    if (verifiedFirst) {
      const sd = statusRank(a.status) - statusRank(b.status);
      if (sd !== 0) return sd;
    }
    if (a.createdAt === b.createdAt) {
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    }
    return a.createdAt > b.createdAt ? -1 : 1;
  });
}

type BrowseParsed = {
  namespaces: number[];
  verifiedFirst: boolean;
  limit?: number;
  offset?: number;
};

function matchesNamespace(row: PassportEntityRow, namespaces: number[]): boolean {
  return namespaces.includes(row.chainId);
}

export function naivePerSideEntityBrowse(
  state: { evmPassports: PassportEntityRow[]; svmPassports: PassportEntityRow[] },
  parsed: BrowseParsed,
): PassportEntityRow[] {
  const evmPage = sortEntityRows(
    state.evmPassports.filter((r) => matchesNamespace(r, parsed.namespaces)),
    parsed.verifiedFirst,
  );
  const svmPage = sortEntityRows(
    state.svmPassports.filter((r) => matchesNamespace(r, parsed.namespaces)),
    parsed.verifiedFirst,
  );
  const limit = parsed.limit ?? evmPage.length + svmPage.length;
  const offset = parsed.offset ?? 0;
  const naiveMerged = [...evmPage, ...svmPage];
  return naiveMerged.slice(offset, offset + limit);
}

export type StatusCounts = { UNVERIFIED: number; VERIFIED: number; DISPUTED: number };

function emptyStatusCounts(): StatusCounts {
  return { UNVERIFIED: 0, VERIFIED: 0, DISPUTED: 0 };
}

function foldStatusCounts(
  rows: Array<{ status: string | null; total: number }>,
): StatusCounts {
  const statusCounts = emptyStatusCounts();
  for (const row of rows) {
    const status = row.status ?? "UNVERIFIED";
    if (status in statusCounts) {
      statusCounts[status as keyof StatusCounts] += Number(row.total);
    }
  }
  return statusCounts;
}

function groupStatus(rows: PassportEntityRow[]): Array<{ status: string; total: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.status, (map.get(row.status) ?? 0) + 1);
  }
  return [...map.entries()].map(([status, total]) => ({ status, total }));
}

export function naivePerSideStatusCounts(
  state: { evmPassports: PassportEntityRow[]; svmPassports: PassportEntityRow[] },
  parsed: Pick<BrowseParsed, "namespaces">,
): StatusCounts {
  const evmCounts = foldStatusCounts(
    groupStatus(
      state.evmPassports.filter((r) => parsed.namespaces.includes(r.chainId)),
    ),
  );
  const svmCounts = foldStatusCounts(
    groupStatus(
      state.svmPassports.filter((r) => parsed.namespaces.includes(r.chainId)),
    ),
  );
  return {
    UNVERIFIED: evmCounts.UNVERIFIED + svmCounts.UNVERIFIED,
    VERIFIED: evmCounts.VERIFIED + svmCounts.VERIFIED,
    DISPUTED: evmCounts.DISPUTED + svmCounts.DISPUTED,
  };
}
