/**
 * LayerZero endpoint id → Kargain commercial namespace (SPEC §13.1).
 * Sole product/indexer owner — avoids importing this from kargain-namespace.ts
 * (commercial-active already imports namespace mint helpers there).
 */

import { EID_BY_CHAIN } from "@/lib/web3/bridge/bridge-config";
import { commercialActive } from "@/lib/web3/commercial-active";
import {
  mintKargainNamespace,
  namespaceFromLayerZeroEid,
  type KargainNamespace,
} from "@/lib/web3/kargain-namespace";

export type PeerNamespaceRefusalReason = "unknown_endpoint_id";

export type PeerNamespaceRefusal = {
  ok: false;
  reason: PeerNamespaceRefusalReason;
};

export type PeerNamespaceResolved = {
  ok: true;
  namespace: KargainNamespace;
};

export type PeerNamespaceResult = PeerNamespaceResolved | PeerNamespaceRefusal;

function chainIdFromCommercialLayerZeroEid(eid: number): number | undefined {
  for (const [chainId, mappedEid] of Object.entries(EID_BY_CHAIN)) {
    if (mappedEid === eid) return Number(chainId);
  }
  return undefined;
}

/**
 * Resolve a LayerZero peer EID to a registered commercial namespace.
 * Unknown or unregistered peers fail closed — never fabricate EIP-155 ids.
 */
export function commercialNamespaceFromLayerZeroEid(
  eid: number,
): PeerNamespaceResult {
  if (!Number.isInteger(eid) || eid <= 0) {
    return { ok: false, reason: "unknown_endpoint_id" };
  }

  const evmChainId = chainIdFromCommercialLayerZeroEid(eid);
  if (evmChainId !== undefined && commercialActive(evmChainId)) {
    return { ok: true, namespace: mintKargainNamespace(evmChainId) };
  }

  let reservedNamespace: number;
  try {
    reservedNamespace = namespaceFromLayerZeroEid(eid);
  } catch {
    return { ok: false, reason: "unknown_endpoint_id" };
  }

  if (commercialActive(reservedNamespace)) {
    return { ok: true, namespace: mintKargainNamespace(reservedNamespace) };
  }

  return { ok: false, reason: "unknown_endpoint_id" };
}
