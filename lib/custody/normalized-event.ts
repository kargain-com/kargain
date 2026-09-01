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

export type CustodyUnresolvedCause =
  | "empty_history"
  | "departure_without_arrival"
  | "incomplete_crossing_link"
  | "unknown_namespace"
  | "conflicting_determination";

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
