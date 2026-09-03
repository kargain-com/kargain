/**
 * LayerZero Endpoint Metadata snapshot — fetch, narrow, hash, load.
 *
 * Source: https://metadata.layerzero-api.com/v1/metadata
 * Snapshot `chains` is keyed by EID. Hub is 40245; spokes are every other key.
 * EVM rows keep the historical JSON field set (no `vm` written). SVM rows
 * carry `vm: "svm"` and base58 program ids.
 *
 * Pathway confirmations / required DVN ids live on the pathway, not the
 * toolchain. The committed 40245↔40161 pair still uses explicit-fallback 5
 * when the metadata API exposes no pathway defaults.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, type Address } from "viem";

import { namespaceFromLayerZeroEid } from "../../lib/web3/kargain-namespace.js";
import { normalizeProtocolAddressForVm } from "../../lib/web3/protocol-address.js";
import { LZ_ENDPOINT_V2_BY_CHAIN } from "./chainlink-feeds.js";

export const LAYERZERO_METADATA_URL =
  "https://metadata.layerzero-api.com/v1/metadata" as const;

export const SNAPSHOT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "layerzero-metadata.snapshot.json",
);

/** Hub Base Sepolia EID. */
export const EID_HUB = 40245;
/** Live wired Ethereum Sepolia spoke EID. */
export const EID_SPOKE = 40161;
/** Solana Devnet spoke EID (SPEC §13.5). */
export const EID_SOLANA_DEVNET = 40168;

/** Known testnet spoke EIDs (star ends). 40267 Amoy is not a spoke. */
export const KNOWN_TESTNET_SPOKE_EIDS: readonly number[] = [
  EID_SPOKE,
  EID_SOLANA_DEVNET,
];

/** API keys for EVM chains we already pin — lookup fallback if eid scan misses. */
export const METADATA_CHAIN_KEYS: Record<number, string> = {
  [EID_HUB]: "base-sepolia",
  [EID_SPOKE]: "sepolia-testnet",
};

export const CHAIN_ID_BY_EID: Record<number, number> = {
  [EID_HUB]: 84532,
  [EID_SPOKE]: 11155111,
};

/** Explicit fallback — metadata API has no pathway confirmations for 40245↔40161. */
export const CONFIRMATIONS_FALLBACK = 5;

export type DvnId = "layerzero-labs" | "nethermind" | "p2p" | "horizen";

/** Default required operators for the live 40245↔40161 pathway (not global). */
export const LIVE_PATHWAY_REQUIRED_DVN_IDS: readonly DvnId[] = [
  "layerzero-labs",
  "nethermind",
] as const;

/**
 * Required operators for 40245↔40168 (П-5). Intersection of snapshot DVN ids
 * present on both ends: labs + p2p. Not a copy of the live pair’s nethermind set.
 */
export const HUB_SOLANA_DEVNET_REQUIRED_DVN_IDS: readonly DvnId[] = [
  "layerzero-labs",
  "p2p",
] as const;

export const SNAPSHOT_DVN_IDS: readonly DvnId[] = [
  "layerzero-labs",
  "nethermind",
  "p2p",
  "horizen",
] as const;

export type LayerZeroEvmChainSnapshot = {
  /** Absent or `"evm"` — historical JSON omits the field. */
  vm?: "evm";
  chainKey: string;
  chainId: number;
  eid: number;
  endpointV2: Address;
  sendUln302: Address;
  receiveUln302: Address;
  executor: Address;
  dvns: Partial<Record<DvnId, Address>>;
  deadDvn: Address | null;
};

export type LayerZeroSvmChainSnapshot = {
  vm: "svm";
  chainKey: string;
  namespace: number;
  eid: number;
  endpointV2: string;
  sendUln302: string;
  receiveUln302: string;
  executor: string;
  dvns: Partial<Record<DvnId, string>>;
  deadDvn: string | null;
};

export type LayerZeroChainSnapshot =
  | LayerZeroEvmChainSnapshot
  | LayerZeroSvmChainSnapshot;

export type ConfirmationSource = "explicit-fallback" | "metadata-default";

export type LayerZeroPathwayRecord = {
  requiredDvnIds: DvnId[];
  confirmations: Record<string, number>;
  source: ConfirmationSource;
};

