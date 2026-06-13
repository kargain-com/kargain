import hardhat from "hardhat";
import { encodeFunctionData, getAddress, type Hash } from "viem";
import { MarketplaceEscrowAbi } from "../lib/contracts/abis.generated.js";

const CHAIN_ID = 84532;
const BASESCAN = "https://sepolia.basescan.org";

const PLATFORM_RECIPIENT = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const NATIVE_USD_FEED = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1" as const;
const EUR_USD_FEED = "0xb49f677943BC038e9857d61E7d053CaA2C1734C1" as const;
const FEE_BPS = 10n;
const PRO_FEE_BPS = 0n;
const MAX_FEED_STALENESS = 3600n;

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

type ViemSuite = Awaited<ReturnType<typeof hardhat.network.connect>>["viem"];

async function waitForBytecode(viem: ViemSuite, address: `0x${string}`, label: string) {
  const publicClient = await viem.getPublicClient();
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const bytecode = await publicClient.getBytecode({ address });
    if (bytecode && bytecode !== "0x") return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`${label} bytecode not visible on RPC after 120s (${address})`);
}

async function waitForStakingLink(
  viem: ViemSuite,
  proPassAddress: `0x${string}`,
  expectedStaking: `0x${string}`,
) {
  const publicClient = await viem.getPublicClient();
  const proPassAbi = (await viem.getContractAt("KarProPass", proPassAddress)).abi;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const staking = getAddress(
      await publicClient.readContract({
        address: proPassAddress,
        abi: proPassAbi,
        functionName: "staking",
      }),
    );
    if (staking === getAddress(expectedStaking)) return staking;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `KarProPass.staking not updated after 120s (expected ${expectedStaking})`,
  );
}

async function deployStep(
  viem: ViemSuite,
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
  await waitForBytecode(viem, contract.address, label);
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

    const karProStaking = await deployStep(viem, "KarProStaking", "KarProStaking", [
      karProPass.address,
      deployerAddress,
    ]);

    const proPassContract = await viem.getContractAt("KarProPass", karProPass.address);
    const setStakingHash = await proPassContract.write.setStaking([karProStaking.address], {
      account: deployer.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: setStakingHash });
    console.log(`KarProPass.setStaking tx: ${setStakingHash}`);

    const linkedStaking = await waitForStakingLink(
      viem,
      karProPass.address,
      karProStaking.address,
    );

    const karPassport = await deployStep(viem, "KarPassport", "KarPassport", [karProStaking.address]);

    const marketplaceImpl = await deployStep(viem, "MarketplaceEscrow impl", "MarketplaceEscrow", [
      karPassport.address,
      USDC,
      NATIVE_USD_FEED,
      EUR_USD_FEED,
      karProStaking.address,
      PLATFORM_RECIPIENT,
      FEE_BPS,
      PRO_FEE_BPS,
      MAX_FEED_STALENESS,
    ]);

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
    const upgradeAuthority = getAddress(
      (await marketplace.read.upgradeAuthority([])) as `0x${string}`,
    );

    if (upgradeAuthority !== deployerAddress) {
      console.error(
        `upgradeAuthority mismatch: expected ${deployerAddress}, got ${upgradeAuthority}`,
      );
      process.exit(1);
    }

    console.log("");
    console.log("Deployment complete:");
    console.log(`  KarProPass:              ${karProPass.address}`);
    console.log(`  KarProStaking:           ${karProStaking.address}`);
    console.log(`  KarPassport:             ${karPassport.address}`);
    console.log(`  MarketplaceEscrow impl:  ${marketplaceImpl.address}`);
    console.log(`  MarketplaceEscrow proxy: ${proxy.address}`);
    console.log(`  upgradeAuthority:        ${upgradeAuthority}`);
    console.log(`  KarProPass.staking:      ${linkedStaking}`);
    console.log(`  Chain:                   ${chainId}`);
    console.log(`  Deployer:                ${deployerAddress}`);
    console.log("");
    console.log("Transaction hashes:");
    console.log(`  KarProPass:              ${karProPass.txHash}`);
    console.log(`  KarProStaking:           ${karProStaking.txHash}`);
    console.log(`  KarProPass.setStaking:   ${setStakingHash}`);
    console.log(`  KarPassport:             ${karPassport.txHash}`);
    console.log(`  MarketplaceEscrow impl:  ${marketplaceImpl.txHash}`);
    console.log(`  MarketplaceEscrow proxy: ${proxy.txHash}`);
    console.log(
      `  initialize:              ${proxy.txHash} (delegatecall in proxy constructor)`,
    );
    console.log("");
    console.log("Basescan:");
    console.log(`  KarProPass:              ${BASESCAN}/address/${karProPass.address}`);
    console.log(`  KarProStaking:           ${BASESCAN}/address/${karProStaking.address}`);
    console.log(`  KarPassport:             ${BASESCAN}/address/${karPassport.address}`);
    console.log(`  MarketplaceEscrow impl:  ${BASESCAN}/address/${marketplaceImpl.address}`);
    console.log(`  MarketplaceEscrow proxy: ${BASESCAN}/address/${proxy.address}`);

    return {
      karProPass: karProPass.address,
      karProStaking: karProStaking.address,
      karPassport: karPassport.address,
      marketplaceImpl: marketplaceImpl.address,
      marketplaceProxy: proxy.address,
      upgradeAuthority,
      karProPassStaking: linkedStaking,
      deployer: deployerAddress,
      chainId,
      txHashes: {
        karProPass: karProPass.txHash,
        karProStaking: karProStaking.txHash,
        setStaking: setStakingHash as Hash,
        karPassport: karPassport.txHash,
        marketplaceImpl: marketplaceImpl.txHash,
        marketplaceProxy: proxy.txHash,
        initialize: proxy.txHash as Hash,
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
