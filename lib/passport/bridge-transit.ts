/**
 * Bridge transit lifecycle — pure domain + session recovery I/O.
 * Chain delivery (dst ownerOf) and Ponder custody are reconciled here;
 * sessionStorage is recovery only, never authority without reconcile.
 */

import type { BridgeDirectionMode } from "@/lib/passport/bridge-surface";
import { BRIDGE_DELIVERY_TIMEOUT_MS } from "@/lib/web3/bridge/bridge-config";

/** Hard TTL for session recovery (24h). Delivery poll still uses BRIDGE_DELIVERY_TIMEOUT_MS. */
export const BRIDGE_TRANSIT_HARD_TTL_MS = 24 * 60 * 60 * 1000;

export type BridgeTransitPhase =
  | "submitting"
  | "source_confirmed"
  | "in_flight"
  | "delivered_on_chain"
  | "indexer_catchup"
  | "timed_out"
  | "complete";

export type BridgeTransitRecord = {
  tokenId: string;
  srcChainId: number;
  dstChainId: number;
  /** Checksum or lowercased recipient; compare case-insensitive. */
  recipient: string;
  guid: string | null;
  /** Epoch ms when src receipt confirmed. */
  sentAt: number;
  mode: BridgeDirectionMode;
  phase: BridgeTransitPhase;
};

export type BridgeTransitChainFacts = {
  now: number;
  /** Lowercased dst owner when readable; null when token missing / RPC fail. */
  dstOwner: string | null;
  /** Ponder custody when known; null/undefined = unknown (do not complete on). */
  ponderCustodyChain: number | null | undefined;
  deliveryTimeoutMs?: number;
  hardTtlMs?: number;
};

export type BridgeTransitUi = {
  phase: BridgeTransitPhase;
  active: boolean;
  title: string;
  description: string;
  /** Step index 0–2 for Sent / In transit / Arrived. */
  stepIndex: number;
  stepLabels: readonly [string, string, string];
};

export type ProfileTransitOverlay = {
  inTransit: boolean;
  /** Chain for detail href while in transit. */
  hrefChainId: number;
  /** Mono tertiary badge copy, or null. */
  badge: string | null;
};

export type TransitStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const SESSION_PREFIX = "kargain:bridge-transit:v1:";

export function bridgeTransitSessionKey(
  address: string,
  tokenId: string,
): string {
  return `${SESSION_PREFIX}${address.toLowerCase()}:${tokenId}`;
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isBridgeTransitActivePhase(
  phase: BridgeTransitPhase,
): boolean {
  return (
    phase === "submitting" ||
    phase === "source_confirmed" ||
    phase === "in_flight" ||
    phase === "delivered_on_chain" ||
    phase === "indexer_catchup"
  );
}

export function parseBridgeTransitRecord(
  raw: unknown,
): BridgeTransitRecord | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const tokenId = typeof o.tokenId === "string" ? o.tokenId.trim() : "";
  const srcChainId = Number(o.srcChainId);
  const dstChainId = Number(o.dstChainId);
  const recipient =
    typeof o.recipient === "string" ? normalizeAddress(o.recipient) : "";
  const guid =
    o.guid == null
      ? null
      : typeof o.guid === "string" && o.guid.startsWith("0x")
        ? o.guid
        : null;
  const sentAt = Number(o.sentAt);
  const mode = o.mode === "return" || o.mode === "move" ? o.mode : null;
  const phase = parsePhase(o.phase);
  if (
    !tokenId ||
    !/^\d+$/.test(tokenId) ||
    !Number.isInteger(srcChainId) ||
    srcChainId <= 0 ||
    !Number.isInteger(dstChainId) ||
    dstChainId <= 0 ||
    !recipient ||
    !Number.isFinite(sentAt) ||
    sentAt <= 0 ||
    mode == null ||
    phase == null
  ) {
    return null;
  }
  return {
    tokenId,
    srcChainId,
    dstChainId,
    recipient,
    guid,
    sentAt,
    mode,
    phase,
  };
}

function parsePhase(value: unknown): BridgeTransitPhase | null {
  switch (value) {
    case "submitting":
    case "source_confirmed":
    case "in_flight":
    case "delivered_on_chain":
    case "indexer_catchup":
    case "timed_out":
    case "complete":
      return value;
    default:
      return null;
  }
}

