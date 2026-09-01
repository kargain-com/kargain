/**
 * In-memory projection writer for ingest/projection tests.
 */
import type {
  PassportRecordProjectionDraft,
  PassportUriHistoryProjectionDraft,
} from "../lib/svm/project-raw-to-projection.js";
import type { SvmProjectionWriter } from "../src/lib/svm-projection-writer.js";

export function createMemorySvmProjectionWriter(): SvmProjectionWriter & {
  passportRecords: PassportRecordProjectionDraft[];
  uriHistory: PassportUriHistoryProjectionDraft[];
} {
  const passportRecords: PassportRecordProjectionDraft[] = [];
  const uriHistory: PassportUriHistoryProjectionDraft[] = [];

  return {
    passportRecords,
    uriHistory,
    async insertPassportRecord(row) {
      if (passportRecords.some((r) => r.id === row.id)) return false;
      passportRecords.push(row);
      return true;
    },
    async insertPassportUriHistory(row) {
      if (uriHistory.some((r) => r.id === row.id)) return false;
      uriHistory.push(row);
      return true;
    },
    async insertPassportRecords(rows) {
      let n = 0;
      for (const row of rows) {
        if (await this.insertPassportRecord(row)) n += 1;
      }
      return n;
    },
    async insertPassportUriHistoryRows(rows) {
      let n = 0;
      for (const row of rows) {
        if (await this.insertPassportUriHistory(row)) n += 1;
      }
      return n;
    },
  };
}
