import { LOCALHOST_CHAIN_ID } from "../../lib/web3/local-chain.js";
import type { DeploymentBlocks } from "./load-deployment.js";
import {
  ponderLocalAddresses,
  SEPOLIA_CHAIN_ID,
  SPOKE_CHAIN_ID,
  type PonderAddressBundle,
} from "./load-deployment.js";
import {
  ponderAddressesFromStack,
  resolveCommercialStack,
} from "./resolve-sepolia-stack.js";

export type ContractBlockKey = keyof DeploymentBlocks;

export type PonderEnvRefusalCode =
  | "invalid_start_block"
  | "missing_getlogs_block_range"
  | "missing_rpc_urls"
  | "empty_rpc_urls"
  | "invalid_rpc_url"
  | "duplicate_rpc_url";

/** Typed config refusal: closed code + env key. Preflight reads `.code` / `.envKey` only. */
export class PonderEnvRefusalError extends Error {
  readonly code: PonderEnvRefusalCode;
  readonly envKey: string;

  constructor(code: PonderEnvRefusalCode, envKey: string, message: string) {
    super(message);
    this.name = "PonderEnvRefusalError";
    this.code = code;
    this.envKey = envKey;
  }
}

const LOCAL_START_BLOCK_KEY = "PONDER_START_BLOCK_31337";

/** Local Hardhat start only (`PONDER_START_BLOCK_31337`); unset → 0. */
export function resolveLocalStartBlock(): number {
  const raw = process.env.PONDER_START_BLOCK_31337;
  const trimmed = raw?.trim();
  if (!trimmed) return 0;
  const block = Number.parseInt(trimmed, 10);
  if (!/^\d+$/.test(trimmed) || !Number.isFinite(block)) {
    throw new PonderEnvRefusalError(
      "invalid_start_block",
      LOCAL_START_BLOCK_KEY,
      `Invalid start block value: ${raw}`,
    );
  }
  return block;
}

/** Commercial chain start: the registry `indexFromBlock` (ADR 0016 §a). */
export function commercialIndexFromBlock(chainId: number): number {
  return resolveCommercialStack(chainId).indexFromBlock;
}

/** Commercial contract start: registry per-contract block, else the chain start. */
function commercialContractStartBlock(
  chainId: number,
  contract: ContractBlockKey,
): number {
  const stack = resolveCommercialStack(chainId);
  return stack.blocks[contract] ?? stack.indexFromBlock;
}

type PonderDatabaseConfig =
  | { kind: "pglite"; directory?: string }
  | { kind: "postgres"; connectionString?: string };

/**
 * Local dev / E2E use embedded PGlite when no Postgres connection string is set,
 * so Docker Postgres is not required. Production always provides DATABASE_URL
 * (docker-compose) and stays on Postgres.
 */
/** The Postgres connection string Ponder writes through, when one is set. */
export function resolvePonderConnectionString(): string | undefined {
  return (
    process.env.DATABASE_URL ??
    process.env.PONDER_DATABASE_URL ??
    process.env.DATABASE_PRIVATE_URL
  );
}

function resolvePonderDatabase(enableLocal: boolean): PonderDatabaseConfig {
  const connectionString = resolvePonderConnectionString();

  if (connectionString) {
    return { kind: "postgres", connectionString };
  }

  if (enableLocal) {
    return {
      kind: "pglite",
      directory: process.env.PONDER_PGLITE_DIR ?? ".ponder/pglite",
    };
  }

  // Non-local without a connection string: keep postgres (Ponder resolves
  // DATABASE_PRIVATE_URL/DATABASE_URL at runtime) — production path unchanged.
  return { kind: "postgres", connectionString };
}

/** The two transport keys of a commercial chain, each read by name. */
function commercialTransportEnv(chainId: number): NodeJS.ProcessEnv {
  return {
    [`PONDER_RPC_URLS_${chainId}`]: process.env[`PONDER_RPC_URLS_${chainId}`],
    [`PONDER_GETLOGS_BLOCK_RANGE_${chainId}`]:
      process.env[`PONDER_GETLOGS_BLOCK_RANGE_${chainId}`],
  };
}

/**
 * Required eth_getLogs window for a commercial chain.
 * Env: `PONDER_GETLOGS_BLOCK_RANGE_<chainId>` — positive integer, no default.
 */
