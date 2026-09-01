/**
 * In-memory projection writer for ingest/projection tests.
 */
import type {
  CustodyDeterminingProjectionDraft,
  PassportEntityProjectionDraft,
  PassportRecordProjectionDraft,
  PassportUriHistoryProjectionDraft,
} from "../lib/svm/project-raw-to-projection.js";
import type { SvmProjectionWriter } from "../src/lib/svm-projection-writer.js";

export function createMemorySvmProjectionWriter(): SvmProjectionWriter & {
  passportRecords: PassportRecordProjectionDraft[];
  uriHistory: PassportUriHistoryProjectionDraft[];
  custodyEvents: CustodyDeterminingProjectionDraft[];
  passports: PassportEntityProjectionDraft[];
} {
  const passportRecords: PassportRecordProjectionDraft[] = [];
  const uriHistory: PassportUriHistoryProjectionDraft[] = [];
  const custodyEvents: CustodyDeterminingProjectionDraft[] = [];
  const passports: PassportEntityProjectionDraft[] = [];

  return {
    passportRecords,
    uriHistory,
    custodyEvents,
    passports,
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
    async insertCustodyDeterminingEvent(row) {
      if (custodyEvents.some((r) => r.id === row.id)) return false;
      custodyEvents.push(row);
      return true;
    },
    async insertCustodyDeterminingEvents(rows) {
      let n = 0;
      for (const row of rows) {
        if (await this.insertCustodyDeterminingEvent(row)) n += 1;
      }
      return n;
    },
    async upsertPassportEntity(row) {
      const idx = passports.findIndex((p) => p.id === row.id);
      if (idx >= 0) {
        passports[idx] = row;
        return true;
      }
      passports.push(row);
      return true;
    },
    async upsertPassportEntities(rows) {
      let n = 0;
      for (const row of rows) {
        if (await this.upsertPassportEntity(row)) n += 1;
      }
      return n;
    },
  };
}
