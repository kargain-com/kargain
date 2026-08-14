/**
 * Client-safe Ponder URL builders (no `"use cache"` / next/cache).
 * Projection GETs live in ponder-client → ponder-tagged-read (server-only).
 */

import {
  consignmentsListQueryKeys,
  routeById,
  type PonderRouteDef,
} from "@/lib/web3/ponder-endpoints";
import { ponderBaseUrl } from "@/lib/web3/ponder-fetch-transport";

export type PonderQuery = Record<
  string,
  string | number | boolean | undefined | null
>;

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

function fillPath(pattern: string, params: Record<string, string>): string {
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
export function buildConsignmentsListUrl(
  query: ListConsignmentsQuery = {},
): URL {
  const allowed = new Set(consignmentsListQueryKeys());
  const q: PonderQuery = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (!allowed.has(key)) continue;
    q[key] = value;
  }
  return buildPonderUrl("consignments.list", {}, q);
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
