/**
 * Sole owner of the Ponder *identity* fingerprint — inputs Ponder may bake into
 * its internal build_id (chains, contract addresses/start blocks, ABI artifact,
 * schema, EVM indexing sources). Answers: "might a reindex be required?"
 *
 * Explicitly does NOT equal or predict Ponder's build_id. Changing this digest
 * means identity inputs changed; the operator may need ponder-reindex.sql before
 * a new image can start against the live schema.
 *
 * ABI identity is the sha256 of lib/contracts/abis.generated.ts — not a parallel
 * commercial ABI collection (that stays owned by commercial-abi-events + ponder.config).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID } from "./load-deployment.js";
import { buildPonderRuntime } from "./ponder-env.js";

/** Throwaway commercial RPC/window when unset — values never enter the identity digest. */
const IDENTITY_PLACEHOLDER_RPC = "https://ponder-fingerprint.invalid";

/**
 * Identity assembly needs buildPonderRuntime for chain ids / contracts, but
 * commercial RPC lists and getLogs windows are outside the digest. Install
 * placeholders only when unset so live fingerprinting works without a VPS `.env`.
 */
export function ensureCommercialRpcEnvForIdentityFingerprint(
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const chainId of [SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID]) {
    const urlsKey = `PONDER_RPC_URLS_${chainId}`;
    const rangeKey = `PONDER_GETLOGS_BLOCK_RANGE_${chainId}`;
    if (!env[urlsKey]?.trim()) {
      env[urlsKey] = IDENTITY_PLACEHOLDER_RPC;
    }
    if (!env[rangeKey]?.trim()) {
      env[rangeKey] = "1";
    }
  }
}

export type PonderIdentityChain = { name: string; id: number };

export type PonderIdentityContractEntry = {
  chain: unknown;
  address?: unknown;
  startBlock?: unknown;
};

export type PonderIdentityIndexingFile = {
  path: string;
  sha256: string;
};

export type PonderIdentityPayload = {
  ordering: "omnichain";
  chains: PonderIdentityChain[];
  contracts: Record<string, PonderIdentityContractEntry>;
  /** Digest of lib/contracts/abis.generated.ts (ABI bake input). */
  abisGeneratedSha256: string;
  schemaSha256: string;
  indexingFiles: PonderIdentityIndexingFile[];
};

/** Indexing paths Ponder glob-hashes that we deliberately exclude from our identity. */
export const PONDER_IDENTITY_INDEXING_EXCLUDES = [
  "src/api/",
  "src/svm-ingest/",
  "src/lib/svm-raw-writer.ts",
  "src/lib/svm-projection-writer.ts",
] as const;

export const PONDER_ABIS_GENERATED_REL = "lib/contracts/abis.generated.ts";

function sha256Bytes(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
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

/** Canonical JSON → sha256. Shared shape with other deploy digests. */
export function digestPonderIdentityPayload(
  payload: PonderIdentityPayload,
): string {
  const body = JSON.stringify(sortKeys(payload));
  return sha256Bytes(body);
}

function isExcludedIndexingPath(rel: string): boolean {
  const normalized = rel.replace(/\\/g, "/");
  for (const prefix of PONDER_IDENTITY_INDEXING_EXCLUDES) {
    if (normalized === prefix || normalized.startsWith(prefix)) return true;
  }
  return false;
}

function walkIndexingSources(root: string, dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkIndexingSources(root, full, out);
      continue;
    }
    if (!/\.(ts|js|mts|mjs)$/.test(name) || name.endsWith(".d.ts")) continue;
    const rel = relative(root, full).replace(/\\/g, "/");
    if (isExcludedIndexingPath(rel)) continue;
    out.push(rel);
  }
}

/**
 * List EVM indexing sources that enter our identity digest (sorted).
 * Injectable via opts.indexingRels for constructed tests.
 */
