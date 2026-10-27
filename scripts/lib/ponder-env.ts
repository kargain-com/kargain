import { LOCALHOST_CHAIN_ID } from "../../lib/web3/local-chain.js";
import type { DeploymentBlocks } from "./load-deployment.js";
import {
  ponderCommercialAddresses,
  ponderLocalAddresses,
  ponderSepoliaAddresses,
  sepoliaBlocksForPonder,
  sepoliaIndexFromBlock,
  SEPOLIA_CHAIN_ID,
  SPOKE_CHAIN_ID,
  type PonderAddressBundle,
} from "./load-deployment.js";

export type ContractBlockKey = keyof DeploymentBlocks;

function parseStartBlock(raw: string | undefined): number | "latest" | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "latest") return "latest";
  const block = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(block) || block < 0) {
    throw new Error(`Invalid start block value: ${raw}`);
  }
  return block;
}

type CommercialChainBundle = {
  addresses: PonderAddressBundle;
  blocks: DeploymentBlocks;
  indexFromBlock: number;
};

let ethereumSepoliaBundle: CommercialChainBundle | null | undefined;

function loadEthereumSepoliaBundle(): CommercialChainBundle {
  if (ethereumSepoliaBundle !== undefined && ethereumSepoliaBundle !== null) {
    return ethereumSepoliaBundle;
  }
  const loaded = ponderCommercialAddresses(SPOKE_CHAIN_ID);
  ethereumSepoliaBundle = loaded;
  return loaded;
}

/** Per-chain start block — decouples commercial chains from localhost. */
export function resolveChainStartBlock(chainId: number): number | "latest" {
  if (chainId === LOCALHOST_CHAIN_ID) {
    const parsed = parseStartBlock(process.env.PONDER_START_BLOCK_31337);
    return parsed === "latest" || parsed === undefined ? 0 : parsed;
  }

  if (chainId === SEPOLIA_CHAIN_ID) {
    const specific = parseStartBlock(process.env.PONDER_START_BLOCK_84532);
    if (specific !== undefined && specific !== "latest") return specific;

    const legacy = parseStartBlock(process.env.PONDER_START_BLOCK);
    if (legacy !== undefined && legacy !== "latest") return legacy;

    return sepoliaIndexFromBlock();
  }

  if (chainId === SPOKE_CHAIN_ID) {
    const specific = parseStartBlock(process.env.PONDER_START_BLOCK_11155111);
    if (specific !== undefined && specific !== "latest") return specific;
    return loadEthereumSepoliaBundle().indexFromBlock;
  }

  throw new Error(`Unsupported Ponder chain id: ${chainId}`);
}

function resolveCommercialContractStartBlock(
  blocks: DeploymentBlocks,
  indexFrom: number,
  contract: ContractBlockKey,
  chainStart: number | "latest",
): number | "latest" {
  if (chainStart === "latest") return "latest";

  const contractBlock = blocks[contract];
  if (contractBlock !== undefined) return contractBlock;

  if (indexFrom !== undefined) return Math.max(chainStart, indexFrom);

  return chainStart;
}

export function resolveContractStartBlock(
  chainId: number,
  contract: ContractBlockKey,
): number | "latest" {
  const chainStart = resolveChainStartBlock(chainId);
  if (chainId === LOCALHOST_CHAIN_ID) {
    return chainStart === "latest" ? 0 : chainStart;
  }
  if (chainId === SEPOLIA_CHAIN_ID) {
    return resolveCommercialContractStartBlock(
      sepoliaBlocksForPonder(),
      sepoliaIndexFromBlock(),
      contract,
      chainStart,
    );
  }
  if (chainId === SPOKE_CHAIN_ID) {
    const bundle = loadEthereumSepoliaBundle();
    return resolveCommercialContractStartBlock(
      bundle.blocks,
      bundle.indexFromBlock,
      contract,
      chainStart,
    );
  }
  throw new Error(`Unsupported Ponder chain id: ${chainId}`);
}

type PonderDatabaseConfig =
  | { kind: "pglite"; directory?: string }
  | { kind: "postgres"; connectionString?: string };

/**
 * Local dev / E2E use embedded PGlite when no Postgres connection string is set,
 * so Docker Postgres is not required. Production always provides DATABASE_URL
 * (docker-compose) and stays on Postgres.
 */