export function readBridgeTransitRecord(
  address: string,
  tokenId: string,
  storage: TransitStorage,
): BridgeTransitRecord | null {
  try {
    const raw = storage.getItem(bridgeTransitSessionKey(address, tokenId));
    if (raw == null) return null;
    return parseBridgeTransitRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeBridgeTransitRecord(
  address: string,
  record: BridgeTransitRecord,
  storage: TransitStorage,
): void {
  try {
    storage.setItem(
      bridgeTransitSessionKey(address, record.tokenId),
      JSON.stringify(record),
    );
  } catch {
    // quota / private mode
  }
}

export function clearBridgeTransitRecord(
  address: string,
  tokenId: string,
  storage: TransitStorage,
): void {
  try {
    storage.removeItem(bridgeTransitSessionKey(address, tokenId));
  } catch {
    // ignore
  }
}

/**
 * Reconcile session intent with chain + indexer facts.
 * Returns null when the record must be cleared (TTL / complete / invalid).
 */
export function reconcileBridgeTransit(
  record: BridgeTransitRecord,
  facts: BridgeTransitChainFacts,
): BridgeTransitRecord | null {
  const deliveryTimeout =
    facts.deliveryTimeoutMs ?? BRIDGE_DELIVERY_TIMEOUT_MS;
  const hardTtl = facts.hardTtlMs ?? BRIDGE_TRANSIT_HARD_TTL_MS;
  const age = facts.now - record.sentAt;

  if (age < 0 || age > hardTtl) {
    return null;
  }

  if (record.phase === "complete" || record.phase === "timed_out") {
    return null;
  }

  const dstMatch =
    facts.dstOwner != null &&
    normalizeAddress(facts.dstOwner) === normalizeAddress(record.recipient);

  const indexed =
    facts.ponderCustodyChain != null &&
    facts.ponderCustodyChain === record.dstChainId;

  if (indexed) {
    return null;
  }

  if (dstMatch) {
    return {
      ...record,
      phase: "indexer_catchup",
    };
  }

  if (
    age > deliveryTimeout &&
    (record.phase === "source_confirmed" ||
      record.phase === "in_flight" ||
      record.phase === "submitting")
  ) {
    return { ...record, phase: "timed_out" };
  }

  if (
    record.phase === "submitting" ||
    record.phase === "source_confirmed"
  ) {
    return { ...record, phase: "in_flight" };
  }

  if (record.phase === "delivered_on_chain") {
    return { ...record, phase: "indexer_catchup" };
  }

  return record;
}

export function deriveBridgeTransitUi(
  record: BridgeTransitRecord,
  dstName: string,
): BridgeTransitUi {
  const stepLabels = [
    "Sent",
    "In transit",
    `Arrived on ${dstName}`,
  ] as const;

  let stepIndex = 0;
  if (
    record.phase === "in_flight" ||
    record.phase === "source_confirmed"
  ) {
    stepIndex = 1;
  } else if (
    record.phase === "delivered_on_chain" ||
    record.phase === "indexer_catchup"
  ) {
    stepIndex = 2;
  }

  const active = isBridgeTransitActivePhase(record.phase);
  const action =
    record.mode === "return" ? "Returning" : "Moving";

  let description: string;
  switch (record.phase) {
    case "submitting":
      description = "Confirming the bridge transaction…";
      break;
    case "source_confirmed":
    case "in_flight":
      description = `Passport is in transit to ${dstName}. It is locked on the source chain until delivery confirms.`;
      break;
    case "delivered_on_chain":
    case "indexer_catchup":
      description = `Delivered on ${dstName}. Waiting for the indexer to catch up…`;
      break;
    case "timed_out":
      description = `Delivery was not confirmed on ${dstName} in time. Check LayerZero Scan.`;
      break;
    case "complete":
      description = `Bridge to ${dstName} complete.`;
      break;
  }

  return {
    phase: record.phase,
    active,
    title: `${action} to ${dstName}`,
    description,
    stepIndex,
    stepLabels,
  };
}

/**
 * Overlay for own-profile passport cards while a transit is open.
 */
export function mergeProfilePassportWithTransit(input: {
  tokenId: string;
  originChainId: number;
  custodyChain: number;
  transit: BridgeTransitRecord | null;
  dstName: string;
}): ProfileTransitOverlay {
  const { transit, dstName, custodyChain } = input;
  if (transit == null || !isBridgeTransitActivePhase(transit.phase)) {
    return {
      inTransit: false,
      hrefChainId: custodyChain,
      badge: null,
    };
  }

  const hrefChainId =
    transit.phase === "delivered_on_chain" ||
    transit.phase === "indexer_catchup"
      ? transit.dstChainId
      : transit.srcChainId;

  const badge =
    transit.mode === "return"
      ? `Returning to ${dstName}`
      : `In transit to ${dstName}`;

  return {
    inTransit: true,
    hrefChainId,
    badge,
  };
}

/** Browser sessionStorage adapter; null when unavailable. */
export function getBrowserTransitStorage(): TransitStorage | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage;
}