export function listPonderIdentityIndexingFiles(
  root: string,
  opts?: { indexingRels?: readonly string[] },
): PonderIdentityIndexingFile[] {
  const rels = opts?.indexingRels
    ? [...opts.indexingRels]
    : (() => {
        const found: string[] = [];
        walkIndexingSources(root, join(root, "src"), found);
        return found.sort();
      })();
  return rels.map((rel) => ({
    path: rel,
    sha256: sha256Bytes(readFileSync(join(root, rel))),
  }));
}

type DualContract =
  | "karPassport"
  | "karProPass"
  | "karProStaking"
  | "bridgeGateway"
  | "fixedPriceConsignment"
  | "ascendingConsignment";

/**
 * Build the identity payload from the same runtime owner ponder.config.ts uses.
 * Schema / indexing / ABI artifact are digests so tests can inject overrides.
 */
export function buildPonderIdentityPayload(
  root: string,
  opts?: {
    schemaSource?: string;
    abisGeneratedSource?: string;
    indexingRels?: readonly string[];
    /** Replace the live runtime assembly (constructed tests). */
    payload?: PonderIdentityPayload;
  },
): PonderIdentityPayload {
  if (opts?.payload) return opts.payload;

  ensureCommercialRpcEnvForIdentityFingerprint();

  const {
    chains,
    addresses,
    ethereumSepoliaAddresses,
    localAddresses,
    optionalAddresses,
    contractEntry,
  } = buildPonderRuntime();

  function dualEntry(
    hubAddress: `0x${string}`,
    contract: DualContract,
    localAddress?: `0x${string}`,
  ) {
    const ethAddress = ethereumSepoliaAddresses?.[contract];
    return contractEntry(hubAddress, contract, {
      ...(ethAddress ? { ethereumSepoliaAddress: ethAddress } : {}),
      ...(localAddress ? { localAddress } : {}),
    });
  }

  const fixedPriceAddress = optionalAddresses.FixedPriceConsignment;
  const ascendingAddress = optionalAddresses.AscendingConsignment;
  const gatewayAddress = optionalAddresses.KarPassportBridgeGateway;

  const contracts: Record<string, PonderIdentityContractEntry> = {
    KarPassport: {
      ...dualEntry(addresses.karPassport, "karPassport", localAddresses?.karPassport),
    },
    KarProPass: {
      ...dualEntry(addresses.karProPass, "karProPass", localAddresses?.karProPass),
    },
    KarProStaking: {
      ...dualEntry(
        addresses.karProStaking,
        "karProStaking",
        localAddresses?.karProStaking,
      ),
    },
  };

  if (fixedPriceAddress) {
    contracts.FixedPriceConsignment = {
      ...dualEntry(
        fixedPriceAddress,
        "fixedPriceConsignment",
        localAddresses?.fixedPriceConsignment,
      ),
    };
  }
  if (ascendingAddress) {
    contracts.AscendingConsignment = {
      ...dualEntry(
        ascendingAddress,
        "ascendingConsignment",
        localAddresses?.ascendingConsignment,
      ),
    };
  }
  if (gatewayAddress) {
    contracts.KarPassportBridgeGateway = {
      ...dualEntry(
        gatewayAddress,
        "bridgeGateway",
        localAddresses?.bridgeGateway,
      ),
    };
  }

  const chainEntries: PonderIdentityChain[] = Object.entries(chains)
    .map(([name, c]) => ({ name, id: c.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const schemaSource =
    opts?.schemaSource ??
    readFileSync(join(root, "ponder.schema.ts"), "utf8");
  const abisSource =
    opts?.abisGeneratedSource ??
    readFileSync(join(root, PONDER_ABIS_GENERATED_REL));

  return {
    ordering: "omnichain",
    chains: chainEntries,
    contracts,
    abisGeneratedSha256: sha256Bytes(abisSource),
    schemaSha256: sha256Bytes(schemaSource),
    indexingFiles: listPonderIdentityIndexingFiles(root, {
      indexingRels: opts?.indexingRels,
    }),
  };
}

export function computePonderIdentityFingerprint(
  root: string,
  opts?: Parameters<typeof buildPonderIdentityPayload>[1],
): string {
  return digestPonderIdentityPayload(buildPonderIdentityPayload(root, opts));
}
