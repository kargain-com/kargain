/**
 * LayerZero Endpoint Metadata snapshot — fetch, narrow, hash, load.
 *
 * Source: https://metadata.layerzero-api.com/v1/metadata
 * Chain keys used by the API: `base-sepolia` (EID 40245), `sepolia-testnet` (EID 40161).
 * (Task wording said `basesep-testnet`; that key does not exist in the API.)
 *
 * Pathway confirmations are not exposed by the metadata API for 40245↔40161;
 * the snapshot pins an explicit fallback (see CONFIRMATIONS_FALLBACK).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, type Address } from "viem";

import { LZ_ENDPOINT_V2_BY_CHAIN } from "./chainlink-feeds.js";

export const LAYERZERO_METADATA_URL =
  "https://metadata.layerzero-api.com/v1/metadata" as const;

export const SNAPSHOT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "layerzero-metadata.snapshot.json",
);

/** Hub Base Sepolia EID. */
export const EID_HUB = 40245;
/** Spoke Ethereum Sepolia EID. */
export const EID_SPOKE = 40161;

export const METADATA_CHAIN_KEYS = {
  [EID_HUB]: "base-sepolia",
  [EID_SPOKE]: "sepolia-testnet",
} as const;

export const CHAIN_ID_BY_EID = {
  [EID_HUB]: 84532,
  [EID_SPOKE]: 11155111,
} as const;

/** Explicit fallback — metadata API has no pathway confirmations for this pair. */
export const CONFIRMATIONS_FALLBACK = 5;

export type DvnId = "layerzero-labs" | "nethermind" | "p2p" | "horizen";

export const REQUIRED_DVN_IDS: readonly DvnId[] = [
  "layerzero-labs",
  "nethermind",
] as const;

export const SNAPSHOT_DVN_IDS: readonly DvnId[] = [
  "layerzero-labs",
  "nethermind",
  "p2p",
  "horizen",
] as const;

export type LayerZeroChainSnapshot = {
  chainKey: string;
  chainId: 84532 | 11155111;
  eid: typeof EID_HUB | typeof EID_SPOKE;
  endpointV2: Address;
  sendUln302: Address;
  receiveUln302: Address;
  executor: Address;
  dvns: Record<DvnId, Address>;
  deadDvn: Address | null;
};

export type LayerZeroConfirmations = {
  "40245→40161": number;
  "40161→40245": number;
  source: "explicit-fallback" | "metadata-default";
};

export type LayerZeroMetadataSnapshot = {
  fetchedAt: string;
  source: typeof LAYERZERO_METADATA_URL;
  chains: {
    [EID_HUB]: LayerZeroChainSnapshot;
    [EID_SPOKE]: LayerZeroChainSnapshot;
  };
  confirmations: LayerZeroConfirmations;
  sha256: string;
};

type RawDvnMeta = {
  id?: string;
  canonicalName?: string;
  version?: number;
  deprecated?: boolean;
  lzReadCompatible?: boolean;
};

type RawDeployment = {
  version?: number;
  eid?: number | string;
  stage?: string;
  endpointV2?: { address?: string };
  sendUln302?: { address?: string };
  receiveUln302?: { address?: string };
  executor?: { address?: string };
};

type RawChain = {
  chainKey?: string;
  environment?: string;
  chainDetails?: { nativeChainId?: number };
  deployments?: RawDeployment[];
  dvns?: Record<string, RawDvnMeta>;
};

/** API id → snapshot DvnId. */
const DVN_ID_MAP: Record<string, DvnId> = {
  "layerzero-labs": "layerzero-labs",
  nethermind: "nethermind",
  p2p: "p2p",
  "horizen-labs": "horizen",
  horizen: "horizen",
};

