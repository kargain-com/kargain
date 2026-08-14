/**
 * Choke-point for mutable Ponder HTTP reads (protocol projection state).
 *
 * Transport: {@link ponderFetch} / {@link ponderBaseUrl} (always `cache: "no-store"`).
 * Contract: typed URL build + response parse via re-exported client helpers.
 * Content-addressed blobs (Arweave / KarPro metadata) keep their own TTL fetches —
 * do not route them through this helper.
 */

export {
  ponderBaseUrl,
  ponderFetch,
} from "@/lib/web3/ponder-fetch-transport";

export {
  asConsignmentId,
  asPassportTokenId,
  consignmentIdFromUnknown,
  passportTokenIdFromUnknown,
  type ConsignmentId,
  type PassportTokenId,
} from "@/lib/web3/ponder-ids";

export {
  CONSIGNMENT_BROWSE_FILTER_QUERY_KEYS,
  PONDER_FORBIDDEN_PATH_SUBSTRINGS,
  PONDER_IMPLEMENTED_ROUTES,
  consignmentsListQueryKeys,
  routeById,
  type PonderRouteDef,
} from "@/lib/web3/ponder-endpoints";

export {
  buildConsignmentsListUrl,
  buildPassportListPath,
  buildPassportListUrl,
  buildPonderUrl,
  buildSlugAvailableUrl,
  buildVerifierAttestationsUrl,
  buildVerifierDetailUrl,
  buildVerifierPassportsUrl,
  fetchBidsForPassportToken,
  fetchConsignmentById,
  fetchConsignmentByToken,
  fetchConsignmentBids,
  fetchPassportByToken,
  fetchStatus,
  parseConsignmentEnvelope,
  ponderGet,
  type ListConsignmentsQuery,
  type PonderQuery,
} from "@/lib/web3/ponder-client";
