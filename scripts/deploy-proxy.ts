// DEPRECATED: use pnpm deploy:v2. Do not run directly.
import hardhat from "hardhat";
import { encodeFunctionData, getAddress } from "viem";
import { MarketplaceEscrowAbi } from "../lib/contracts/abis.generated.js";

const CHAIN_ID = 84532;
const IMPL_ADDRESS = "0x96dc74bc1f2ecf8e2b474c2c97e13205ca924313" as const;

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

type ViemSuite = Awaited<ReturnType<typeof hardhat.network.connect>>["viem"];

async function waitForBytecode(
  viem: ViemSuite,
  address: `0x${string}`,
  timeoutMessage: string,
) {
  const publicClient = await viem.getPublicClient();
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const bytecode = await publicClient.getBytecode({ address });
    if (bytecode && bytecode !== "0x") return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.error(timeoutMessage);
  process.exit(1);
}

async function main() {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.error(
      "DEPLOYER_PRIVATE_KEY not set in .env.local\n" +
        "Add your private key and run again:\n" +
        "DEPLOYER_PRIVATE_KEY=0x... pnpm deploy:proxy",
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
    const implAddress = getAddress(IMPL_ADDRESS);

    console.log(`Deployer: ${deployerAddress}`);
    console.log(`Impl:     ${implAddress}`);
    console.log(`Chain:    ${chainId}`);
    console.log("");

    await waitForBytecode(viem, implAddress, "impl bytecode not found");

    // OZ 5.6 ERC1967Proxy reverts ERC1967ProxyUninitialized when _data is empty.
    // initialize must run via constructor delegatecall (same pattern as contract tests).
    const initData = encodeFunctionData({
      abi: MarketplaceEscrowAbi,
      functionName: "initialize",
      args: [deployerAddress],
    });

    const { contract: proxy, deploymentTransaction } = await viem.sendDeploymentTransaction(
      "ERC1967Proxy",
      [implAddress, initData],
    );
    await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction.hash });
    await waitForBytecode(viem, proxy.address, "proxy bytecode not found");

    const upgradeAuthority = getAddress(
      await publicClient.readContract({
        address: proxy.address,
        abi: MarketplaceEscrowAbi,
        functionName: "upgradeAuthority",
      }),
    );

    if (upgradeAuthority !== deployerAddress) {
      console.error(
        `upgradeAuthority mismatch: expected ${deployerAddress}, got ${upgradeAuthority}`,
      );
      process.exit(1);
    }

    console.log("");
    console.log("Proxy deployment complete:");
    console.log(`  MarketplaceEscrow proxy: ${proxy.address}`);
    console.log(`  upgradeAuthority:        ${upgradeAuthority}`);
    console.log(`  Tx hash (proxy deploy):  ${deploymentTransaction.hash}`);
    console.log(
      `  Tx hash (initialize):    ${deploymentTransaction.hash} (delegatecall in proxy constructor)`,
    );
    console.log(`  Chain: ${chainId}`);
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
