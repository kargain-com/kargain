/**
 * Typed Ponder HTTP client — sole product builder of Ponder URLs and sole
 * parser of consignment wire envelopes. Transport stays in ponder-fetch.ts.
 */

import type { PonderConsignmentRow } from "@/lib/commerce/ponder-consignment";
import {
  consignmentsListQueryKeys,
  routeById,
  type PonderRouteDef,
} from "@/lib/web3/ponder-endpoints";
import {
  asConsignmentId,
  asPassportTokenId,
  type ConsignmentId,
  type PassportTokenId,
} from "@/lib/web3/ponder-ids";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch-transport";

export type PonderQuery = Record<string, string | number | boolean | undefined | null>;

function assertKnownRoute(id: string): PonderRouteDef {
  const route = routeById(id);
  if (!route) throw new Error(`Ponder route not in catalog: ${id}`);
  return route;
}

function assertQueryKeys(route: PonderRouteDef, query: PonderQuery): void {
  for (const key of Object.keys(query)) {
    if (query[key] === undefined || query[key] === null) continue;
    if (!route.query.includes(key)) {
      throw new Error(
        `Ponder query key "${key}" is not allowed on ${route.id} (allowed: ${route.query.join(", ") || "(none)"})`,
      );
    }
  }
}

function fillPath(
  pattern: string,
  params: Record<string, string>,
): string {
  let out = pattern;
  for (const [key, value] of Object.entries(params)) {
    const token = `:${key}`;
    if (!out.includes(token)) {
      throw new Error(`Ponder path ${pattern} has no :${key}`);
    }
    out = out.replace(token, encodeURIComponent(value));
  }
  if (out.includes(":")) {
    throw new Error(`Ponder path still has placeholders: ${out}`);
  }
  return out;
}

function applyQuery(url: URL, query: PonderQuery): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
}

/** Build an absolute Ponder URL for a catalog route. */
export function buildPonderUrl(
  routeId: string,
  pathParams: Record<string, string> = {},
  query: PonderQuery = {},
): URL {
  const route = assertKnownRoute(routeId);
  assertQueryKeys(route, query);
  const path = fillPath(route.path, pathParams);
  const url = new URL(`${ponderBaseUrl()}${path}`);
  applyQuery(url, query);
  return url;
}

export async function ponderGet(
  routeId: string,
  pathParams?: Record<string, string>,
  query?: PonderQuery,
): Promise<Response> {
  return ponderFetch(buildPonderUrl(routeId, pathParams, query).toString());
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

export type ListConsignmentsQuery = {
  page?: number;
  limit?: number;
  mode?: "fixedPrice" | "ascending";
  active?: boolean;
  phase?: string;
  chainId?: number;
  seller?: string;
  agent?: string;
  search?: string;
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  mileageMin?: number;
  mileageMax?: number;
  priceMin?: string;
  priceMax?: string;
  priceCurrency?: string;
  eurUsdRate?: string;
  ethUsdRate?: string;
  cnyUsdRate?: string;
  inrUsdRate?: string;
  brlUsdRate?: string;
  idrUsdRate?: string;
  audUsdRate?: string;
  aedUsdRate?: string;
  krwUsdRate?: string;
  rubUsdRate?: string;
  jpyUsdRate?: string;
  btcUsdRate?: string;
  fuelType?: string;
  bodyType?: string;
  transmission?: string;
  condition?: string;
  vehicleType?: string;
  placeId?: string;
  colour?: string;
  status?: string;
  sort?: string;
  verifiedFirst?: boolean;
};

/** Browse consignments — only handler-supported query keys. */
export function buildConsignmentsListUrl(query: ListConsignmentsQuery = {}): URL {
  const allowed = new Set(consignmentsListQueryKeys());
  const q: PonderQuery = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (!allowed.has(key)) continue;
    q[key] = value;
  }
  return buildPonderUrl("consignments.list", {}, q);
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
    "consignments.byToken",
    { tokenId: id },
    {
      mode: query.mode,
      chainId: query.chainId,
    },
  );
  if (res.status === 404) return { status: 404, consignment: null, ok: true };
  if (!res.ok) return { status: res.status, consignment: null, ok: false };
  const json: unknown = await res.json();
  return { status: res.status, consignment: parseConsignmentEnvelope(json), ok: true };
}

export async function fetchConsignmentById(
  consignmentId: ConsignmentId | string,
): Promise<{
  status: number;
  consignment: PonderConsignmentRow | null;
  ok: boolean;
}> {
  const id =
    typeof consignmentId === "string" ? asConsignmentId(consignmentId) : consignmentId;
  const res = await ponderGet("consignments.byId", { id });
  if (res.status === 404) return { status: 404, consignment: null, ok: true };
  if (!res.ok) return { status: res.status, consignment: null, ok: false };
  const json: unknown = await res.json();
  return { status: res.status, consignment: parseConsignmentEnvelope(json), ok: true };
}

export async function fetchConsignmentBids(
  consignmentId: ConsignmentId | string,
  query: { page?: number; limit?: number } = {},
): Promise<Response> {
  const id =
    typeof consignmentId === "string" ? asConsignmentId(consignmentId) : consignmentId;
  return ponderGet("consignments.bids", { id }, query);
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
  if (!lot.ok) return { status: lot.status, ok: false, consignmentId: null, body: null };
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
    body: await res.json(),
  };
}

export async function fetchPassportByToken(
  tokenId: PassportTokenId | string,
): Promise<Response> {
  const id = typeof tokenId === "string" ? asPassportTokenId(tokenId) : tokenId;
  return ponderGet("passports.byId", { tokenId: id });
}

export function buildPassportListUrl(query: PonderQuery): URL {
  return buildPonderUrl("passports.list", {}, query);
}

/** Path + query only — for CLI tools that supply a custom Ponder origin. */
export function buildPassportListPath(query: PonderQuery): string {
  const url = buildPassportListUrl(query);
  return `${url.pathname}${url.search}`;
}

export function buildVerifierDetailUrl(
  address: string,
  chainId?: number,
): string {
  return buildPonderUrl(
    "verifiers.byAddress",
    { address },
    chainId != null ? { chainId } : {},
  ).toString();
}

export function buildVerifierPassportsUrl(address: string): string {
  return buildPonderUrl("passports.list", {}, {
    verifier: address,
    status: "VERIFIED",
    limit: 100,
  }).toString();
}

export function buildVerifierAttestationsUrl(
  address: string,
  limit = 100,
): string {
  return buildPonderUrl(
    "verifiers.attestations",
    { address },
    { limit },
  ).toString();
}

export function buildSlugAvailableUrl(
  slug: string,
  ownerAddress?: string,
): string {
  return buildPonderUrl(
    "verifiers.slugAvailable",
    { slug },
    ownerAddress?.trim() ? { address: ownerAddress.trim() } : {},
  ).toString();
}

export async function fetchStatus(): Promise<Response> {
  return ponderGet("status");
}
