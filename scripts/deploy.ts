/**
 * Nuclear full-stack deploy for commercial chains 84532 | 11155111.
 * Sequence: Timelock → KarProPass → Staking → Passport →
 * FixedPrice + Ascending (deployer-owned) → encumbrance register →
 * payment-token admission → KarPassportBridgeGateway → setBridgeGateway →
 * mode ownership handoff → passport/staking handoff.
 *
 * Commerce cutover Phase 1: legacy escrow contracts are no longer part
 * of the nuclear deploy — modes only (SPEC §I.9.x, Nuclear #2 pending).
 *
 * `--dry-run` / `--compare`: print 84532 vs 11155111 parity table; no txs.
 * Live deploy requires DEPLOYER_PRIVATE_KEY, COMMERCE_GUARDIAN, and
 * `--network baseSepolia|ethereumSepolia`.
 */

import { encodeFunctionData, getAddress, type Hash, type PublicClient } from "viem";
import { baseSepolia, sepolia } from "viem/chains";

import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
} from "../lib/contracts/abis.generated.js";
import {
  ETHEREUM_SEPOLIA_PUBLIC_RPC,
  SEPOLIA_PUBLIC_RPC,
} from "../lib/web3/sepolia-addresses.js";
import {
  assertNuclearFeedsFresh,
  getChainFeedConfig,
  isCommercialChainId,
  resolveUsdcUsdFeedForAdmit,
  verifyFeedBytecode,
} from "./lib/chainlink-feeds.js";
import { createPublicClientForChain } from "./lib/deployer-viem.js";
import {
  buildNuclearDeployPlan,
  formatNuclearParityTable,
} from "./lib/nuclear-deploy-plan.js";
import {
  assertNuclearEncumbranceOrdering,
  assertPaymentTokensAdmitted,
  assertSourcesRegistered,
  NUCLEAR_GUARDIAN_IMMEDIATE_OPS,
  NUCLEAR_TIMELOCK_OWNER_OPS,
  ONCHAIN_OPEN_REQUIRES_ENCUMBRANCE_SOURCE,
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
  ASCENDING_MAX_PROTECTION_WINDOW,
  ASCENDING_MIN_DURATION,
  ASCENDING_MIN_INCREMENT_BPS,
  ASCENDING_MIN_PROTECTION_WINDOW,
  AUCTION_PLATFORM_FEE_BPS,
  MARKETPLACE_FEE_BPS,
  resolveCommerceGuardian,
} from "./lib/verify-constructor-args.js";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

