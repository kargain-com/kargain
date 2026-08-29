import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import hardhat from "hardhat";
import { getAddress } from "viem";

import { DEPLOYMENT_PATH, LOCAL_CHAIN_ID } from "./lib/load-deployment.js";
import {
  DISPUTE_DEPOSIT,
  deployAscendingConsignment,
  deployCommerceBaseStack,
  deployFixedPriceConsignment,
  stackToDeploymentAddresses,
} from "./lib/local-stack.js";
import {
  ASCENDING_CHALLENGE_WINDOW,
  AUCTION_PLATFORM_FEE_BPS,
  MARKETPLACE_FEE_BPS,
} from "./lib/verify-constructor-args.js";
import { assertSourcesRegistered } from "./lib/nuclear-ordering.js";

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

    console.log("Deploying commerce base stack to localhost…");
    const stack = await deployCommerceBaseStack(viem);

    const guardian = stack.admin.account.address;
    const deployer = getAddress(stack.admin.account.address);
    const timelockOwner = getAddress(stack.timelock.address);

    // Toggleable sink for mode platform / Ascending forfeit — E2E forces ClaimRecorded.
    console.log("Deploying commerce payout sink (RevertingRecipient)…");
    const sink = await viem.deployContract("RevertingRecipient", []);
    await sink.write.setAcceptEth([true]);
    const modePlatform = getAddress(sink.address);

    console.log("Deploying FixedPriceConsignment (owner=deployer)…");
    const fixedPrice = await deployFixedPriceConsignment(viem, {
      passport: stack.passport.address,
      platformRecipient: modePlatform,
      feeBps: MARKETPLACE_FEE_BPS,
      nativeUsdFeed: stack.nativeFeed.address,
      nativeUsdStalenessTolerance: 3600,
      owner: deployer,
      guardian,
    });

    console.log("Deploying AscendingConsignment (owner=deployer)…");
    const ascending = await deployAscendingConsignment(viem, {
      passport: stack.passport.address,
      karProStaking: stack.staking.address,
      platformRecipient: modePlatform,
      feeBps: AUCTION_PLATFORM_FEE_BPS,
      forfeitRecipient: modePlatform,
      challengeBond: DISPUTE_DEPOSIT,
      challengeWindow: ASCENDING_CHALLENGE_WINDOW,
      owner: deployer,
      guardian,
    });

    console.log("Registering encumbrance sources…");
    await stack.passport.write.addEncumbranceSource([fixedPrice.proxy.address], {
      account: stack.admin.account,
    });
    await stack.passport.write.addEncumbranceSource([ascending.proxy.address], {
      account: stack.admin.account,
    });
    assertSourcesRegistered({
      fixedPriceRegistered: Boolean(
        await stack.passport.read.isEncumbranceSource([fixedPrice.proxy.address]),
      ),
      ascendingRegistered: Boolean(
        await stack.passport.read.isEncumbranceSource([ascending.proxy.address]),
      ),
      fixedPrice: fixedPrice.proxy.address,
      ascending: ascending.proxy.address,
    });
    console.log("Encumbrance sources registered.");

    console.log("Admitting USDC on both modes…");
    const usdcUsdFeed = await viem.deployContract("MockV3Aggregator", [8, 10n ** 8n]);
    await fixedPrice.mode.write.approvePaymentToken(
      [stack.usdc.address, usdcUsdFeed.address, 3600],
      { account: stack.admin.account },
    );
    await ascending.mode.write.approvePaymentToken([stack.usdc.address], {
      account: stack.admin.account,
    });

    console.log("Handing mode ownership to Timelock…");
    await fixedPrice.mode.write.transferOwnership([timelockOwner], {
      account: stack.admin.account,
    });
    await ascending.mode.write.transferOwnership([timelockOwner], {
      account: stack.admin.account,
    });
    console.log("Mode ownership handed off (manifest write refused without register).");

    const deployment = stackToDeploymentAddresses(
      {
        ...stack,
        fixedPriceConsignment: getAddress(fixedPrice.proxy.address),
        fixedPriceConsignmentImpl: getAddress(fixedPrice.impl.address),
        ascendingHoldLib: getAddress(ascending.libraries.AscendingHoldLib),
        ascendingOpenLib: getAddress(ascending.libraries.AscendingOpenLib),
        ascendingConsignment: getAddress(ascending.proxy.address),
        ascendingConsignmentImpl: getAddress(ascending.impl.address),
        commercePayoutSink: modePlatform,
      },
      LOCAL_CHAIN_ID,
    );

    mkdirSync(dirname(DEPLOYMENT_PATH()), { recursive: true });
    writeFileSync(DEPLOYMENT_PATH(), `${JSON.stringify(deployment, null, 2)}\n`);

    console.log("Wrote", DEPLOYMENT_PATH());
    console.log(JSON.stringify(deployment, null, 2));
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
