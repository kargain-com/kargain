import { createConfig } from "ponder";
import { http } from "viem";
import {
  KarPassportAbi,
  KarProPassAbi,
  MarketplaceEscrowAbi,
} from "./lib/contracts/abis.generated";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString:
      process.env.DATABASE_URL ??
      process.env.PONDER_DATABASE_URL ??
      process.env.DATABASE_PRIVATE_URL,
  },
  chains: {
    baseSepolia: {
      id: 84532,
      rpc:
        process.env.PONDER_RPC_URL_84532 ?? "https://sepolia.base.org",
      maxRequestsPerSecond: 14,
      ethGetLogsBlockRange: 1000,
    },
  },
  contracts: {
    KarPassport: {
      chain: "baseSepolia",
      abi: KarPassportAbi,
      address: "0xe3568875db58be8e0ba6f44bf2a1178bb6777c29",
      startBlock: 42781255,
    },
    KarProPass: {
      chain: "baseSepolia",
      abi: KarProPassAbi,
      address: "0x13167606ea83a213ab9e10255f09c5389e7910de",
      startBlock: 42781255,
    },
    MarketplaceEscrow: {
      chain: "baseSepolia",
      abi: MarketplaceEscrowAbi,
      address: "0x816855Ab573AfE959eBd5a5dc3A263288d194864",
      startBlock: 42781255,
    },
  },
});
