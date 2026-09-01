/**
 * In-memory pg.Pool stub for provenance UNION SQL tests (chain-free).
 */
import type pg from "pg";

import type { AttestationRow, ProvenancePassportRecord } from "../../src/lib/ponder-passport-provenance.js";

export type MemoryProvenanceState = {
  evmRecords: ProvenancePassportRecord[];
  svmRecords: ProvenancePassportRecord[];
};

function sortRecordsDesc(rows: ProvenancePassportRecord[]): ProvenancePassportRecord[] {
  return rows.slice().sort((a, b) => {
    if (a.timestamp === b.timestamp) {
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    }
    return a.timestamp > b.timestamp ? -1 : 1;
  });
}

function matchesRecord(
  row: ProvenancePassportRecord,
  filters: {
    tokenId?: string;
    author?: string;
    recordType?: string;
    namespaces: number[];
  },
): boolean {
  if (filters.tokenId != null && row.tokenId !== filters.tokenId) return false;
  if (filters.author != null && row.author !== filters.author) return false;
  if (filters.recordType != null && row.recordType !== filters.recordType) return false;
  if (!filters.namespaces.includes(row.chainId)) return false;
  return true;
}

function parseUnionRecordQuery(
  sql: string,
  params: unknown[],
): {
  filters: {
    tokenId?: string;
    author?: string;
    recordType?: string;
    namespaces: number[];
  };
  includeSvm: boolean;
  limit?: number;
  offset?: number;
  countOnly: boolean;
} {
  const includeSvm = sql.includes("kargain_svm_projection.passport_record");
  const countOnly = sql.includes("COUNT(*)");

  let tokenId: string | undefined;
  let author: string | undefined;
  let recordType: string | undefined;
  let paramIdx = 0;

  if (sql.includes("token_id = $")) {
    tokenId = String(params[paramIdx++]);
  }
  if (sql.includes("author = $")) {
    author = String(params[paramIdx++]);
  }
  if (sql.includes("record_type = $")) {
    recordType = String(params[paramIdx++]);
  }
  const namespaces = params[paramIdx++] as number[];

  let limit: number | undefined;
  let offset: number | undefined;
  if (sql.includes(" LIMIT ")) {
    limit = Number(params[paramIdx++]);
  }
  if (sql.includes(" OFFSET ")) {
    offset = Number(params[paramIdx++]);
  }

  return {
    filters: { tokenId, author, recordType, namespaces },
    includeSvm,
    limit,
    offset,
    countOnly,
  };
}

export function createProvenanceMemoryPool(
  state: MemoryProvenanceState,
): pg.Pool {
  return {
    query: async (sql: string, params?: unknown[]) => {
      const parsed = parseUnionRecordQuery(sql, params ?? []);
      const evm = state.evmRecords.filter((r) => matchesRecord(r, parsed.filters));
      const svm = parsed.includeSvm
        ? state.svmRecords.filter((r) => matchesRecord(r, parsed.filters))
        : [];
      const merged = sortRecordsDesc([...evm, ...svm]);

      if (parsed.countOnly) {
        return { rows: [{ total: merged.length }], rowCount: 1 };
      }

      const offset = parsed.offset ?? 0;
      const limit = parsed.limit ?? merged.length;
      const page = merged.slice(offset, offset + limit);

      return {
        rows: page.map((row) => ({
          id: row.id,
          token_id: row.tokenId,
          chain_id: row.chainId,
          author: row.author,
          record_type: row.recordType,
          description: row.description,
          evidence_cid: row.evidenceCID,
          timestamp: row.timestamp.toString(),
        })),
        rowCount: page.length,
      };
    },
    end: async () => undefined,
  } as unknown as pg.Pool;
}

export function attestationFromRecord(
  row: ProvenancePassportRecord,
): AttestationRow {
  return {
    tokenId: row.tokenId,
    description: row.description,
    evidenceCID: row.evidenceCID,
    timestamp: row.timestamp,
  };
}

/** Deliberately wrong per-side pagination merge — negative control for UNION tests. */
export function naiveMergeAttestations(
  evmRows: AttestationRow[],
  svmRows: AttestationRow[],
  limit: number,
  offset: number,
): AttestationRow[] {
  const sortDesc = (rows: AttestationRow[]) =>
    rows.slice().sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
  const evmPage = sortDesc(evmRows).slice(offset, offset + limit);
  const svmPage = sortDesc(svmRows).slice(offset, offset + limit);
  return sortDesc([...evmPage, ...svmPage]).slice(0, limit);
}
