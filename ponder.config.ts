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
      address: "0xCfA1eAB89D6D1DE1244CF346D5a4F1E7343E9083",
      startBlock: "latest",
    },
    KarProPass: {
      chain: "baseSepolia",
      abi: KarProPassAbi,
      address: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
      startBlock: "latest",
    },
    KarProStaking: {
      chain: "baseSepolia",
      abi: KarProStakingAbi,
      address: "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31",
      startBlock: "latest",
    },
    MarketplaceEscrow: {
      chain: "baseSepolia",
      abi: MarketplaceEscrowAbi,
      address: "0xcD40C83CD57422C616e7e63F562B2e78C269Fb7F",
      startBlock: "latest",
    },
  },
});
