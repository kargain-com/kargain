/**
 * In-memory pg.Pool stub for passport entity UNION SQL tests (chain-free).
 */
import type pg from "pg";

import type { PassportEntityRow } from "../../src/lib/ponder-passport-entity.js";

export type MemoryEntityState = {
  evmPassports: PassportEntityRow[];
  svmPassports: PassportEntityRow[];
};

type StatusCounts = { UNVERIFIED: number; VERIFIED: number; DISPUTED: number };

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

function rowToPg(row: PassportEntityRow): Record<string, unknown> {
  return {
    id: row.id,
    chain_id: row.chainId,
    owner: row.owner,
    status: row.status,
    verifier: row.verifier,
    verified_at: row.verifiedAt.toString(),
    token_uri: row.tokenUri,
    cover_photo_uri: row.coverPhotoUri,
    vin: row.vin,
    make: row.make,
    model: row.model,
    year: row.year,
    mileage_km: row.mileageKm,
    last_disputer: row.lastDisputer,
    dispute_reason: row.disputeReason,
    dispute_withdrawn_at: row.disputeWithdrawnAt.toString(),
    last_verification_reset_at: row.lastVerificationResetAt.toString(),
    duplicate_vin: row.duplicateVin,
    last_metadata_change_at: row.lastMetadataChangeAt.toString(),
    verification_reset_count: row.verificationResetCount,
    had_dispute: row.hadDispute,
    last_dispute_resolved_at: row.lastDisputeResolvedAt.toString(),
    last_dispute_terminal: row.lastDisputeTerminal,
    dispute_opened_at: row.disputeOpenedAt.toString(),
    fuel_type: row.fuelType,
    body_type: row.bodyType,
    transmission: row.transmission,
    condition: row.condition,
    vehicle_type: row.vehicleType,
    colour: row.colour,
    location_label: row.locationLabel,
    location_place_id: row.locationPlaceId,
    location_country_code: row.locationCountryCode,
    dispute_deposit: row.disputeDeposit?.toString() ?? null,
    created_at: row.createdAt.toString(),
    updated_at: row.updatedAt.toString(),
  };
}

type ParsedEntityQuery = {
  namespaces: number[];
  includeSvm: boolean;
  id?: string;
  ids?: string[];
  owner?: string;
  status?: string;
  statusExact?: string;
  vin?: string;
  verifier?: string;
  verifierExact?: string;
  chainId?: number;
  verifiedFirst: boolean;
  limit?: number;
  offset?: number;
  countOnly: boolean;
  groupByStatus: boolean;
  verifiedOnly: boolean;
};

function paramAt(params: unknown[], sql: string, column: string): unknown {
  const re = new RegExp(`\\b${column} = \\$(\\d+)`);
  const match = sql.match(re);
  if (!match) return undefined;
  return params[Number(match[1]) - 1];
}

