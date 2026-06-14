import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import hardhat from "hardhat";

import { DEPLOYMENT_PATH, LOCAL_CHAIN_ID } from "./lib/load-deployment.js";
import { deployEscrowStack, stackToDeploymentAddresses } from "./lib/local-stack.js";

async function main() {
  const connection = await hardhat.network.connect();
  try {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    if (chainId !== LOCAL_CHAIN_ID) {
      throw new Error(
        `Expected chain ${LOCAL_CHAIN_ID}, got ${chainId}. Run with: pnpm deploy:local (hardhat node on :8545)`,
      );
    }

    console.log("Deploying Model X stack to localhost…");
    const stack = await deployEscrowStack(viem);
    const deployment = stackToDeploymentAddresses(stack, LOCAL_CHAIN_ID);

    mkdirSync(dirname(DEPLOYMENT_PATH), { recursive: true });
    writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(deployment, null, 2)}\n`);

    console.log("Wrote", DEPLOYMENT_PATH);
    console.log(JSON.stringify(deployment, null, 2));
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