function resolvePonderDatabase(enableLocal: boolean): PonderDatabaseConfig {
  const connectionString =
    process.env.DATABASE_URL ??
    process.env.PONDER_DATABASE_URL ??
    process.env.DATABASE_PRIVATE_URL;

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

/**
 * Required eth_getLogs window for a commercial chain.
 * Env: `PONDER_GETLOGS_BLOCK_RANGE_<chainId>` — positive integer, no default.
 */
export function resolveGetLogsBlockRange(
  chainId: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const key = `PONDER_GETLOGS_BLOCK_RANGE_${chainId}`;
  const raw = env[key];
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error(
      `missing_getlogs_block_range: set ${key} to a positive integer (no default)`,
    );
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `missing_getlogs_block_range: set ${key} to a positive integer (no default)`,
    );
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
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
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const key = `PONDER_RPC_URLS_${chainId}`;
  const raw = env[key];
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error(
      `missing_rpc_urls: set ${key} to a comma-separated list of https URLs (no default)`,
    );
  }
  const parts = trimmed
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new Error(
      `empty_rpc_urls: set ${key} to a comma-separated list of https URLs (no default)`,
    );
  }
  const seen = new Set<string>();
  for (const url of parts) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`invalid_rpc_url: ${key} entry is not a valid URL: ${url}`);
    }
    if (parsed.protocol !== "https:") {
      throw new Error(
        `invalid_rpc_url: ${key} entry must be https: ${url}`,
      );
    }
    if (seen.has(url)) {
      throw new Error(`duplicate_rpc_url: ${key} lists ${url} more than once`);
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
        startBlock: number | "latest";
      }
    | {
        chain: Record<
          string,
          { address: `0x${string}`; startBlock: number | "latest" }
        >;
      };
};

/**
 * Indexing assembly only: chain names/ids, addresses, start blocks, contracts.
 * No RPC URLs or eth_getLogs windows — those are transport and outside build_id.
 */
export function buildPonderIndexingConfig(): PonderIndexingConfig {
  const enableLocal = process.env.PONDER_ENABLE_LOCAL === "1";
  // Local-dev-only: index just the Hardhat chain (skip commercial backfill).
  // Used by the E2E harness so `/ready` does not wait on a public RPC.
  const localOnly = enableLocal && process.env.PONDER_LOCAL_ONLY === "1";
  const sepoliaAddresses = ponderSepoliaAddresses();
  const localAddresses = enableLocal ? ponderLocalAddresses() : null;

  const ethereumSepolia = localOnly ? null : loadEthereumSepoliaBundle();

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
   * from commercial manifests (SPEC §I.12.12). Never address-only.
   */
  function contractEntry(
    hubAddress: `0x${string}`,
    contract: ContractBlockKey,
    opts?: {
      ethereumSepoliaAddress?: `0x${string}`;
      localAddress?: `0x${string}`;
    },
  ) {
    const hubStart = resolveContractStartBlock(SEPOLIA_CHAIN_ID, contract);
    const ethAddress = opts?.ethereumSepoliaAddress;
    const localAddress = opts?.localAddress;

    if (localOnly && localAddress) {
      return {
        chain: "localhost" as const,
        address: localAddress,
        startBlock: resolveContractStartBlock(LOCALHOST_CHAIN_ID, contract),
      };
    }

    const commercial: Record<
      string,
      { address: `0x${string}`; startBlock: number | "latest" }
    > = {
      baseSepolia: { address: hubAddress, startBlock: hubStart },
    };

    if (ethAddress && ethereumSepolia) {
      commercial.ethereumSepolia = {
        address: ethAddress,
        startBlock: resolveContractStartBlock(SPOKE_CHAIN_ID, contract),
      };
    }

    if (enableLocal && localAddress) {
      commercial.localhost = {
        address: localAddress,
        startBlock: resolveContractStartBlock(LOCALHOST_CHAIN_ID, contract),
      };
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
    ethereumSepoliaAddresses: ethereumSepolia?.addresses ?? null,
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
  const bundle =
    chainId === SEPOLIA_CHAIN_ID
      ? ponderSepoliaAddresses()
      : chainId === SPOKE_CHAIN_ID
        ? loadEthereumSepoliaBundle().addresses
        : null;
  if (!bundle) {
    throw new Error(`Unsupported commercial Ponder chain id: ${chainId}`);
  }
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
