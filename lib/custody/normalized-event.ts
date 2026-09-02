/** Custody-determining event kinds (stream B + crossing semantics). */
export type CustodyDeterminationKind =
  | "native_mint"
  | "bridge_arrival"
  | "custody_unlock"
  | "home_unlock";

export type NormalizedCustodyEvent = {
  tokenId: string;
  namespace: number;
  kind: CustodyDeterminationKind;
  writerOrderKey: string;
};

export type NormalizedCrossingLeg = {
  guid: string;
  direction: "sent" | "received";
  tokenId: string;
  observerNamespace: number;
  peerNamespace: number | null;
  peerNamespaceRefusal?: "unknown_endpoint_id";
  writerOrderKey: string;
};

/**
 * Sole runtime census of fold-incomplete causes (§4.21).
 * Type and parsers must consume this list — do not duplicate the literals.
 */
export const CUSTODY_UNRESOLVED_CAUSES = [
  "empty_history",
  "departure_without_arrival",
  "incomplete_crossing_link",
  "unknown_namespace",
  "conflicting_determination",
] as const;

export type CustodyUnresolvedCause = (typeof CUSTODY_UNRESOLVED_CAUSES)[number];

export function isCustodyUnresolvedCause(
  value: unknown,
): value is CustodyUnresolvedCause {
  return (
    typeof value === "string" &&
    (CUSTODY_UNRESOLVED_CAUSES as readonly string[]).includes(value)
  );
}

/** Parse a fold cause string; unknown values refuse (null). */
export function parseCustodyUnresolvedCause(
  value: unknown,
): CustodyUnresolvedCause | null {
  return isCustodyUnresolvedCause(value) ? value : null;
}

export type CustodyFoldResult =
  | { status: "resolved"; custodyNamespace: number }
  | { status: "unresolved"; cause: CustodyUnresolvedCause };

export type PassportCustodyAnswer =
  | { custodyChain: number; custodyUnresolved: null }
  | { custodyChain: null; custodyUnresolved: CustodyUnresolvedCause };

export function passportCustodyAnswerFromFold(
  result: CustodyFoldResult,
): PassportCustodyAnswer {
  if (result.status === "resolved") {
    return { custodyChain: result.custodyNamespace, custodyUnresolved: null };
  }
  return { custodyChain: null, custodyUnresolved: result.cause };
}