function parseEntityQuery(sql: string, params: unknown[]): ParsedEntityQuery {
  const includeSvm = sql.includes("kargain_svm_projection.passport");
  const countOnly = sql.includes("COUNT(*)") && !sql.includes("GROUP BY");
  const groupByStatus = sql.includes("GROUP BY") && sql.includes("status");
  const verifiedOnly =
    sql.includes("status = ") && sql.includes("VERIFIED") && sql.includes("verifier <> ''");
  const verifiedFirst = sql.includes("WHEN 'VERIFIED' THEN 0");

  const namespacesParam = params.find(
    (p): p is number[] => Array.isArray(p) && p.every((n) => typeof n === "number"),
  );
  const namespaces = namespacesParam ?? [];

  const idParam = paramAt(params, sql, "id");
  const id =
    typeof idParam === "string" && !/\bid = ANY\(/i.test(sql) ? idParam : undefined;

  const idsMatch = sql.match(/\bid = ANY\(\$(\d+)/);
  const ids =
    idsMatch != null
      ? (params[Number(idsMatch[1]) - 1] as string[] | undefined)
      : undefined;

  const ownerParam = paramAt(params, sql, "owner");
  const owner = typeof ownerParam === "string" ? ownerParam : undefined;

  const statusParam = paramAt(params, sql, "status");
  const statusValue = typeof statusParam === "string" ? statusParam : undefined;
  const status = verifiedOnly ? undefined : statusValue;
  const statusExact = verifiedOnly ? statusValue : undefined;

  const vinParam = paramAt(params, sql, "vin");
  const vin = typeof vinParam === "string" ? vinParam : undefined;

  const verifierParam = paramAt(params, sql, "verifier");
  const verifierValue = typeof verifierParam === "string" ? verifierParam : undefined;
  const verifierExact =
    verifiedOnly || groupByStatus ? verifierValue : undefined;
  const verifier = verifierExact ? undefined : verifierValue;

  const chainParam = paramAt(params, sql, "chain_id");
  const chainId = typeof chainParam === "number" ? chainParam : undefined;

  let limit: number | undefined;
  let offset: number | undefined;
  const limitMatch = sql.match(/LIMIT \$(\d+)/);
  const offsetMatch = sql.match(/OFFSET \$(\d+)/);
  if (limitMatch) {
    const v = params[Number(limitMatch[1]) - 1];
    if (typeof v === "number") limit = v;
  }
  if (offsetMatch) {
    const v = params[Number(offsetMatch[1]) - 1];
    if (typeof v === "number") offset = v;
  }

  return {
    namespaces,
    includeSvm,
    id,
    ids,
    owner,
    status,
    statusExact,
    vin,
    verifier,
    verifierExact,
    chainId,
    verifiedFirst,
    limit,
    offset,
    countOnly,
    groupByStatus,
    verifiedOnly,
  };
}

function matchesEntity(row: PassportEntityRow, parsed: ParsedEntityQuery): boolean {
  if (!parsed.namespaces.includes(row.chainId)) return false;
  if (parsed.id != null && row.id !== parsed.id) return false;
  if (parsed.ids != null && !parsed.ids.includes(row.id)) return false;
  if (parsed.owner != null && row.owner !== parsed.owner) return false;
  if (parsed.status != null && row.status !== parsed.status) return false;
  if (parsed.statusExact != null && row.status !== parsed.statusExact) return false;
  if (parsed.vin != null && row.vin !== parsed.vin) return false;
  if (parsed.verifier != null && row.verifier !== parsed.verifier) return false;
  if (parsed.verifierExact != null && row.verifier !== parsed.verifierExact) return false;
  if (parsed.chainId != null && row.chainId !== parsed.chainId) return false;
  if (parsed.verifiedOnly && row.verifier === "") return false;
  return true;
}

function mergedRows(state: MemoryEntityState, parsed: ParsedEntityQuery): PassportEntityRow[] {
  const evm = state.evmPassports.filter((r) => matchesEntity(r, parsed));
  const svm = parsed.includeSvm
    ? state.svmPassports.filter((r) => matchesEntity(r, parsed))
    : [];
  return sortEntityRows([...evm, ...svm], parsed.verifiedFirst);
}

export function naivePerSideEntityBrowse(
  state: MemoryEntityState,
  parsed: Omit<ParsedEntityQuery, "includeSvm">,
): PassportEntityRow[] {
  const evmPage = sortEntityRows(
    state.evmPassports.filter((r) => matchesEntity(r, { ...parsed, includeSvm: false })),
    parsed.verifiedFirst,
  );
  const svmPage = sortEntityRows(
    state.svmPassports.filter((r) => matchesEntity(r, { ...parsed, includeSvm: true })),
    parsed.verifiedFirst,
  );
  const limit = parsed.limit ?? evmPage.length + svmPage.length;
  const offset = parsed.offset ?? 0;
  const naiveMerged = [...evmPage, ...svmPage];
  return naiveMerged.slice(offset, offset + limit);
}

export function naivePerSideStatusCounts(
  state: MemoryEntityState,
  parsed: Pick<ParsedEntityQuery, "namespaces">,
): StatusCounts {
  const evmCounts = foldStatusCounts(
    groupStatus(state.evmPassports.filter((r) => parsed.namespaces.includes(r.chainId))),
  );
  const svmCounts = foldStatusCounts(
    groupStatus(state.svmPassports.filter((r) => parsed.namespaces.includes(r.chainId))),
  );
  return {
    UNVERIFIED: evmCounts.UNVERIFIED + svmCounts.UNVERIFIED,
    VERIFIED: evmCounts.VERIFIED + svmCounts.VERIFIED,
    DISPUTED: evmCounts.DISPUTED + svmCounts.DISPUTED,
  };
}

function groupStatus(rows: PassportEntityRow[]): Array<{ status: string; total: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.status, (map.get(row.status) ?? 0) + 1);
  }
  return [...map.entries()].map(([status, total]) => ({ status, total }));
}

export function unionStatusCounts(
  state: MemoryEntityState,
  parsed: Pick<ParsedEntityQuery, "namespaces" | "includeSvm">,
): StatusCounts {
  const merged = mergedRows(state, {
    ...parsed,
    verifiedFirst: false,
    countOnly: false,
    groupByStatus: false,
    verifiedOnly: false,
  });
  return foldStatusCounts(groupStatus(merged));
}

export function createEntityMemoryPool(state: MemoryEntityState): pg.Pool {
  return {
    query: async (sql: string, params?: unknown[]) => {
      const parsed = parseEntityQuery(sql, params ?? []);

      if (parsed.groupByStatus) {
        const merged = mergedRows(state, parsed);
        const grouped = groupStatus(merged);
        return {
          rows: grouped.map((g) => ({ status: g.status, total: g.total })),
          rowCount: grouped.length,
        };
      }

      const merged = mergedRows(state, parsed);

      if (parsed.countOnly) {
        return { rows: [{ total: merged.length }], rowCount: 1 };
      }

      if (parsed.groupByStatus && sql.includes("verifier")) {
        const byVerifier = new Map<string, number>();
        for (const row of merged) {
          if (row.status !== "VERIFIED" || !row.verifier) continue;
          byVerifier.set(row.verifier, (byVerifier.get(row.verifier) ?? 0) + 1);
        }
        return {
          rows: [...byVerifier.entries()].map(([verifier, total]) => ({
            verifier,
            total,
          })),
          rowCount: byVerifier.size,
        };
      }

      const offset = parsed.offset ?? 0;
      const limit = parsed.limit ?? merged.length;
      const page = merged.slice(offset, offset + limit);

      return {
        rows: page.map(rowToPg),
        rowCount: page.length,
      };
    },
  } as unknown as pg.Pool;
}
