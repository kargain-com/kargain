import hardhat from "hardhat";
import { encodeFunctionData, getAddress, type Hash } from "viem";
import { MarketplaceEscrowAbi } from "../lib/contracts/abis.generated.js";

const CHAIN_ID = 84532;

const PLATFORM_RECIPIENT = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const NATIVE_USD_FEED = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1" as const;
const EUR_USD_FEED = "0xb49f677943BC038e9857d61E7d053CaA2C1734C1" as const;
const FEE_BPS = 10n;
const PRO_FEE_BPS = 0n;
const MAX_FEED_STALENESS = 3600n;

async function waitForBytecode(
  viem: Awaited<ReturnType<typeof hardhat.network.connect>>["viem"],
  address: `0x${string}`,
  label: string,
) {
  const publicClient = await viem.getPublicClient();
  for (let attempt = 1; attempt <= 30; attempt++) {
    const bytecode = await publicClient.getBytecode({ address });
    if (bytecode && bytecode !== "0x") return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${label} bytecode not visible on RPC after 60s (${address})`);
}

async function deployStep(
  viem: Awaited<ReturnType<typeof hardhat.network.connect>>["viem"],
  label: string,
  contractName: string,
  constructorArgs: readonly unknown[] = [],
) {
  const { contract, deploymentTransaction } = await viem.sendDeploymentTransaction(
    contractName,
    constructorArgs,
  );
  const publicClient = await viem.getPublicClient();
  await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction.hash });
  console.log(`${label} tx: ${deploymentTransaction.hash}`);
  return { contract, address: contract.address, txHash: deploymentTransaction.hash };
}

async function main() {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.error(
      "DEPLOYER_PRIVATE_KEY not set in .env.local\n" +
        "Add your private key and run again:\n" +
        "DEPLOYER_PRIVATE_KEY=0x... pnpm deploy:base-sepolia",
    );
    process.exit(1);
  }

  const connection = await hardhat.network.connect();
  const { viem } = connection;

  try {
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    if (chainId !== CHAIN_ID) {
      throw new Error(`Expected chain ${CHAIN_ID}, got ${chainId}`);
    }

    const [deployer] = await viem.getWalletClients();
    const deployerAddress = getAddress(deployer.account.address);

    console.log(`Deployer: ${deployerAddress}`);
    console.log(`Chain:    ${chainId}`);
    console.log("");

    const karProPass = await deployStep(viem, "KarProPass", "KarProPass", [deployerAddress]);
    const karPassport = await deployStep(viem, "KarPassport", "KarPassport", [karProPass.address]);
    const marketplaceImpl = await deployStep(viem, "MarketplaceEscrow impl", "MarketplaceEscrow", [
      karPassport.address,
      USDC,
      NATIVE_USD_FEED,
      EUR_USD_FEED,
      karProPass.address,
      PLATFORM_RECIPIENT,
      FEE_BPS,
      PRO_FEE_BPS,
      MAX_FEED_STALENESS,
    ]);
    await waitForBytecode(viem, marketplaceImpl.address, "MarketplaceEscrow impl");

    // OZ 5.6 ERC1967Proxy reverts ERC1967ProxyUninitialized when _data is empty.
    const initData = encodeFunctionData({
      abi: MarketplaceEscrowAbi,
      functionName: "initialize",
      args: [deployerAddress],
    });

    const proxy = await deployStep(viem, "MarketplaceEscrow proxy", "ERC1967Proxy", [
      marketplaceImpl.address,
      initData,
    ]);

    const marketplace = await viem.getContractAt("MarketplaceEscrow", proxy.address);
    const initHash = proxy.txHash;
    console.log(
      `MarketplaceEscrow initialize tx: ${initHash} (delegatecall in proxy constructor)`,
    );

    const upgradeAuthority = (await marketplace.read.upgradeAuthority([])) as `0x${string}`;

    console.log("");
    console.log("Deployment complete:");
    console.log(`  KarProPass:              ${karProPass.address}`);
    console.log(`  KarPassport:             ${karPassport.address}`);
    console.log(`  MarketplaceEscrow impl:  ${marketplaceImpl.address}`);
    console.log(`  MarketplaceEscrow proxy: ${proxy.address}`);
    console.log(`  upgradeAuthority:        ${upgradeAuthority}`);
    console.log(`  Chain:                   ${chainId}`);
    console.log(`  Deployer:                ${deployerAddress}`);

    return {
      karProPass: karProPass.address,
      karPassport: karPassport.address,
      marketplaceImpl: marketplaceImpl.address,
      marketplaceProxy: proxy.address,
      upgradeAuthority,
      deployer: deployerAddress,
      chainId,
      txHashes: {
        karProPass: karProPass.txHash,
        karPassport: karPassport.txHash,
        marketplaceImpl: marketplaceImpl.txHash,
        marketplaceProxy: proxy.txHash,
        initialize: initHash as Hash,
      },
    };
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
