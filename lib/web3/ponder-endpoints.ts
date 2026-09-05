/**
 * Ponder HTTP endpoint catalog — derived from registered Hono routes in
 * `src/api/index.ts` + `src/api/commerce-routes.ts`. Product code may only
 * construct paths/query keys listed here as implemented.
 */

export type PonderHttpMethod = "GET";

export type PonderRouteRegistration = "hono" | "ponder-reserved";

export type PonderRouteDef = {
  /** Stable id for tests / diagnostics. */
  id: string;
  method: PonderHttpMethod;
  /**
   * Path pattern with `:param` placeholders.
   * Use `PassportTokenId` params only on `…/by-token/:tokenId` and passport routes;
   * use `ConsignmentId` only on `/consignments/:id` (+ `/bids`).
   */
  path: string;
  /** Query keys the matching handler reads via `c.req.query`. */
  query: readonly string[];
  /**
   * `hono` = custom route in `src/api/*`.
   * `ponder-reserved` = framework route (`/status`, `/ready`, `/health`) — not in Hono.
   */
  registration?: PonderRouteRegistration;
};

/** Browse filter / sort / FX keys read by `GET /consignments` (joined passport). */
export const CONSIGNMENT_BROWSE_FILTER_QUERY_KEYS = [
  "verifiedFirst",
  "search",
  "make",
  "model",
  "yearMin",
  "yearMax",
  "mileageMin",
  "mileageMax",
  "priceMin",
  "priceMax",
  "priceCurrency",
  "eurUsdRate",
  "ethUsdRate",
  "cnyUsdRate",
  "inrUsdRate",
  "brlUsdRate",
  "idrUsdRate",
  "audUsdRate",
  "aedUsdRate",
  "krwUsdRate",
  "rubUsdRate",
  "jpyUsdRate",
  "btcUsdRate",
  "fuelType",
  "bodyType",
  "transmission",
  "condition",
  "vehicleType",
  "placeId",
  "colour",
  "status",
  "sort",
] as const;

/** Routes that exist on the indexer today. */
export const PONDER_IMPLEMENTED_ROUTES: readonly PonderRouteDef[] = [
  {
    id: "readPathReady",
    method: "GET",
    path: "/read-path-ready",
    query: [],
  },
  {
    id: "consignments.list",
    method: "GET",
    path: "/consignments",
    query: [
      "page",
      "limit",
      "mode",
      "active",
      "phase",
      "chainId",
      "seller",
      "agent",
      ...CONSIGNMENT_BROWSE_FILTER_QUERY_KEYS,
    ],
  },
  {
    id: "consignments.byToken",
    method: "GET",
    path: "/consignments/by-token/:tokenId",
    query: ["chainId", "mode"],
  },
  {
    id: "consignments.byId",
    method: "GET",
    path: "/consignments/:id",
    query: [],
  },
  {
    id: "consignments.bids",
    method: "GET",
    path: "/consignments/:id/bids",
    query: ["page", "limit"],
  },
  {
    id: "accounts.obligations",
    method: "GET",
    path: "/accounts/:address/obligations",
    query: ["chainId"],
  },
  {
    id: "accounts.claims",
    method: "GET",
    path: "/accounts/:address/claims",
    query: ["chainId", "page", "limit"],
  },
  {
    id: "agents.mandates",
    method: "GET",
    path: "/agents/:address/mandates",
    query: ["page", "limit", "active"],
  },
  {
    id: "owners.mandates",
    method: "GET",
    path: "/owners/:address/mandates",
    query: ["page", "limit", "active"],
  },
  {
    id: "agents.consignments",
    method: "GET",
    path: "/agents/:address/consignments",
    query: ["page", "limit", "awaiting", "phase"],
  },
  {
    id: "commerce.claimCredits",
    method: "GET",
    path: "/commerce-claim-credits",
    query: ["page", "limit", "chainId", "reasonCode"],
  },
  {
    id: "challenges.list",
    method: "GET",
    path: "/challenges",
    query: ["page", "limit", "instance", "status", "subjectId", "challenger", "chainId"],
  },
  {
    id: "commerce.modes",
    method: "GET",
    path: "/commerce-modes",
    query: ["page", "limit", "chainId", "mode", "paused"],
  },
  {
    id: "commerce.paymentTokens",
    method: "GET",
    path: "/commerce-payment-tokens",
    query: ["page", "limit", "chainId", "modeContract", "active"],
  },
  {
    id: "commerce.currencyFeeds",
    method: "GET",
    path: "/commerce-currency-feeds",
    query: ["page", "limit", "chainId", "modeContract", "currencyCode"],
  },
  {
    id: "passports.list",
    method: "GET",
    path: "/passports",
    query: ["page", "limit", "owner", "verifier", "status", "vin", "verifiedFirst"],
  },
  {
    id: "passports.batch",
    method: "GET",
    path: "/passports/batch",
    query: ["ids"],
  },
  {
    id: "passports.byId",
    method: "GET",
    path: "/passports/:tokenId",
    query: [],
  },
  {
    id: "profile.passports",
    method: "GET",
    path: "/profile/:address/passports",
    query: [],
  },
  {
    id: "notifications.feed",
    method: "GET",
    path: "/notifications/:address",
    query: ["since", "limit"],
  },
  {
    id: "verifiers.list",
    method: "GET",
    path: "/verifiers",
    query: [],
  },
  {
    id: "verifiers.bySlug",
    method: "GET",
    path: "/verifiers/by-slug/:slug",
    query: ["chainId"],
  },
  {
    id: "verifiers.slugAvailable",
    method: "GET",
    path: "/verifiers/slug-available/:slug",
    query: ["address"],
  },
  {
    id: "verifiers.byAddress",
    method: "GET",
    path: "/verifiers/:address",
    query: ["chainId"],
  },
  {
    id: "verifiers.attestations",
    method: "GET",
    path: "/verifiers/:address/attestations",
    query: ["limit", "offset"],
  },
  {
    id: "status",
    method: "GET",
    path: "/status",
    query: [],
    registration: "ponder-reserved",
  },
] as const;

/**
 * Dead / retired Ponder API path fragments — must not appear in product URL
 * construction (app Next.js routes like `/profile/…` and `/auctions/…` are fine).
 */
export const PONDER_FORBIDDEN_PATH_SUBSTRINGS = [
  "/consignments/stats",
  "/consignments/facets",
  "/listings/batch",
  "/profile/", // only when paired with `/listings` — see policy test
  "auction-authorizations",
] as const;

export function routeById(id: string): PonderRouteDef | undefined {
  return PONDER_IMPLEMENTED_ROUTES.find((r) => r.id === id);
}

export function consignmentsListQueryKeys(): readonly string[] {
  const route = routeById("consignments.list");
  return route?.query ?? [];
}
