"use server";

import {
  fetchVerifiedObservations,
  type CommonsObservationsResult,
} from "@/lib/vincent-commons/observations-source";

const PONDER_URL = process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;
const METADATA_CONCURRENCY = 8;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * F-2 Commons queue input — same fetch shape as scripts/vincent-derive.ts via
 * the shared lib/vincent-commons/observations-source.ts: VERIFIED passports
 * from the Ponder HTTP API plus full metadata JSON per tokenUri. Derivation
 * runs client-side in the KarPro Commons section; no Ponder schema or API
 * changes.
 *
 * Types: import from `@/lib/vincent-commons/observations-source` — do not
 * re-export types from this `"use server"` file (Next registers them as
 * runtime server references and crashes the action bundle).
 */
export async function getCommonsObservations(): Promise<CommonsObservationsResult> {
  return fetchVerifiedObservations({
    ponderUrl: PONDER_URL,
    fetchJson,
    pageLimit: PAGE_LIMIT,
    maxPages: MAX_PAGES,
    concurrency: METADATA_CONCURRENCY,
  });
}