export function resolveGetLogsBlockRange(
  chainId: number,
  env: NodeJS.ProcessEnv = commercialTransportEnv(chainId),
): number {
  const key = `PONDER_GETLOGS_BLOCK_RANGE_${chainId}`;
  const raw = env[key];
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new PonderEnvRefusalError(
      "missing_getlogs_block_range",
      key,
      `missing_getlogs_block_range: set ${key} to a positive integer (no default)`,
    );
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new PonderEnvRefusalError(
      "missing_getlogs_block_range",
      key,
      `missing_getlogs_block_range: set ${key} to a positive integer (no default)`,
    );
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new PonderEnvRefusalError(
      "missing_getlogs_block_range",
      key,
      `missing_getlogs_block_range: set ${key} to a positive integer (no default)`,
    );
  }
  return n;
}

/**
 * Required comma-separated HTTPS RPC list for a commercial chain.
 * Env: `PONDER_RPC_URLS_<chainId>` — no default, no singular fallback.
 */
export function resolveCommercialRpcUrls(
  chainId: number,
  env: NodeJS.ProcessEnv = commercialTransportEnv(chainId),
): string[] {
  const key = `PONDER_RPC_URLS_${chainId}`;
  const raw = env[key];
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new PonderEnvRefusalError(
      "missing_rpc_urls",
      key,
      `missing_rpc_urls: set ${key} to a comma-separated list of https URLs (no default)`,
    );
  }
  const parts = trimmed
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new PonderEnvRefusalError(
      "empty_rpc_urls",
      key,
      `empty_rpc_urls: set ${key} to a comma-separated list of https URLs (no default)`,
    );
  }
  const seen = new Set<string>();
  for (const url of parts) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new PonderEnvRefusalError(
        "invalid_rpc_url",
        key,
        `invalid_rpc_url: ${key} entry is not a valid URL: ${url}`,
      );
    }
    if (parsed.protocol !== "https:") {
      throw new PonderEnvRefusalError(
        "invalid_rpc_url",
        key,
        `invalid_rpc_url: ${key} entry must be https: ${url}`,
      );
    }
    if (seen.has(url)) {
      throw new PonderEnvRefusalError(
        "duplicate_rpc_url",
        key,
        `duplicate_rpc_url: ${key} lists ${url} more than once`,
      );
    }
    seen.add(url);
  }
  return parts;
}

export type PonderIndexingChain = { id: number };

export type PonderChainConfig = {
  id: number;
  rpc: string | string[];
  ethGetLogsBlockRange?: number;
};

export type PonderIndexingConfig = {
  chains: Record<string, PonderIndexingChain>;
  addresses: PonderAddressBundle;
  ethereumSepoliaAddresses: PonderAddressBundle | null;
  localAddresses: PonderAddressBundle | null;
  localOnly: boolean;
  optionalAddresses: {
    FixedPriceConsignment: `0x${string}` | undefined;
    AscendingConsignment: `0x${string}` | undefined;
    KarPassportBridgeGateway: `0x${string}` | undefined;
  };
  contractEntry: (
    hubAddress: `0x${string}`,
    contract: ContractBlockKey,
    opts?: {
      ethereumSepoliaAddress?: `0x${string}`;
      localAddress?: `0x${string}`;
    },
  ) =>
    | {
        chain: "localhost" | "baseSepolia";
        address: `0x${string}`;
        startBlock: number;
      }
    | {
        chain: Record<string, { address: `0x${string}`; startBlock: number }>;
      };
};

/**
 * Indexing assembly only: chain names/ids, addresses, start blocks, contracts.
 * Commercial chains come from COMMERCIAL_ACTIVE alone (ADR 0016 §a); local mode
 * (`PONDER_ENABLE_LOCAL=1`) adds the localhost chain and changes nothing on
 * commercial chains. No RPC URLs or eth_getLogs windows — those are transport
 * and outside build_id.
 */
