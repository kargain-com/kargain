"use server";

import { parseMetadataJson } from "@/lib/passport/parse-metadata-json";
import { arUriToHttp } from "@/lib/storage/ar-gateway";
import type { VincentObservation } from "@/lib/vincent-commons/derive-claims";

const PONDER_URL = process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;
const METADATA_CONCURRENCY = 8;

type PonderPassportRow = {
  id: string;
  status: string;
  tokenUri: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  verifier: string;
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

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchVerifiedPassports(): Promise<PonderPassportRow[]> {
  const rows: PonderPassportRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${PONDER_URL}/passports?status=VERIFIED&verifiedFirst=false&page=${page}&limit=${PAGE_LIMIT}`;
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

async function buildObservation(row: PonderPassportRow): Promise<ObservationOutcome> {
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
 * F-2 Commons queue input — mirrors the scripts/vincent-derive.ts fetch shape:
 * VERIFIED passports from the Ponder HTTP API plus full metadata JSON per
 * tokenUri (engine/modelVariant are not in the Ponder table). Derivation runs
 * client-side in the KarPro Commons section; no Ponder schema or API changes.
 */
export async function getCommonsObservations(): Promise<CommonsObservationsResult> {
  const rows = await fetchVerifiedPassports();

  const verifierByTokenId: Record<string, string> = {};
  for (const row of rows) {
    const verifier = (row.verifier ?? "").trim().toLowerCase();
    if (verifier) verifierByTokenId[row.id] = verifier;
  }

  const outcomes = await mapWithConcurrency(rows, METADATA_CONCURRENCY, buildObservation);

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
