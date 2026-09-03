import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
    npmFilesToBuild: [
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol",
      "@openzeppelin/contracts/governance/TimelockController.sol",
    ],
  },
  networks: {
    // Tests use Hardhat 3's implicit `default` edr network (not hardhatMain).
    default: {
      type: "edr-simulated",
      chainType: "l1",
      // EndpointV2Mock (LZ test-devtools) exceeds EIP-170; local tests only.
      allowUnlimitedContractSize: true,
    },
    hardhatMain: {
      type: "edr-simulated",
      chainType: "l1",
      allowUnlimitedContractSize: true,
    },
    /** C1.2 dual-chain gateway harness — hub (Base Sepolia chainId). */
    gatewayHub: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 84532,
      allowUnlimitedContractSize: true,
    },
    /** C1.2 dual-chain gateway harness — spoke (Ethereum Sepolia chainId). */
    gatewaySpoke: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 11155111,
      allowUnlimitedContractSize: true,
    },
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      // Use Hardhat node default funded accounts (do not override with DEPLOYER_PRIVATE_KEY).
    },
    baseSepolia: {
      type: "http",
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      chainId: 84532,
      chainType: "op",
      ...(deployerKey ? { accounts: [deployerKey] } : {}),
    },
    ethereumSepolia: {
      type: "http",
      url:
        process.env.ETH_SEPOLIA_RPC_URL ??
        "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      chainType: "l1",
      ...(deployerKey ? { accounts: [deployerKey] } : {}),
    },
  },
  chainDescriptors: {
    84532: {
      name: "Base Sepolia",
      chainType: "op",
      blockExplorers: {
        // Tip uses the Basescan product name as the explorer key. Hardhat's
        // BlockExplorersUserConfig only lists etherscan|blockscout; keep the
        // runtime key and assert the published shape at the config boundary.
        basescan: {
          name: "BaseScan",
          url: "https://sepolia.basescan.org",
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      } as import("hardhat/types/config").BlockExplorersUserConfig,

    },
    11155111: {
      name: "Ethereum Sepolia",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Etherscan",
          url: "https://sepolia.etherscan.io",
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
  },
  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY ?? "",
    },
  },
};

export default config;