export function buildPonderIndexingConfig(): PonderIndexingConfig {
  const enableLocal = process.env.PONDER_ENABLE_LOCAL === "1";
  // Local-dev-only: index just the Hardhat chain (skip commercial backfill).
  // Used by the E2E harness so `/ready` does not wait on a public RPC.
  const localOnly = enableLocal && process.env.PONDER_LOCAL_ONLY === "1";
  const sepoliaAddresses = ponderAddressesFromStack(
    resolveCommercialStack(SEPOLIA_CHAIN_ID),
  );
  const localAddresses = enableLocal ? ponderLocalAddresses() : null;
  const localStart = enableLocal ? resolveLocalStartBlock() : 0;

  const ethereumSepoliaAddresses = localOnly
    ? null
    : ponderAddressesFromStack(resolveCommercialStack(SPOKE_CHAIN_ID));

  const chains: Record<string, PonderIndexingChain> = {};

  if (!localOnly) {
    chains.baseSepolia = { id: SEPOLIA_CHAIN_ID };
    chains.ethereumSepolia = { id: SPOKE_CHAIN_ID };
  }

  if (enableLocal && localAddresses) {
    chains.localhost = { id: LOCALHOST_CHAIN_ID };
  }

  /**
   * Multi-network contract entry — addresses and start blocks are per-chain
   * from the registry (SPEC §I.12.12). Never address-only.
   */
  function contractEntry(
    hubAddress: `0x${string}`,
    contract: ContractBlockKey,
    opts?: {
      ethereumSepoliaAddress?: `0x${string}`;
      localAddress?: `0x${string}`;
    },
  ) {
    const ethAddress = opts?.ethereumSepoliaAddress;
    const localAddress = opts?.localAddress;

    if (localOnly && localAddress) {
      return {
        chain: "localhost" as const,
        address: localAddress,
        startBlock: localStart,
      };
    }

    const hubStart = commercialContractStartBlock(SEPOLIA_CHAIN_ID, contract);
    const commercial: Record<
      string,
      { address: `0x${string}`; startBlock: number }
    > = {
      baseSepolia: { address: hubAddress, startBlock: hubStart },
    };

    if (ethAddress && ethereumSepoliaAddresses) {
      commercial.ethereumSepolia = {
        address: ethAddress,
        startBlock: commercialContractStartBlock(SPOKE_CHAIN_ID, contract),
      };
    }

    if (enableLocal && localAddress) {
      commercial.localhost = { address: localAddress, startBlock: localStart };
    }

    const keys = Object.keys(commercial);
    if (keys.length === 1 && keys[0] === "baseSepolia") {
      return {
        chain: "baseSepolia" as const,
        address: hubAddress,
        startBlock: hubStart,
      };
    }

    return { chain: commercial };
  }

  const optionalAddresses = {
    FixedPriceConsignment: optionalContractAddress(
      localOnly,
      sepoliaAddresses.fixedPriceConsignment,
      localAddresses?.fixedPriceConsignment,
    ),
    AscendingConsignment: optionalContractAddress(
      localOnly,
      sepoliaAddresses.ascendingConsignment,
      localAddresses?.ascendingConsignment,
    ),
    KarPassportBridgeGateway: optionalContractAddress(
      localOnly,
      sepoliaAddresses.bridgeGateway,
      localAddresses?.bridgeGateway,
    ),
  } as const;

  return {
    chains,
    addresses: sepoliaAddresses,
    ethereumSepoliaAddresses,
    localAddresses,
    localOnly,
    optionalAddresses,
    contractEntry,
  };
}

/**
 * Full Ponder runtime: indexing + transport (rpc list, getLogs window) + database.
 */
export function buildPonderRuntime() {
  const indexing = buildPonderIndexingConfig();
  const enableLocal = process.env.PONDER_ENABLE_LOCAL === "1";

  const chains: Record<string, PonderChainConfig> = {};

  for (const [name, chain] of Object.entries(indexing.chains)) {
    if (name === "localhost") {
      chains.localhost = {
        id: chain.id,
        rpc: process.env.PONDER_RPC_URL_31337 ?? "http://127.0.0.1:8545",
      };
      continue;
    }
    chains[name] = {
      id: chain.id,
      rpc: resolveCommercialRpcUrls(chain.id),
      ethGetLogsBlockRange: resolveGetLogsBlockRange(chain.id),
    };
  }

  return {
    ...indexing,
    chains,
    database: resolvePonderDatabase(enableLocal),
  };
}

/**
 * Registry contract addresses indexed by Ponder for a commercial chain
 * (required trio + present optionals). Used by the RPC capability probe.
 */
export function commercialPonderRegistryAddresses(
  chainId: number,
): `0x${string}`[] {
  if (chainId !== SEPOLIA_CHAIN_ID && chainId !== SPOKE_CHAIN_ID) {
    throw new Error(`Unsupported commercial Ponder chain id: ${chainId}`);
  }
  const bundle = ponderAddressesFromStack(resolveCommercialStack(chainId));
  const addresses: `0x${string}`[] = [
    bundle.karPassport,
    bundle.karProPass,
    bundle.karProStaking,
  ];
  if (bundle.bridgeGateway) addresses.push(bundle.bridgeGateway);
  if (bundle.fixedPriceConsignment) {
    addresses.push(bundle.fixedPriceConsignment);
  }
  if (bundle.ascendingConsignment) {
    addresses.push(bundle.ascendingConsignment);
  }
  return addresses;
}

/**
 * Optional-contract address for createConfig: local-only never falls back to a
 * commercial address (localhost chain has no baseSepolia).
 */
export function optionalContractAddress(
  localOnly: boolean,
  commercial: `0x${string}` | undefined,
  local: `0x${string}` | undefined,
): `0x${string}` | undefined {
  if (localOnly) return local;
  return commercial ?? local;
}
