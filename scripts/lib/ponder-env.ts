import type { DeploymentBlocks } from "./load-deployment.js";
import {
  LOCAL_CHAIN_ID,
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
  if (chainId === LOCAL_CHAIN_ID) {
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
  if (chainId === LOCAL_CHAIN_ID) {
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

const ETHEREUM_SEPOLIA_PUBLIC_RPC =
  "https://ethereum-sepolia-rpc.publicnode.com" as const;

export function buildPonderRuntime() {
  const enableLocal = process.env.PONDER_ENABLE_LOCAL === "1";
  // Local-dev-only: index just the Hardhat chain (skip commercial backfill).
  // Used by the E2E harness so `/ready` does not wait on a public RPC.
  const localOnly = enableLocal && process.env.PONDER_LOCAL_ONLY === "1";
  const sepoliaAddresses = ponderSepoliaAddresses();
  const localAddresses = enableLocal ? ponderLocalAddresses() : null;

  const ethereumSepolia = localOnly ? null : loadEthereumSepoliaBundle();

  const chains: Record<string, { id: number; rpc: string; maxRequestsPerSecond?: number }> = {};

  if (!localOnly) {
    chains.baseSepolia = {
      id: SEPOLIA_CHAIN_ID,
      rpc: process.env.PONDER_RPC_URL_84532 ?? "https://base-sepolia-rpc.publicnode.com",
      maxRequestsPerSecond: 10,
    };
    chains.ethereumSepolia = {
      id: SPOKE_CHAIN_ID,
      rpc: process.env.PONDER_RPC_URL_11155111 ?? ETHEREUM_SEPOLIA_PUBLIC_RPC,
      maxRequestsPerSecond: 10,
    };
  }

  if (enableLocal && localAddresses) {
    chains.localhost = {
      id: LOCAL_CHAIN_ID,
      rpc: process.env.PONDER_RPC_URL_31337 ?? "http://127.0.0.1:8545",
      maxRequestsPerSecond: 20,
    };
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
        startBlock: resolveContractStartBlock(LOCAL_CHAIN_ID, contract),
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
        startBlock: resolveContractStartBlock(LOCAL_CHAIN_ID, contract),
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

  return {
    chains,
    addresses: sepoliaAddresses,
    ethereumSepoliaAddresses: ethereumSepolia?.addresses ?? null,
    localAddresses,
    contractEntry,
    database: resolvePonderDatabase(enableLocal),
  };
}