type ViemSuite = {
  sendDeploymentTransaction: (
    contractName: string,
    constructorArgs?: readonly unknown[],
    config?: { libraries?: Record<string, `0x${string}`> },
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
  libraries?: Record<string, `0x${string}`>,
): Promise<DeployResult> {
  const publicClient = await viem.getPublicClient();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const { contract, deploymentTransaction } = await viem.sendDeploymentTransaction(
        contractName,
        constructorArgs,
        libraries ? { libraries } : undefined,
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

async function printDryRunCompare() {
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
    "\nOrdering: proxies → register ×2 → admit USDC ×2 → gateway → mode handoff → passport/staking handoff (structural).",
  );
  console.log(`On-chain open gate: ${ONCHAIN_OPEN_REQUIRES_ENCUMBRANCE_SOURCE}`);
  console.log("\nPer-feed staleness tolerances (property of each feed — not a global bound):");
  for (const plan of [base, eth]) {
    console.log(
      `  ${plan.chainId}: nativeUsd=${plan.externals.nativeUsdStalenessTolerance}s ` +
        `usdcUsd=${plan.externals.usdcUsdStalenessTolerance}s`,
    );
  }
  console.log("\nFixedPrice USDC/USD feed (P4 — no silent peg):");
  for (const plan of [base, eth]) {
    const admit = resolveUsdcUsdFeedForAdmit({
      usdcUsdFeed: plan.externals.usdcUsdFeed,
      usdcUsdStalenessTolerance: plan.externals.usdcUsdStalenessTolerance,
      chainId: plan.chainId,
    });
    if (admit.fiatLimitation) {
      console.log(`  ${plan.chainId}: admit USDC with feed ${admit.feed} (tolerance ${admit.stalenessTolerance})`);
      console.log(`    LIMITATION: ${admit.fiatLimitation}`);
    } else {
      console.log(
        `  ${plan.chainId}: ${admit.feed} — admit OK with measured feed, stalenessTolerance=${admit.stalenessTolerance}s`,
      );
    }
  }

  console.log("\nLive feed freshness vs configured per-feed tolerance (RPC):");
  const rpcPairs: Array<{
    chainId: 84532 | 11155111;
    chain: typeof baseSepolia | typeof sepolia;
    rpc: string;
  }> = [
    {
      chainId: 84532,
      chain: baseSepolia,
      rpc: process.env.PONDER_RPC_URL_84532 ?? SEPOLIA_PUBLIC_RPC,
    },
    {
      chainId: 11155111,
      chain: sepolia,
      rpc: process.env.PONDER_RPC_URL_11155111 ?? ETHEREUM_SEPOLIA_PUBLIC_RPC,
    },
  ];
  for (const { chainId, chain, rpc } of rpcPairs) {
    const client = createPublicClientForChain(chain, rpc);
    const config = getChainFeedConfig(chainId);
    const checks = await assertNuclearFeedsFresh(client, config);
    for (const c of checks) {
      console.log(
        `  ✓ ${chainId} ${c.label}: age ${c.ageSeconds}s ≤ tolerance ${c.stalenessTolerance}s`,
      );
    }
  }

  console.log("Guardian immediate ops (G3 reduce-exposure):");
  for (const op of NUCLEAR_GUARDIAN_IMMEDIATE_OPS) {
    console.log(`  - ${op}`);
  }
  console.log("Post-handoff Timelock48h owner ops (schedule → wait → execute):");
  for (const op of NUCLEAR_TIMELOCK_OWNER_OPS) {
    console.log(`  - ${op}`);
  }
  console.log(
    "\nNote: mode proxies initialize with owner=deployer; USDC admission runs before Timelock handoff. " +
      "Each feed carries its own stalenessTolerance at admit (native at initialize). Zero usdcUsdFeed admits " +
      "asset-only USDC and announces the fiat limitation (never a silent peg). Non-zero feed enables fiat with " +
      "its tolerance; once set, feed is monotonic and cannot be cleared. Post-handoff approve / setCurrencyFeed " +
      "still go through Timelock — `_validateFeed(feed, tolerance)` runs at execute. " +
      "Dry-run aborts before any tx if a feed's age exceeds its configured tolerance.",
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
    const feedConfig = getChainFeedConfig(chainId);
    await assertNuclearFeedsFresh(publicClient, feedConfig);
    const usdcAdmit = resolveUsdcUsdFeedForAdmit(feedConfig);
    const usdcUsdFeed = usdcAdmit.feed;
    const usdcUsdStalenessTolerance = usdcAdmit.stalenessTolerance;
    if (usdcAdmit.fiatLimitation) {
      console.log(`LIMITATION: ${usdcAdmit.fiatLimitation}`);
    } else {
      await assertExternalBytecode(publicClient, "usdcUsdFeed", usdcUsdFeed);
    }

    const [deployer] = await viem.getWalletClients();
    const deployerAddress = getAddress(deployer.account.address);
    const manifestPath = commercialDeploymentPath(chainId);

    console.log(`Kargain nuclear deploy — chain ${chainId} (generation v2)`);
    console.log(`Deployer: ${deployerAddress}`);
    console.log(`Guardian: ${commerceGuardian}`);
    console.log(`Registry: ${plan.registry}`);
    console.log(`USDC:     ${externals.usdc}`);
    console.log(
      `USDC/USD: ${usdcUsdFeed}${usdcAdmit.fiatLimitation ? " (asset-only — fiat unavailable)" : ` (stalenessTolerance=${usdcUsdStalenessTolerance}s)`}`,
    );
    console.log(
      `Native/USD stalenessTolerance: ${externals.nativeUsdStalenessTolerance}s`,
    );
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
        externals.nativeUsdStalenessTolerance,
        deployerAddress,
        commerceGuardian,
      ],
    });
    const fixedPriceProxy = await deployStep(viem, "FixedPriceConsignment proxy", "ERC1967Proxy", [
      fixedPriceImpl.address,
      fixedPriceInitData,
    ]);

    const ascendingHoldLib = await deployStep(viem, "AscendingHoldLib", "AscendingHoldLib", []);
    const ascendingOpenLib = await deployStep(viem, "AscendingOpenLib", "AscendingOpenLib", []);
    const ascendingLibraries = {
      AscendingHoldLib: ascendingHoldLib.address,
      AscendingOpenLib: ascendingOpenLib.address,
    };
    const ascendingImpl = await deployStep(
      viem,
      "AscendingConsignment impl",
      "AscendingConsignment",
      [],
      ascendingLibraries,
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
        ASCENDING_MIN_PROTECTION_WINDOW,
        ASCENDING_MAX_PROTECTION_WINDOW,
        ASCENDING_ABANDONMENT_WINDOW,
        deployerAddress,
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

    const fixedPrice = await viem.getContractAt(
      "FixedPriceConsignment",
      fixedPriceProxy.address,
    );
    const ascending = await viem.getContractAt(
      "AscendingConsignment",
      ascendingProxy.address,
    );
    await writeStep(
      viem,
      `FixedPrice.approvePaymentToken(USDC, usdcUsdFeed, ${usdcUsdStalenessTolerance}) → ${externals.usdc}`,
      () =>
        fixedPrice.write.approvePaymentToken(
          [externals.usdc, usdcUsdFeed, usdcUsdStalenessTolerance],
          {
            account: deployer.account,
          },
        ),
    );
    await writeStep(viem, `Ascending.approvePaymentToken(USDC) → ${externals.usdc}`, () =>
      ascending.write.approvePaymentToken([externals.usdc], {
        account: deployer.account,
      }),
    );
    const fpCfg = await fixedPrice.read.paymentTokens([externals.usdc]);
    const fpEnabled = Array.isArray(fpCfg)
      ? Boolean(fpCfg[2])
      : Boolean((fpCfg as { enabled: boolean }).enabled);
    const fpFeed = Array.isArray(fpCfg)
      ? (fpCfg[0] as string)
      : String((fpCfg as { feed: string }).feed);
    assertPaymentTokensAdmitted({
      fixedPriceUsdcEnabled: fpEnabled,
      ascendingUsdcEnabled: Boolean(
        await ascending.read.paymentTokenEnabled([externals.usdc]),
      ),
      usdc: externals.usdc,
      fixedPriceUsdcFeed: fpFeed,
      expectedFixedPriceUsdcFeed: usdcUsdFeed,
    });
    if (usdcAdmit.fiatLimitation) {
      console.log(
        "  ✓ USDC admitted on both modes (FixedPrice feed zero — fiat unavailable; asset-denominated only)",
      );
      console.log(`    LIMITATION: ${usdcAdmit.fiatLimitation}`);
    } else {
      console.log(
        "  ✓ USDC admitted on both modes (FixedPrice feed non-zero; refusing handoff until this holds)",
      );
    }

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

    await writeStep(viem, "FixedPrice.transferOwnership → Timelock48h", () =>
      fixedPrice.write.transferOwnership([timelock.address], { account: deployer.account }),
    );
    await writeStep(viem, "Ascending.transferOwnership → Timelock48h", () =>
      ascending.write.transferOwnership([timelock.address], { account: deployer.account }),
    );
    const fpOwner = getAddress((await fixedPrice.read.owner([])) as `0x${string}`);
    const ascOwner = getAddress((await ascending.read.owner([])) as `0x${string}`);
    if (fpOwner !== getAddress(timelock.address)) {
      throw new Error(`FixedPrice owner should be timelock, got ${fpOwner}`);
    }
    if (ascOwner !== getAddress(timelock.address)) {
      throw new Error(`Ascending owner should be timelock, got ${ascOwner}`);
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

    const upgradeAuthority = getAddress(timelock.address);

    const blocks = {
      timelock: Number(timelock.blockNumber),
      karProPass: Number(karProPass.blockNumber),
      karProStaking: Number(staking.blockNumber),
      karPassport: Number(karPassport.blockNumber),
      fixedPriceConsignmentImpl: Number(fixedPriceImpl.blockNumber),
      fixedPriceConsignment: Number(fixedPriceProxy.blockNumber),
      ascendingHoldLib: Number(ascendingHoldLib.blockNumber),
      ascendingOpenLib: Number(ascendingOpenLib.blockNumber),
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
      ascendingHoldLib: ascendingHoldLib.address,
      ascendingOpenLib: ascendingOpenLib.address,
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
        ascendingHoldLib: ascendingHoldLib.txHash,
        ascendingOpenLib: ascendingOpenLib.txHash,
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
    console.log(`  AscendingHoldLib:         ${ascendingHoldLib.address}`);
    console.log(`  AscendingOpenLib:         ${ascendingOpenLib.address}`);
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
    await printDryRunCompare();
    return;
  }
  await runLiveDeploy();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