function addr(value: string | undefined, label: string): Address {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid address for ${label}: ${value ?? "(missing)"}`);
  }
  return getAddress(value);
}

/**
 * Canonical JSON: recursively sort object keys; arrays keep order.
 * Used for sha256 of the snapshot payload (excluding the sha256 field itself).
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export function sha256Canonical(payloadWithoutHash: unknown): string {
  const body = canonicalizeJson(payloadWithoutHash);
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function pickDvnAddress(
  dvns: Record<string, RawDvnMeta>,
  targetId: DvnId,
): Address {
  const candidates: { address: string; score: number }[] = [];
  for (const [address, meta] of Object.entries(dvns)) {
    if (!meta || meta.version !== 2 || meta.deprecated) continue;
    const mapped = meta.id ? DVN_ID_MAP[meta.id] : undefined;
    if (mapped !== targetId) continue;
    // Prefer non-lzReadCompatible (standard messaging DVN).
    const score = meta.lzReadCompatible ? 0 : 1;
    candidates.push({ address, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  if (candidates.length === 0) {
    throw new Error(`No version-2 DVN found for id ${targetId}`);
  }
  return addr(candidates[0].address, `dvn:${targetId}`);
}

function pickDeadDvn(dvns: Record<string, RawDvnMeta>): Address | null {
  for (const [address, meta] of Object.entries(dvns)) {
    if (meta?.id === "lz-dead-dvn" && meta.version === 2) {
      return addr(address, "deadDvn");
    }
  }
  return null;
}

function narrowChain(
  raw: RawChain,
  eid: typeof EID_HUB | typeof EID_SPOKE,
): LayerZeroChainSnapshot {
  const expectedKey = METADATA_CHAIN_KEYS[eid];
  const expectedChainId = CHAIN_ID_BY_EID[eid];
  if (raw.environment !== "testnet") {
    throw new Error(
      `Expected testnet environment for ${expectedKey}, got ${raw.environment}`,
    );
  }
  const v2 = (raw.deployments ?? []).find(
    (d) => d.version === 2 && Number(d.eid) === eid,
  );
  if (!v2) {
    throw new Error(`No version-2 deployment with eid ${eid} for ${expectedKey}`);
  }
  const dvns = raw.dvns ?? {};
  const picked: Record<DvnId, Address> = {
    "layerzero-labs": pickDvnAddress(dvns, "layerzero-labs"),
    nethermind: pickDvnAddress(dvns, "nethermind"),
    p2p: pickDvnAddress(dvns, "p2p"),
    horizen: pickDvnAddress(dvns, "horizen"),
  };
  return {
    chainKey: expectedKey,
    chainId: expectedChainId,
    eid,
    endpointV2: addr(v2.endpointV2?.address, `${expectedKey}.endpointV2`),
    sendUln302: addr(v2.sendUln302?.address, `${expectedKey}.sendUln302`),
    receiveUln302: addr(v2.receiveUln302?.address, `${expectedKey}.receiveUln302`),
    executor: addr(v2.executor?.address, `${expectedKey}.executor`),
    dvns: picked,
    deadDvn: pickDeadDvn(dvns),
  };
}

export function buildSnapshotFromMetadata(
  full: Record<string, RawChain>,
  fetchedAt: string = new Date().toISOString(),
): LayerZeroMetadataSnapshot {
  const hubRaw = full[METADATA_CHAIN_KEYS[EID_HUB]];
  const spokeRaw = full[METADATA_CHAIN_KEYS[EID_SPOKE]];
  if (!hubRaw) {
    throw new Error(`Missing metadata key ${METADATA_CHAIN_KEYS[EID_HUB]}`);
  }
  if (!spokeRaw) {
    throw new Error(`Missing metadata key ${METADATA_CHAIN_KEYS[EID_SPOKE]}`);
  }

  const chains = {
    [EID_HUB]: narrowChain(hubRaw, EID_HUB),
    [EID_SPOKE]: narrowChain(spokeRaw, EID_SPOKE),
  };

  const withoutHash = {
    fetchedAt,
    source: LAYERZERO_METADATA_URL,
    chains,
    confirmations: {
      "40245→40161": CONFIRMATIONS_FALLBACK,
      "40161→40245": CONFIRMATIONS_FALLBACK,
      source: "explicit-fallback" as const,
    },
  };

  assertEndpointMatchesPinned(withoutHash.chains);

  return {
    ...withoutHash,
    sha256: sha256Canonical(withoutHash),
  };
}

function assertEndpointMatchesPinned(chains: LayerZeroMetadataSnapshot["chains"]): void {
  for (const eid of [EID_HUB, EID_SPOKE] as const) {
    const chainId = CHAIN_ID_BY_EID[eid];
    const expected = getAddress(LZ_ENDPOINT_V2_BY_CHAIN[chainId]);
    const got = getAddress(chains[eid].endpointV2);
    if (got !== expected) {
      throw new Error(
        `Snapshot endpointV2 for eid ${eid} (${got}) !== LZ_ENDPOINT_V2_BY_CHAIN[${chainId}] (${expected})`,
      );
    }
  }
}

export async function fetchLayerZeroMetadata(
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, RawChain>> {
  const res = await fetchImpl(LAYERZERO_METADATA_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`LayerZero metadata fetch failed: HTTP ${res.status}`);
  }
  return (await res.json()) as Record<string, RawChain>;
}

export function writeSnapshot(snapshot: LayerZeroMetadataSnapshot, path = SNAPSHOT_PATH): void {
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export type LoadSnapshotOpts = {
  allowDrift?: boolean;
  path?: string;
};

/**
 * Load committed snapshot; validate sha256 unless allowDrift.
 * Always hard-fails if endpointV2 ≠ LZ_ENDPOINT_V2_BY_CHAIN.
 */
export function loadLayerZeroMetadataSnapshot(
  opts: LoadSnapshotOpts = {},
): LayerZeroMetadataSnapshot {
  const path = opts.path ?? SNAPSHOT_PATH;
  if (!existsSync(path)) {
    throw new Error(`Missing LayerZero metadata snapshot at ${path}; run pnpm lz:snapshot`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as LayerZeroMetadataSnapshot;
  const { sha256: stored, ...rest } = raw;
  const computed = sha256Canonical(rest);
  if (stored !== computed && !opts.allowDrift) {
    throw new Error(
      `LayerZero metadata snapshot sha256 drift: stored=${stored} computed=${computed}. ` +
        `Re-run pnpm lz:snapshot or pass --allow-metadata-drift.`,
    );
  }
  assertEndpointMatchesPinned(raw.chains);
  // Normalize checksum casing on load.
  return {
    ...raw,
    chains: {
      [EID_HUB]: normalizeChain(raw.chains[EID_HUB]),
      [EID_SPOKE]: normalizeChain(raw.chains[EID_SPOKE]),
    },
  };
}

function normalizeChain(c: LayerZeroChainSnapshot): LayerZeroChainSnapshot {
  return {
    ...c,
    endpointV2: getAddress(c.endpointV2),
    sendUln302: getAddress(c.sendUln302),
    receiveUln302: getAddress(c.receiveUln302),
    executor: getAddress(c.executor),
    dvns: {
      "layerzero-labs": getAddress(c.dvns["layerzero-labs"]),
      nethermind: getAddress(c.dvns.nethermind),
      p2p: getAddress(c.dvns.p2p),
      horizen: getAddress(c.dvns.horizen),
    },
    deadDvn: c.deadDvn ? getAddress(c.deadDvn) : null,
  };
}

/** Payload without sha256 — for tests injecting fixtures. */
export function snapshotWithoutHash(
  snapshot: LayerZeroMetadataSnapshot,
): Omit<LayerZeroMetadataSnapshot, "sha256"> {
  const { sha256: _s, ...rest } = snapshot;
  return rest;
}
