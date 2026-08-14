/**
 * Typed Ponder HTTP client — sole parser of consignment wire envelopes and
 * tagged projection GETs ({@link ponderTaggedJson}). URL builders live in
 * {@link ./ponder-urls} (client-safe). `/status` stays uncached transport.
 */

import type { PonderConsignmentRow } from "@/lib/commerce/ponder-consignment";
import type { IndexerQueryKeyPrefix } from "@/lib/web3/indexer-query-keys";
import {
  asConsignmentId,
  asPassportTokenId,
  type ConsignmentId,
  type PassportTokenId,
} from "@/lib/web3/ponder-ids";
import { ponderStatusFetch } from "@/lib/web3/ponder-fetch-transport";
import {
  ponderTaggedJson,
  type PonderTaggedResult,
} from "@/lib/web3/ponder-tagged-read";
import {
  buildPonderUrl,
  type PonderQuery,
} from "@/lib/web3/ponder-urls";

export type { PonderTaggedResult };
export type { PonderQuery, ListConsignmentsQuery } from "@/lib/web3/ponder-urls";
export {
  buildConsignmentsListUrl,
  buildPassportListPath,
  buildPassportListUrl,
  buildPonderUrl,
  buildSlugAvailableUrl,
  buildVerifierAttestationsUrl,
  buildVerifierDetailUrl,
  buildVerifierPassportsUrl,
} from "@/lib/web3/ponder-urls";

/**
 * Product Ponder GET — requires a cache tag from {@link IndexerQueryKeyPrefix}.
 * Returns serializable status + JSON body (not a Response).
 */
export async function ponderFetch(
  tag: IndexerQueryKeyPrefix,
  url: string,
): Promise<PonderTaggedResult> {
  return ponderTaggedJson(tag, url);
}

export async function ponderGet(
  tag: IndexerQueryKeyPrefix,
  routeId: string,
  pathParams?: Record<string, string>,
  query?: PonderQuery,
): Promise<PonderTaggedResult> {
  return ponderFetch(
    tag,
    buildPonderUrl(routeId, pathParams, query).toString(),
  );
}

export type ConsignmentEnvelope = { consignment: unknown };

function isPonderConsignmentRow(value: unknown): value is PonderConsignmentRow {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.tokenId === "string" &&
    typeof row.chainId === "number" &&
    Number.isFinite(row.chainId) &&
    typeof row.mode === "string" &&
    typeof row.modeContract === "string" &&
    typeof row.seller === "string" &&
    typeof row.asset === "string" &&
    typeof row.price === "string" &&
    typeof row.phase === "string" &&
    typeof row.openedAt === "string"
  );
}

/** Parse `{ consignment }` from by-token / by-id handlers. Fail-closed. */
export function parseConsignmentEnvelope(
  json: unknown,
): PonderConsignmentRow | null {
  if (json == null || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }
  const consignment = (json as ConsignmentEnvelope).consignment;
  if (consignment == null) return null;
  return isPonderConsignmentRow(consignment) ? consignment : null;
}

export async function fetchConsignmentByToken(
  tokenId: PassportTokenId | string,
  query: { mode?: "fixedPrice" | "ascending"; chainId?: number } = {},
): Promise<{
  status: number;
  consignment: PonderConsignmentRow | null;
  ok: boolean;
}> {
  const id = typeof tokenId === "string" ? asPassportTokenId(tokenId) : tokenId;
  const res = await ponderGet(
    "consignment-detail",
    "consignments.byToken",
    { tokenId: id },
    {
      mode: query.mode,
      chainId: query.chainId,
    },
  );
  if (res.status === 404) return { status: 404, consignment: null, ok: true };
  if (!res.ok) return { status: res.status, consignment: null, ok: false };
  return {
    status: res.status,
    consignment: parseConsignmentEnvelope(res.body),
    ok: true,
  };
}

export async function fetchConsignmentById(
  consignmentId: ConsignmentId | string,
): Promise<{
  status: number;
  consignment: PonderConsignmentRow | null;
  ok: boolean;
}> {
  const id =
    typeof consignmentId === "string"
      ? asConsignmentId(consignmentId)
      : consignmentId;
  const res = await ponderGet("consignment-detail", "consignments.byId", {
    id,
  });
  if (res.status === 404) return { status: 404, consignment: null, ok: true };
  if (!res.ok) return { status: res.status, consignment: null, ok: false };
  return {
    status: res.status,
    consignment: parseConsignmentEnvelope(res.body),
    ok: true,
  };
}

export async function fetchConsignmentBids(
  consignmentId: ConsignmentId | string,
  query: { page?: number; limit?: number } = {},
): Promise<PonderTaggedResult> {
  const id =
    typeof consignmentId === "string"
      ? asConsignmentId(consignmentId)
      : consignmentId;
  return ponderGet("consignment-bids", "consignments.bids", { id }, query);
}

/**
 * Resolve the live/latest lot for a passport, then load its bid page.
 * Token id is never passed as `/consignments/:id`.
 */
export async function fetchBidsForPassportToken(
  tokenId: PassportTokenId | string,
  query: {
    mode?: "fixedPrice" | "ascending";
    chainId?: number;
    page?: number;
    limit?: number;
  } = {},
): Promise<{
  status: number;
  ok: boolean;
  consignmentId: ConsignmentId | null;
  body: unknown | null;
}> {
  const lot = await fetchConsignmentByToken(tokenId, {
    mode: query.mode,
    chainId: query.chainId,
  });
  if (!lot.ok) {
    return { status: lot.status, ok: false, consignmentId: null, body: null };
  }
  if (lot.consignment == null) {
    return { status: 404, ok: true, consignmentId: null, body: null };
  }
  const consignmentId = asConsignmentId(lot.consignment.id);
  const res = await fetchConsignmentBids(consignmentId, {
    page: query.page,
    limit: query.limit,
  });
  if (!res.ok) {
    return { status: res.status, ok: false, consignmentId, body: null };
  }
  return {
    status: res.status,
    ok: true,
    consignmentId,
    body: res.body,
  };
}

export async function fetchPassportByToken(
  tokenId: PassportTokenId | string,
  opts?: { live?: boolean },
): Promise<PonderTaggedResult> {
  const id = typeof tokenId === "string" ? asPassportTokenId(tokenId) : tokenId;
  const url = buildPonderUrl("passports.byId", { tokenId: id }).toString();
  if (opts?.live) {
    const res = await ponderStatusFetch(url);
    const text = await res.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    return { status: res.status, ok: res.ok, body };
  }
  return ponderGet("passport-detail", "passports.byId", { tokenId: id });
}

/** Uncached `/status` for T4 indexer wait — not a projection cache entry. */
export async function fetchStatus(): Promise<Response> {
  return ponderStatusFetch(buildPonderUrl("status").toString());
}
