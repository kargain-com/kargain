import type { DeploymentBlocks } from "./load-deployment.js";
import {
  LOCAL_CHAIN_ID,
  ponderLocalAddresses,
  ponderSepoliaAddresses,
  sepoliaBlocksForPonder,
  sepoliaIndexFromBlock,
  SEPOLIA_CHAIN_ID,
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

/** Per-chain start block — decouples Sepolia from localhost. */
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

  throw new Error(`Unsupported Ponder chain id: ${chainId}`);
}

function resolveSepoliaContractStartBlock(
  contract: ContractBlockKey,
  chainStart: number | "latest",
): number | "latest" {
  if (chainStart === "latest") return "latest";

  const blocks = sepoliaBlocksForPonder();
  const contractBlock = blocks[contract];
  if (contractBlock !== undefined) return contractBlock;

  const indexFrom = sepoliaIndexFromBlock();
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
  return resolveSepoliaContractStartBlock(contract, chainStart);
}

export function buildPonderRuntime() {
  const enableLocal = process.env.PONDER_ENABLE_LOCAL === "1";
  const sepoliaAddresses = ponderSepoliaAddresses();
  const localAddresses = enableLocal ? ponderLocalAddresses() : null;

  const chains: Record<string, { id: number; rpc: string; maxRequestsPerSecond?: number }> = {
    baseSepolia: {
      id: SEPOLIA_CHAIN_ID,
      rpc: process.env.PONDER_RPC_URL_84532 ?? "https://sepolia.base.org",
      maxRequestsPerSecond: 10,
    },
  };

  if (enableLocal && localAddresses) {
    chains.localhost = {
      id: LOCAL_CHAIN_ID,
      rpc: process.env.PONDER_RPC_URL_31337 ?? "http://127.0.0.1:8545",
      maxRequestsPerSecond: 20,
    };
  }

  function contractEntry(
    sepoliaAddress: `0x${string}`,
    contract: ContractBlockKey,
    localAddress?: `0x${string}`,
  ) {
    const sepoliaStart = resolveContractStartBlock(SEPOLIA_CHAIN_ID, contract);
    if (enableLocal && localAddress) {
      return {
        chain: {
          baseSepolia: { address: sepoliaAddress, startBlock: sepoliaStart },
          localhost: {
            address: localAddress,
            startBlock: resolveContractStartBlock(LOCAL_CHAIN_ID, contract),
          },
        },
      };
    }
    return {
      chain: "baseSepolia" as const,
      address: sepoliaAddress,
      startBlock: sepoliaStart,
    };
  }

  return {
    chains,
    addresses: sepoliaAddresses,
    localAddresses,
    contractEntry,
    database: {
      kind: "postgres" as const,
      connectionString:
        process.env.DATABASE_URL ??
        process.env.PONDER_DATABASE_URL ??
        process.env.DATABASE_PRIVATE_URL,
    },
  };
}
