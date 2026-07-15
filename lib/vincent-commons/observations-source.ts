/**
 * Shared VERIFIED-observation source for the Vincent Commons layer.
 *
 * One implementation of the Ponder `/passports?status=VERIFIED` pagination,
 * per-tokenUri metadata fetch, and observation building consumed by both
 * scripts/vincent-derive.ts (CLI) and app/actions/vincent-commons.ts (F-2
 * Commons queue). Pure module: `fetchJson` is injected by the caller — no
 * env access, no logging here.
 */
import { parseMetadataJson } from "@/lib/passport/parse-metadata-json";
import { arUriToHttp } from "@/lib/storage/ar-gateway";
import type { VincentObservation } from "@/lib/vincent-commons/derive-claims";

export type FetchJson = (url: string) => Promise<unknown>;

type PonderPassportRow = {
  id: string;
  status: string;
  tokenUri: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  verifier?: string;
};

type PassportsPage = {
  passports: PonderPassportRow[];
  total: number;
};

export type CommonsMetadataFailure = { tokenId: string; reason: string };

export type CommonsObservationsResult = {
  observations: VincentObservation[];
  /** tokenId → verifier of record (lowercased) from the Ponder passport row. */
  verifierByTokenId: Record<string, string>;
  metadataFailures: CommonsMetadataFailure[];
};

export type FetchVerifiedObservationsOptions = {
  ponderUrl: string;
  fetchJson: FetchJson;
  pageLimit?: number;
  maxPages?: number;
  concurrency?: number;
};

async function fetchVerifiedPassports(
  ponderUrl: string,
  fetchJson: FetchJson,
  pageLimit: number,
  maxPages: number,
): Promise<PonderPassportRow[]> {
  const rows: PonderPassportRow[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${ponderUrl}/passports?status=VERIFIED&verifiedFirst=false&page=${page}&limit=${pageLimit}`;
    const body = (await fetchJson(url)) as PassportsPage;
    rows.push(...body.passports);
    if (rows.length >= body.total || body.passports.length === 0) break;
  }
  return rows;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

type ObservationOutcome =
  | { observation: VincentObservation }
  | { failure: CommonsMetadataFailure };

async function buildObservation(
  row: PonderPassportRow,
  fetchJson: FetchJson,
): Promise<ObservationOutcome> {
  const url = arUriToHttp(row.tokenUri);
  if (!url) {
    return { failure: { tokenId: row.id, reason: "unsupported-token-uri" } };
  }

  let metadata: ReturnType<typeof parseMetadataJson>;
  try {
    metadata = parseMetadataJson(await fetchJson(url));
  } catch {
    return { failure: { tokenId: row.id, reason: "metadata-fetch-failed" } };
  }
  if (!metadata) {
    return { failure: { tokenId: row.id, reason: "metadata-parse-failed" } };
  }

  return {
    observation: {
      tokenId: row.id,
      vin: metadata.vin || row.vin,
      year: metadata.year ?? row.year,
      make: metadata.make || row.make || undefined,
      model: metadata.model || row.model || undefined,
      modelVariant: metadata.modelVariant,
      bodyType: metadata.bodyType,
      fuelType: metadata.fuelType,
      transmission: metadata.transmission,
      engine: metadata.engine,
    },
  };
}

/**
 * VERIFIED passports from the Ponder HTTP API plus full metadata JSON per
 * tokenUri (engine/modelVariant are not in the Ponder table). Results are
 * index-ordered — output is deterministic at any concurrency. Every row
 * yields exactly one observation or one metadata failure.
 */
export async function fetchVerifiedObservations(
  options: FetchVerifiedObservationsOptions,
): Promise<CommonsObservationsResult> {
  const {
    ponderUrl,
    fetchJson,
    pageLimit = 100,
    maxPages = Number.POSITIVE_INFINITY,
    concurrency = 1,
  } = options;

  const rows = await fetchVerifiedPassports(ponderUrl, fetchJson, pageLimit, maxPages);

  const verifierByTokenId: Record<string, string> = {};
  for (const row of rows) {
    const verifier = (row.verifier ?? "").trim().toLowerCase();
    if (verifier) verifierByTokenId[row.id] = verifier;
  }

  const outcomes = await mapWithConcurrency(rows, concurrency, (row) =>
    buildObservation(row, fetchJson),
  );

  const observations: VincentObservation[] = [];
  const metadataFailures: CommonsMetadataFailure[] = [];
  for (const outcome of outcomes) {
    if ("observation" in outcome) {
      observations.push(outcome.observation);
    } else {
      metadataFailures.push(outcome.failure);
    }
  }

  return { observations, verifierByTokenId, metadataFailures };
}
