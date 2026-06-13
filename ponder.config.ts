import { createConfig } from "ponder";
import { http } from "viem";
import {
  KarPassportAbi,
  KarProPassAbi,
  KarProStakingAbi,
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
        process.env.PONDER_RPC_URL_84532 ??
        "https://base-sepolia.publicnode.com",
      maxRequestsPerSecond: 10,
    },
  },
  contracts: {
    KarPassport: {
      chain: "baseSepolia",
      abi: KarPassportAbi,
      address: "0x76b66eA782429f796a16671578fa5E9f941EeB6a",
      startBlock: "latest",
    },
    KarProPass: {
      chain: "baseSepolia",
      abi: KarProPassAbi,
      address: "0x7d2E1BAa3Cb92F5647005A666389150aF9875eA1",
      startBlock: "latest",
    },
    KarProStaking: {
      chain: "baseSepolia",
      abi: KarProStakingAbi,
      address: "0xA67aF973385E82f690e2a5170e42A620Bc82b5EE",
      startBlock: "latest",
    },
    MarketplaceEscrow: {
      chain: "baseSepolia",
      abi: MarketplaceEscrowAbi,
      address: "0xc6C050ada9F744419495E92F603bC50062Bab6e6",
      startBlock: "latest",
    },
  },
});