export type LayerZeroMetadataSnapshot = {
  fetchedAt: string;
  source: typeof LAYERZERO_METADATA_URL;
  chains: Record<number, LayerZeroChainSnapshot>;
  /** Per-pathway records keyed by sorted `"lo-hi"` EID pair. Sole confirmations owner. */
  pathways: Record<string, LayerZeroPathwayRecord>;
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

/**
 * Classify snapshot chain VM. Missing `vm` or `"evm"` → EVM (historical JSON).
 * `"svm"` → SVM. Any other value is a named refusal (never a silent EVM default).
 */
export function classifyLayerZeroVm(chain: { vm?: string }): "evm" | "svm" {
  const vm = chain.vm;
  if (vm === undefined || vm === "evm") return "evm";
  if (vm === "svm") return "svm";
  throw new Error(`Unknown LayerZero chain vm: ${String(vm)}`);
}

export function isEvmLayerZeroChain(
  chain: LayerZeroChainSnapshot,
): chain is LayerZeroEvmChainSnapshot {
  return classifyLayerZeroVm(chain) === "evm";
}

export function isSvmLayerZeroChain(
  chain: LayerZeroChainSnapshot,
): chain is LayerZeroSvmChainSnapshot {
  return classifyLayerZeroVm(chain) === "svm";
}

export function confirmationDirectionKey(srcEid: number, dstEid: number): string {
  return `${srcEid}→${dstEid}`;
}

export function pathwayPairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function spokeEidsFromSnapshot(
  snapshot: Pick<LayerZeroMetadataSnapshot, "chains">,
): number[] {
  return Object.keys(snapshot.chains)
    .map(Number)
    .filter((eid) => eid !== EID_HUB)
    .sort((a, b) => a - b);
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

function evmAddr(value: string | undefined, label: string): Address {
  const normalized = normalizeProtocolAddressForVm("evm", value ?? "");
  if (normalized == null) {
    throw new Error(`Invalid address for ${label}: ${value ?? "(missing)"}`);
  }
  return getAddress(normalized);
}

function svmAddr(value: string | undefined, label: string): string {
  const normalized = normalizeProtocolAddressForVm("svm", value ?? "");
  if (normalized == null) {
    throw new Error(`Invalid SVM program id for ${label}: ${value ?? "(missing)"}`);
  }
  return normalized;
}

function pickDvnAddress(
  dvns: Record<string, RawDvnMeta>,
  targetId: DvnId,
  vm: "evm" | "svm",
): string | null {
  const candidates: { address: string; score: number }[] = [];
  for (const [address, meta] of Object.entries(dvns)) {
    if (!meta || meta.version !== 2 || meta.deprecated) continue;
    const mapped = meta.id ? DVN_ID_MAP[meta.id] : undefined;
    if (mapped !== targetId) continue;
    const score = meta.lzReadCompatible ? 0 : 1;
    candidates.push({ address, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  if (candidates.length === 0) return null;
  return vm === "svm"
    ? svmAddr(candidates[0].address, `dvn:${targetId}`)
    : evmAddr(candidates[0].address, `dvn:${targetId}`);
}

function pickDeadDvn(
  dvns: Record<string, RawDvnMeta>,
  vm: "evm" | "svm",
): string | null {
  for (const [address, meta] of Object.entries(dvns)) {
    if (meta?.id === "lz-dead-dvn" && meta.version === 2) {
      return vm === "svm"
        ? svmAddr(address, "deadDvn")
        : evmAddr(address, "deadDvn");
    }
  }
  return null;
}

function dvnsPresent(
  rawDvns: Record<string, RawDvnMeta>,
  vm: "evm" | "svm",
): Partial<Record<DvnId, string>> {
  const picked: Partial<Record<DvnId, string>> = {};
  for (const id of SNAPSHOT_DVN_IDS) {
    const addr = pickDvnAddress(rawDvns, id, vm);
    if (addr != null) picked[id] = addr;
  }
  return picked;
}

export function findRawChainByEid(
  full: Record<string, RawChain>,
  eid: number,
): { key: string; raw: RawChain } | null {
  const pinnedKey = METADATA_CHAIN_KEYS[eid];
  if (pinnedKey && full[pinnedKey]) {
    return { key: pinnedKey, raw: full[pinnedKey] };
  }
  for (const [key, raw] of Object.entries(full)) {
    const hit = (raw.deployments ?? []).find(
      (d) => d.version === 2 && Number(d.eid) === eid,
    );
    if (hit) return { key, raw };
  }
  return null;
}

function requireV2Deployment(raw: RawChain, eid: number, chainKey: string): RawDeployment {
  const v2 = (raw.deployments ?? []).find(
    (d) => d.version === 2 && Number(d.eid) === eid,
  );
  if (!v2) {
    throw new Error(`No version-2 deployment with eid ${eid} for ${chainKey}`);
  }
  return v2;
}

function narrowEvmChain(raw: RawChain, eid: number): LayerZeroEvmChainSnapshot {
  const expectedKey = METADATA_CHAIN_KEYS[eid] ?? raw.chainKey ?? `eid-${eid}`;
  const expectedChainId = CHAIN_ID_BY_EID[eid];
  if (raw.environment !== "testnet") {
    throw new Error(
      `Expected testnet environment for ${expectedKey}, got ${raw.environment}`,
    );
  }
  if (expectedChainId != null) {
    const native = raw.chainDetails?.nativeChainId;
    if (native != null && native !== expectedChainId) {
      throw new Error(
        `nativeChainId ${native} !== expected ${expectedChainId} for eid ${eid}`,
      );
    }
  }
  const v2 = requireV2Deployment(raw, eid, expectedKey);
  const rawDvns = raw.dvns ?? {};
  const picked = dvnsPresent(rawDvns, "evm") as Partial<Record<DvnId, Address>>;
  for (const id of LIVE_PATHWAY_REQUIRED_DVN_IDS) {
    if (picked[id] == null) {
      throw new Error(`No version-2 DVN found for id ${id} on eid ${eid}`);
    }
  }
  return {
    chainKey: expectedKey,
    chainId: expectedChainId ?? raw.chainDetails?.nativeChainId ?? 0,
    eid,
    endpointV2: evmAddr(v2.endpointV2?.address, `${expectedKey}.endpointV2`),
    sendUln302: evmAddr(v2.sendUln302?.address, `${expectedKey}.sendUln302`),
    receiveUln302: evmAddr(v2.receiveUln302?.address, `${expectedKey}.receiveUln302`),
    executor: evmAddr(v2.executor?.address, `${expectedKey}.executor`),
    dvns: picked,
    deadDvn: pickDeadDvn(rawDvns, "evm") as Address | null,
  };
}

function narrowSvmChain(raw: RawChain, eid: number, chainKey: string): LayerZeroSvmChainSnapshot {
  if (raw.environment !== "testnet" && raw.environment !== "devnet") {
    throw new Error(
      `Expected testnet/devnet environment for ${chainKey}, got ${raw.environment}`,
    );
  }
  const v2 = requireV2Deployment(raw, eid, chainKey);
  const rawDvns = raw.dvns ?? {};
  return {
    vm: "svm",
    chainKey,
    namespace: namespaceFromLayerZeroEid(eid),
    eid,
    endpointV2: svmAddr(v2.endpointV2?.address, `${chainKey}.endpointV2`),
    sendUln302: svmAddr(v2.sendUln302?.address, `${chainKey}.sendUln302`),
    receiveUln302: svmAddr(v2.receiveUln302?.address, `${chainKey}.receiveUln302`),
    executor: svmAddr(v2.executor?.address, `${chainKey}.executor`),
    dvns: dvnsPresent(rawDvns, "svm"),
    deadDvn: pickDeadDvn(rawDvns, "svm"),
  };
}

export function dvnIdsOnChain(chain: LayerZeroChainSnapshot): DvnId[] {
  const ids: DvnId[] = [];
  for (const id of SNAPSHOT_DVN_IDS) {
    if (chain.dvns[id]) ids.push(id);
  }
  return ids;
}

export function dvnIdsOnBothEnds(
  a: LayerZeroChainSnapshot,
  b: LayerZeroChainSnapshot,
): DvnId[] {
  const bSet = new Set(dvnIdsOnChain(b));
  return dvnIdsOnChain(a).filter((id) => bSet.has(id));
}

function livePathwayRecord(): LayerZeroPathwayRecord {
  return {
    requiredDvnIds: [...LIVE_PATHWAY_REQUIRED_DVN_IDS],
    confirmations: {
      [confirmationDirectionKey(EID_HUB, EID_SPOKE)]: CONFIRMATIONS_FALLBACK,
      [confirmationDirectionKey(EID_SPOKE, EID_HUB)]: CONFIRMATIONS_FALLBACK,
    },
    source: "explicit-fallback",
  };
}

function hubSolanaPathwayRecord(): LayerZeroPathwayRecord {
  return {
    requiredDvnIds: [...HUB_SOLANA_DEVNET_REQUIRED_DVN_IDS],
    confirmations: {
      [confirmationDirectionKey(EID_HUB, EID_SOLANA_DEVNET)]: CONFIRMATIONS_FALLBACK,
      [confirmationDirectionKey(EID_SOLANA_DEVNET, EID_HUB)]: CONFIRMATIONS_FALLBACK,
    },
    source: "explicit-fallback",
  };
}

function cloneChain(chain: LayerZeroChainSnapshot): LayerZeroChainSnapshot {
  return JSON.parse(JSON.stringify(chain)) as LayerZeroChainSnapshot;
}

/**
 * Metadata API exposes no per-pathway confirmation defaults for the star
 * testnet EIDs (no `confirmations` key on the chain objects). Explicit fallback
 * is allowed; copying another pathway’s *operator set* is not.
 */
function metadataPathwayConfirmations(
  _full: Record<string, RawChain>,
  _srcEid: number,
  _dstEid: number,
): { value: number; source: ConfirmationSource } {
  return { value: CONFIRMATIONS_FALLBACK, source: "explicit-fallback" };
}

export function assertPinnedDvnsOnBothEnds(
  a: LayerZeroChainSnapshot,
  b: LayerZeroChainSnapshot,
  ids: readonly DvnId[],
  label: string,
): void {
  const both = new Set(dvnIdsOnBothEnds(a, b));
  const missing = ids.filter((id) => !both.has(id));
  if (missing.length > 0 || ids.length < 2) {
    throw new Error(
      `П-5: ${label} requires ≥2 independent operators present on both ends; ` +
        `missing [${missing.join(",")}] (intersection [${[...both].join(",")}])`,
    );
  }
}

function synthesizePathways(
  chains: Record<number, LayerZeroChainSnapshot>,
  existing: Record<string, LayerZeroPathwayRecord> | undefined,
): Record<string, LayerZeroPathwayRecord> {
  const pathways: Record<string, LayerZeroPathwayRecord> = { ...(existing ?? {}) };
  const liveKey = pathwayPairKey(EID_HUB, EID_SPOKE);
  if (!pathways[liveKey]) {
    pathways[liveKey] = livePathwayRecord();
  }
  const spokes = Object.keys(chains)
    .map(Number)
    .filter((eid) => eid !== EID_HUB);
  for (const spoke of spokes) {
    const key = pathwayPairKey(EID_HUB, spoke);
    if (pathways[key]) continue;
    if (spoke === EID_SPOKE) continue;
    const hub = chains[EID_HUB];
    const spokeChain = chains[spoke];
    if (!hub || !spokeChain) continue;
    if (spoke === EID_SOLANA_DEVNET) {
      assertPinnedDvnsOnBothEnds(
        hub,
        spokeChain,
        HUB_SOLANA_DEVNET_REQUIRED_DVN_IDS,
        "40245↔40168",
      );
      pathways[key] = hubSolanaPathwayRecord();
      continue;
    }
    const both = dvnIdsOnBothEnds(hub, spokeChain);
    if (both.length < 2) continue;
    pathways[key] = {
      requiredDvnIds: both.slice(0, 2),
      confirmations: {
        [confirmationDirectionKey(EID_HUB, spoke)]: CONFIRMATIONS_FALLBACK,
        [confirmationDirectionKey(spoke, EID_HUB)]: CONFIRMATIONS_FALLBACK,
      },
      source: "explicit-fallback",
    };
  }
  return pathways;
}

export function pathwayRecord(
  snapshot: LayerZeroMetadataSnapshot,
  srcEid: number,
  dstEid: number,
): LayerZeroPathwayRecord {
  const key = pathwayPairKey(srcEid, dstEid);
  const record = snapshot.pathways[key];
  if (!record) {
    throw new Error(`No pathway record for ${srcEid}↔${dstEid}`);
  }
  return record;
}

export function buildSnapshotFromMetadata(
  full: Record<string, RawChain>,
  fetchedAt: string = new Date().toISOString(),
  previous?: Pick<LayerZeroMetadataSnapshot, "chains" | "pathways">,
): LayerZeroMetadataSnapshot {
  const chains: Record<number, LayerZeroChainSnapshot> = {};
  const prevChains = previous ? parseChainsMap(previous.chains) : {};

  for (const eid of [EID_HUB, EID_SPOKE] as const) {
    const preserved = prevChains[eid];
    if (preserved && isEvmLayerZeroChain(preserved)) {
      chains[eid] = cloneChain(preserved);
      continue;
    }
    const found = findRawChainByEid(full, eid);
    if (!found) {
      throw new Error(
        `Missing metadata for eid ${eid}` +
          (METADATA_CHAIN_KEYS[eid] ? ` (key ${METADATA_CHAIN_KEYS[eid]})` : ""),
      );
    }
    chains[eid] = narrowEvmChain(found.raw, eid);
  }

  const solana = findRawChainByEid(full, EID_SOLANA_DEVNET);
  if (!solana) {
    throw new Error(
      "Missing metadata for eid 40168 (Solana testnet/devnet). Cannot extend the star snapshot.",
    );
  }
  chains[EID_SOLANA_DEVNET] = narrowSvmChain(
    solana.raw,
    EID_SOLANA_DEVNET,
    solana.raw.chainKey ?? solana.key,
  );

  const hub = chains[EID_HUB];
  const svm = chains[EID_SOLANA_DEVNET];
  if (hub && svm) {
    assertPinnedDvnsOnBothEnds(
      hub,
      svm,
      HUB_SOLANA_DEVNET_REQUIRED_DVN_IDS,
      "40245↔40168",
    );
  }

  const solanaConf = metadataPathwayConfirmations(
    full,
    EID_HUB,
    EID_SOLANA_DEVNET,
  );
  const pathways = synthesizePathways(chains, previous?.pathways);
  const solanaKey = pathwayPairKey(EID_HUB, EID_SOLANA_DEVNET);
  if (pathways[solanaKey]) {
    pathways[solanaKey] = {
      ...pathways[solanaKey],
      confirmations: {
        [confirmationDirectionKey(EID_HUB, EID_SOLANA_DEVNET)]: solanaConf.value,
        [confirmationDirectionKey(EID_SOLANA_DEVNET, EID_HUB)]: solanaConf.value,
      },
      source: solanaConf.source,
    };
  }

  const withoutHash = {
    fetchedAt,
    source: LAYERZERO_METADATA_URL,
    chains,
    pathways,
  };

  assertEndpointMatchesPinned(withoutHash.chains);

  return {
    ...withoutHash,
    sha256: sha256Canonical(withoutHash),
  };
}

/** Read the committed snapshot file as stored (no synthesize / normalize). */
export function readCommittedSnapshotFile(
  path = SNAPSHOT_PATH,
): LayerZeroMetadataSnapshot | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as LayerZeroMetadataSnapshot;
}

function assertEndpointMatchesPinned(
  chains: Record<number, LayerZeroChainSnapshot>,
): void {
  for (const chain of Object.values(chains)) {
    if (!isEvmLayerZeroChain(chain)) continue;
    const chainId = CHAIN_ID_BY_EID[chain.eid];
    if (chainId == null) continue;
    const pinned = LZ_ENDPOINT_V2_BY_CHAIN[chainId as keyof typeof LZ_ENDPOINT_V2_BY_CHAIN];
    if (pinned == null) continue;
    const expected = getAddress(pinned);
    const got = getAddress(chain.endpointV2);
    if (got !== expected) {
      throw new Error(
        `Snapshot endpointV2 for eid ${chain.eid} (${got}) !== LZ_ENDPOINT_V2_BY_CHAIN[${chainId}] (${expected})`,
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

function parseChainsMap(
  rawChains: Record<string, LayerZeroChainSnapshot> | LayerZeroMetadataSnapshot["chains"],
): Record<number, LayerZeroChainSnapshot> {
  const out: Record<number, LayerZeroChainSnapshot> = {};
  for (const [key, chain] of Object.entries(rawChains)) {
    out[Number(key)] = chain as LayerZeroChainSnapshot;
  }
  return out;
}

/**
 * Load committed snapshot; validate sha256 unless allowDrift.
 * Always hard-fails if an EVM endpointV2 ≠ LZ_ENDPOINT_V2_BY_CHAIN.
 */
export function loadLayerZeroMetadataSnapshot(
  opts: LoadSnapshotOpts = {},
): LayerZeroMetadataSnapshot {
  const path = opts.path ?? SNAPSHOT_PATH;
  if (!existsSync(path)) {
    throw new Error(`Missing LayerZero metadata snapshot at ${path}; run pnpm lz:snapshot`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as LayerZeroMetadataSnapshot & {
    /** Stripped on load if a legacy file still carries it. */
    confirmations?: unknown;
  };
  const { sha256: stored, confirmations: _legacyConfirmations, ...rest } = raw;
  const computed = sha256Canonical(rest);
  if (stored !== computed && !opts.allowDrift) {
    throw new Error(
      `LayerZero metadata snapshot sha256 drift: stored=${stored} computed=${computed}. ` +
        `Re-run pnpm lz:snapshot or pass --allow-metadata-drift.`,
    );
  }
  const chains = parseChainsMap(raw.chains);
  assertEndpointMatchesPinned(chains);
  const pathways = synthesizePathways(chains, raw.pathways);
  const normalizedChains: Record<number, LayerZeroChainSnapshot> = {};
  for (const [eid, chain] of Object.entries(chains)) {
    normalizedChains[Number(eid)] = normalizeChain(chain);
  }
  return {
    fetchedAt: raw.fetchedAt,
    source: raw.source,
    sha256: stored,
    chains: normalizedChains,
    pathways,
  };
}

function normalizeChain(c: LayerZeroChainSnapshot): LayerZeroChainSnapshot {
  if (!isEvmLayerZeroChain(c)) {
    const dvns: Partial<Record<DvnId, string>> = {};
    for (const id of SNAPSHOT_DVN_IDS) {
      const v = c.dvns[id];
      if (v) dvns[id] = svmAddr(v, `dvn:${id}`);
    }
    return {
      vm: "svm",
      chainKey: c.chainKey,
      namespace: c.namespace,
      eid: c.eid,
      endpointV2: svmAddr(c.endpointV2, "endpointV2"),
      sendUln302: svmAddr(c.sendUln302, "sendUln302"),
      receiveUln302: svmAddr(c.receiveUln302, "receiveUln302"),
      executor: svmAddr(c.executor, "executor"),
      dvns,
      deadDvn: c.deadDvn ? svmAddr(c.deadDvn, "deadDvn") : null,
    };
  }
  const dvns: Partial<Record<DvnId, Address>> = {};
  for (const id of SNAPSHOT_DVN_IDS) {
    const v = c.dvns[id];
    if (v) dvns[id] = evmAddr(v, `dvn:${id}`);
  }
  return {
    chainKey: c.chainKey,
    chainId: c.chainId,
    eid: c.eid,
    endpointV2: evmAddr(c.endpointV2, "endpointV2"),
    sendUln302: evmAddr(c.sendUln302, "sendUln302"),
    receiveUln302: evmAddr(c.receiveUln302, "receiveUln302"),
    executor: evmAddr(c.executor, "executor"),
    dvns,
    deadDvn: c.deadDvn ? evmAddr(c.deadDvn, "deadDvn") : null,
  };
}

/** Payload without sha256 — for tests injecting fixtures. */
export function snapshotWithoutHash(
  snapshot: LayerZeroMetadataSnapshot,
): Omit<LayerZeroMetadataSnapshot, "sha256"> {
  const { sha256: _s, ...rest } = snapshot;
  return rest;
}
