/**
 * Choke-point for mutable Ponder HTTP reads (protocol projection state).
 *
 * Product reads: {@link ponderFetch} / helpers — tagged `"use cache"`
 * (`IndexerQueryKeyPrefix`). Invalidation: `syncReads` → `updateTag` (T3/T4).
 * `/status` wait instrument: {@link fetchStatus} — uncached transport only.
 * Content-addressed blobs (Arweave / KarPro metadata) keep their own TTL fetches —
 * do not route them through this helper.
 */

export { ponderBaseUrl } from "@/lib/web3/ponder-fetch-transport";

export {
  CONSIGNMENT_BROWSE_FILTER_QUERY_KEYS,
  PONDER_FORBIDDEN_PATH_SUBSTRINGS,
  PONDER_IMPLEMENTED_ROUTES,
  consignmentsListQueryKeys,
  routeById,
  type PonderRouteDef,
} from "@/lib/web3/ponder-endpoints";

export {
  INDEXER_QUERY_KEY_PREFIXES,
  type IndexerQueryKeyPrefix,
} from "@/lib/web3/indexer-query-keys";

export {
  buildConsignmentsListUrl,
  buildPassportListPath,
  buildPassportListUrl,
  buildPonderUrl,
  buildSlugAvailableUrl,
  buildVerifierAttestationsUrl,
  buildVerifierDetailUrl,
  buildVerifierPassportsUrl,
  type ListConsignmentsQuery,
  type PonderQuery,
} from "@/lib/web3/ponder-urls";

export {
  asConsignmentId,
  asPassportTokenId,
  consignmentIdFromUnknown,
  passportTokenIdFromUnknown,
  type ConsignmentId,
  type PassportTokenId,
} from "@/lib/web3/ponder-ids";

export {
  fetchBidsForPassportToken,
  fetchConsignmentById,
  fetchConsignmentByToken,
  fetchConsignmentBids,
  fetchPassportByToken,
  fetchStatus,
  parseConsignmentEnvelope,
  ponderFetch,
  ponderGet,
  type PonderTaggedResult,
} from "@/lib/web3/ponder-client";

export { ponderTaggedJson } from "@/lib/web3/ponder-tagged-read";
