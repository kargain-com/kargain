/**
 * Nuclear full-stack deploy for commercial chains 84532 | 11155111.
 * Sequence: Timelock → KarProPass → Staking → Passport →
 * FixedPrice + Ascending (encumbrance sources) →
 * KarPassportBridgeGateway → setBridgeGateway → ownership handoff.
 *
 * Commerce cutover Phase 1: legacy escrow contracts are no longer part
 * of the nuclear deploy — modes only (SPEC §I.9.x, Nuclear #2 pending).
 *
 * `--dry-run` / `--compare`: print 84532 vs 11155111 parity table; no txs.
 * Live deploy requires DEPLOYER_PRIVATE_KEY, COMMERCE_GUARDIAN, and
 * `--network baseSepolia|ethereumSepolia`.
 */

import { encodeFunctionData, getAddress, type Hash, type PublicClient } from "viem";

import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
} from "../lib/contracts/abis.generated.js";
import {
  isCommercialChainId,
  verifyFeedBytecode,
} from "./lib/chainlink-feeds.js";
import {
  buildNuclearDeployPlan,
  formatNuclearParityTable,
} from "./lib/nuclear-deploy-plan.js";
import {
  assertNuclearEncumbranceOrdering,
  assertSourcesRegistered,
  CHECKLIST_ONCHAIN_OPEN_WITHOUT_REGISTER,
  NUCLEAR_TIMELOCK_OWNER_OPS,
} from "./lib/nuclear-ordering.js";
import {
  commercialDeploymentPath,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import { computeIndexFromBlock, writeDeploymentManifest } from "./lib/write-deployment.js";
import { CONTRACT_VERSIONS } from "./lib/contract-versions.js";
import {
  ASCENDING_ABANDONMENT_WINDOW,
  ASCENDING_CHALLENGE_BOND,
  ASCENDING_CHALLENGE_WINDOW,
  ASCENDING_EXTENSION_WINDOW,
  ASCENDING_MAX_DURATION,
  ASCENDING_MIN_DURATION,
  ASCENDING_MIN_INCREMENT_BPS,
  ASCENDING_PROTECTION_WINDOW,
  AUCTION_PLATFORM_FEE_BPS,
  MARKETPLACE_FEE_BPS,
  MARKETPLACE_MAX_FEED_STALENESS,
  resolveCommerceGuardian,
} from "./lib/verify-constructor-args.js";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

type ViemSuite = {
  sendDeploymentTransaction: (
    contractName: string,
    constructorArgs?: readonly unknown[],
  ) => Promise<{
    contract: { address: `0x${string}` };
    deploymentTransaction: { hash: Hash };
  }>;
  getPublicClient: () => Promise<PublicClient>;
  getWalletClients: () => Promise<
    Array<{ account: { address: `0x${string}` }; [key: string]: unknown }>
  >;
  getContractAt: (
    name: string,
    address: `0x${string}`,
  ) => Promise<{
    address: `0x${string}`;
    write: Record<string, (...args: unknown[]) => Promise<Hash>>;
    read: Record<string, (...args: unknown[]) => Promise<unknown>>;
  }>;
};

type DeployResult = {
  address: `0x${string}`;
  txHash: Hash;
  blockNumber: bigint;
};

function argvHas(...flags: string[]): boolean {
  return process.argv.some((arg) => flags.includes(arg));
}

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

function isTransientDeployError(message: string): boolean {
  return /TransactionNotFoundError|could not be found|NonceTooLow|nonce.*lower|in-flight transaction limit|replacement transaction underpriced|unexpected status code|rate limit|429|timeout|ECONNRESET|ETIMEDOUT/i.test(
    message,
  );
}

async function deployStep(
  viem: ViemSuite,
  label: string,
  contractName: string,
  constructorArgs: readonly unknown[] = [],
): Promise<DeployResult> {
  const publicClient = await viem.getPublicClient();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const { contract, deploymentTransaction } = await viem.sendDeploymentTransaction(
        contractName,
        constructorArgs,
      );
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: deploymentTransaction.hash,
        timeout: 180_000,
      });
      await waitForBytecode(viem, contract.address, label);
      console.log(`${label} tx: ${deploymentTransaction.hash} (block ${receipt.blockNumber})`);
      // Pace sequential deploys — EIP-7702 / public RPCs cap in-flight txs.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return {
        address: contract.address,
        txHash: deploymentTransaction.hash,
        blockNumber: receipt.blockNumber,
      };
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (isTransientDeployError(message) && attempt < 8) {
        const waitMs = Math.min(60_000, 5_000 * attempt);
        console.warn(
          `${label}: transient RPC/nonce on attempt ${attempt}, retrying in ${waitMs / 1000}s…`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/** Wait for a write tx hash with the same transient-error retries as deployStep. */
async function writeStep(
  viem: ViemSuite,
  label: string,
  send: () => Promise<Hash>,
): Promise<Hash> {
  const publicClient = await viem.getPublicClient();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const hash = await send();
      await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
      console.log(`  ${label} tx: ${hash}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return hash;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (isTransientDeployError(message) && attempt < 8) {
        const waitMs = Math.min(60_000, 5_000 * attempt);
        console.warn(
          `${label}: transient RPC/nonce on attempt ${attempt}, retrying in ${waitMs / 1000}s…`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

async function assertExternalBytecode(
  publicClient: PublicClient,
  label: string,
  address: `0x${string}`,
) {
  const ok = await verifyFeedBytecode(publicClient, address);
  if (!ok) {
    throw new Error(`${label} has no bytecode at ${address}`);
  }
}

function printDryRunCompare() {
  assertNuclearEncumbranceOrdering();
  const base = buildNuclearDeployPlan(84532);
  const eth = buildNuclearDeployPlan(11155111);
  console.log("Nuclear deploy dry-run — parameter parity (no txs)\n");
  console.log(formatNuclearParityTable(base, eth));
  console.log("\nSteps (identical both chains):");
  for (const [i, step] of base.steps.entries()) {
    console.log(`  ${i + 1}. ${step}`);
  }
  console.log("\nExternals sourced from CHAINLINK_FEEDS / LZ_ENDPOINT_V2_BY_CHAIN only.");
  console.log(
    "\nEncumbrance ordering: proxies → addEncumbranceSource ×2 → gateway → handoff (structural).",
  );
  console.log(`Checklist (not bytecode): ${CHECKLIST_ONCHAIN_OPEN_WITHOUT_REGISTER}`);
  console.log("Post-handoff Timelock48h owner ops (schedule → wait → execute):");
  for (const op of NUCLEAR_TIMELOCK_OWNER_OPS) {
    console.log(`  - ${op}`);
  }
  console.log(
    "\nNote: mode proxies initialize with owner=timelock; approvePaymentToken cannot run as deployer EOA — schedule after proxy deploy (Nuclear #2 runbook).",
  );
}

async function runLiveDeploy() {
    if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.error("DEPLOYER_PRIVATE_KEY not set in .env.local");
    process.exit(1);
  }

  let commerceGuardian: `0x${string}`;
  try {
    commerceGuardian = resolveCommerceGuardian();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const hardhat = (await import("hardhat")).default;
  const connection = await hardhat.network.connect();
  const viem = connection.viem as unknown as ViemSuite;

  try {
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    if (!isCommercialChainId(chainId)) {
      throw new Error(`Expected commercial chain 84532|11155111, got ${chainId}`);
    }

    assertNuclearEncumbranceOrdering();
    const plan = buildNuclearDeployPlan(chainId);
    const { params, externals } = plan;

    await assertExternalBytecode(publicClient, "nativeUsdFeed", externals.nativeUsdFeed);
    await assertExternalBytecode(publicClient, "usdc", externals.usdc);
    await assertExternalBytecode(publicClient, "layerZeroEndpoint", externals.layerZeroEndpoint);

    const [deployer] = await viem.getWalletClients();
    const deployerAddress = getAddress(deployer.account.address);
    const manifestPath = commercialDeploymentPath(chainId);

    console.log(`Kargain nuclear deploy — chain ${chainId} (generation v2)`);
    console.log(`Deployer: ${deployerAddress}`);
    console.log(`Guardian: ${commerceGuardian}`);
    console.log(`Registry: ${plan.registry}`);
    console.log(`USDC:     ${externals.usdc}`);
    console.log(`LZ:       ${externals.layerZeroEndpoint}`);
    console.log("");

    const timelock = await deployStep(viem, "Timelock48h", "Timelock48h", [
      [deployerAddress],
      [deployerAddress],
      deployerAddress,
    ]);

    const karProPass = await deployStep(viem, "KarProPass", "KarProPass", [deployerAddress]);

    const staking = await deployStep(viem, "KarProStaking", "KarProStaking", [
      karProPass.address,
      deployerAddress,
    ]);
    const proPass = await viem.getContractAt("KarProPass", karProPass.address);
    await writeStep(viem, "setStaking", () =>
      proPass.write.setStaking([staking.address], { account: deployer.account }),
    );

    const karPassport = await deployStep(viem, "KarPassport", "KarPassport", [
      staking.address,
      deployerAddress,
      params.disputeDeposit,
      params.platformRecipient,
    ]);

    const fixedPriceImpl = await deployStep(
      viem,
      "FixedPriceConsignment impl",
      "FixedPriceConsignment",
      [],
    );
    const fixedPriceInitData = encodeFunctionData({
      abi: FixedPriceConsignmentAbi,
      functionName: "initialize",
      args: [
        karPassport.address,
        params.platformRecipient,
        MARKETPLACE_FEE_BPS,
        externals.nativeUsdFeed,
        MARKETPLACE_MAX_FEED_STALENESS,
        timelock.address,
        commerceGuardian,
      ],
    });
    const fixedPriceProxy = await deployStep(viem, "FixedPriceConsignment proxy", "ERC1967Proxy", [
      fixedPriceImpl.address,
      fixedPriceInitData,
    ]);

    const ascendingImpl = await deployStep(
      viem,
      "AscendingConsignment impl",
      "AscendingConsignment",
      [],
    );
    const ascendingInitData = encodeFunctionData({
      abi: AscendingConsignmentAbi,
      functionName: "initialize",
      args: [
        karPassport.address,
        staking.address,
        params.platformRecipient,
        AUCTION_PLATFORM_FEE_BPS,
        params.platformRecipient,
        ASCENDING_CHALLENGE_BOND,
        ASCENDING_CHALLENGE_WINDOW,
        ASCENDING_MIN_DURATION,
        ASCENDING_MAX_DURATION,
        ASCENDING_EXTENSION_WINDOW,
        ASCENDING_MIN_INCREMENT_BPS,
        ASCENDING_PROTECTION_WINDOW,
        ASCENDING_ABANDONMENT_WINDOW,
        timelock.address,
        commerceGuardian,
      ],
    });
    const ascendingProxy = await deployStep(viem, "AscendingConsignment proxy", "ERC1967Proxy", [
      ascendingImpl.address,
      ascendingInitData,
    ]);

    const passport = await viem.getContractAt("KarPassport", karPassport.address);
    await writeStep(viem, `addEncumbranceSource(FixedPrice) → ${fixedPriceProxy.address}`, () =>
      passport.write.addEncumbranceSource([fixedPriceProxy.address], {
        account: deployer.account,
      }),
    );
    await writeStep(viem, `addEncumbranceSource(Ascending) → ${ascendingProxy.address}`, () =>
      passport.write.addEncumbranceSource([ascendingProxy.address], {
        account: deployer.account,
      }),
    );

    assertSourcesRegistered({
      fixedPriceRegistered: Boolean(
        await passport.read.isEncumbranceSource([fixedPriceProxy.address]),
      ),
      ascendingRegistered: Boolean(
        await passport.read.isEncumbranceSource([ascendingProxy.address]),
      ),
      fixedPrice: fixedPriceProxy.address,
      ascending: ascendingProxy.address,
    });
    console.log("  ✓ encumbrance sources registered (refusing gateway until this holds)");

    const gateway = await deployStep(
      viem,
      "KarPassportBridgeGateway",
      "KarPassportBridgeGateway",
      [karPassport.address, externals.layerZeroEndpoint, deployerAddress],
    );

    await writeStep(viem, `setBridgeGateway → ${gateway.address}`, () =>
      passport.write.setBridgeGateway([gateway.address], { account: deployer.account }),
    );
    const boundGateway = getAddress(
      (await passport.read.bridgeGateway([])) as `0x${string}`,
    );
    if (boundGateway !== getAddress(gateway.address)) {
      throw new Error(`bridgeGateway mismatch: ${boundGateway} vs ${gateway.address}`);
    }

    const stakingContract = await viem.getContractAt("KarProStaking", staking.address);
    await writeStep(viem, "KarPassport.transferOwnership → Timelock48h", () =>
      passport.write.transferOwnership([timelock.address], { account: deployer.account }),
    );
    await writeStep(viem, "KarProStaking.transferOwnership → Timelock48h", () =>
      stakingContract.write.transferOwnership([timelock.address], {
        account: deployer.account,
      }),
    );
    const passportOwner = getAddress((await passport.read.owner([])) as `0x${string}`);
    if (passportOwner !== getAddress(timelock.address)) {
      throw new Error(`KarPassport owner should be timelock, got ${passportOwner}`);
    }
    const stakingOwner = getAddress((await stakingContract.read.owner([])) as `0x${string}`);
    if (stakingOwner !== getAddress(timelock.address)) {
      throw new Error(`KarProStaking owner should be timelock, got ${stakingOwner}`);
    }

    // FixedPrice/Ascending are Ownable proxies initialized with `timelock.address`
    // directly — no separate on-chain upgradeAuthority() getter to verify (unlike
    // the retired pre-modes escrow UUPS pattern).
    const upgradeAuthority = getAddress(timelock.address);

    const blocks = {
      timelock: Number(timelock.blockNumber),
      karProPass: Number(karProPass.blockNumber),
      karProStaking: Number(staking.blockNumber),
      karPassport: Number(karPassport.blockNumber),
      fixedPriceConsignmentImpl: Number(fixedPriceImpl.blockNumber),
      fixedPriceConsignment: Number(fixedPriceProxy.blockNumber),
      ascendingConsignmentImpl: Number(ascendingImpl.blockNumber),
      ascendingConsignment: Number(ascendingProxy.blockNumber),
      bridgeGateway: Number(gateway.blockNumber),
    };

    const manifest: DeploymentManifest = {
      chainId,
      generation: "v2",
      karPassport: karPassport.address,
      karProPass: karProPass.address,
      karProStaking: staking.address,
      fixedPriceConsignment: fixedPriceProxy.address,
      fixedPriceConsignmentImpl: fixedPriceImpl.address,
      ascendingConsignment: ascendingProxy.address,
      ascendingConsignmentImpl: ascendingImpl.address,
      commerceGuardian,
      usdc: externals.usdc,
      nativeFeed: externals.nativeUsdFeed,
      timelock: timelock.address,
      bridgeGateway: gateway.address,
      layerZeroEndpoint: externals.layerZeroEndpoint,
      platformRecipient: params.platformRecipient,
      deployer: deployerAddress,
      upgradeAuthority,
      tokenIdOffset: plan.tokenIdOffset.toString(),
      deployedAt: new Date().toISOString(),
      blocks,
      indexFromBlock: computeIndexFromBlock(blocks),
      txHashes: {
        timelock: timelock.txHash,
        karProPass: karProPass.txHash,
        karProStaking: staking.txHash,
        karPassport: karPassport.txHash,
        fixedPriceConsignmentImpl: fixedPriceImpl.txHash,
        fixedPriceConsignment: fixedPriceProxy.txHash,
        ascendingConsignmentImpl: ascendingImpl.txHash,
        ascendingConsignment: ascendingProxy.txHash,
        bridgeGateway: gateway.txHash,
      },
      contractVersions: { ...CONTRACT_VERSIONS },
    };

    writeDeploymentManifest(manifestPath, manifest);

    console.log("");
    console.log("Nuclear deployment complete:");
    console.log(`  Timelock48h:              ${timelock.address}`);
    console.log(`  KarProPass:               ${karProPass.address}`);
    console.log(`  KarProStaking:            ${staking.address}`);
    console.log(`  KarPassport:              ${karPassport.address}`);
    console.log(`  FixedPriceConsignment:    ${fixedPriceProxy.address}`);
    console.log(`  AscendingConsignment:     ${ascendingProxy.address}`);
    console.log(`  commerceGuardian:         ${commerceGuardian}`);
    console.log(`  KarPassportBridgeGateway: ${gateway.address}`);
    console.log(`  bridgeGateway bound:      ${boundGateway}`);
    console.log(`  upgradeAuthority:         ${upgradeAuthority}`);
    console.log(`  tokenIdOffset:            ${plan.tokenIdOffset}`);
    console.log(`  Manifest:                 ${manifestPath}`);
    console.log("");
    console.log(
      "Next: update lib/web3/sepolia-addresses.ts (or ethereum twin) in the same PR, then pnpm ponder:config",
    );
    console.log("Next: pnpm bridge:wire after both commercial stacks are live");
  } finally {
    await connection.close();
  }
}

async function main() {
  if (argvHas("--dry-run", "--compare")) {
    printDryRunCompare();
    return;
  }
  await runLiveDeploy();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
