import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { getAddress, parseEther, stringToHex, padHex } from "viem";

import hardhat from "hardhat";
import {
  deployFixedPriceConsignment,
  increaseTime,
  ZERO,
} from "../../scripts/lib/local-stack.js";
import { encodeFunctionData } from "viem";
import { FixedPriceConsignmentAbi } from "../../lib/contracts/abis.generated.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Connection = Awaited<ReturnType<typeof hardhat.network.connect>>;
type ViemSuite = Connection["viem"];
type WalletClient = Awaited<ReturnType<ViemSuite["getWalletClients"]>>[number];
type DeployedContract = Awaited<ReturnType<ViemSuite["deployContract"]>>;
type PublicClient = Awaited<ReturnType<ViemSuite["getPublicClient"]>>;

const EIP170_MAX = 24_576;
const PLATFORM_FEE_BPS = 250n;
const MAX_STALENESS = 3_600n;
const MIN_FEED_STALENESS = 60;
const MAX_FEED_STALENESS_BOUND = 259_200;
const DEFAULT_FEED_TOLERANCE = Number(MAX_STALENESS);
const ETH_USD_1E8 = 2_000n * 10n ** 8n; // $2000
const USDC_USD_1E8 = 1n * 10n ** 8n; // $1
const FIAT_100_USD = 100n * 10n ** 8n; // $100

function deployedBytecodeBytes(artifactPath: string, name: string): number {
  const abs = path.join(repoRoot, artifactPath);
  if (!existsSync(abs)) {
    assert.fail(`Missing artifact for ${name}. Run "pnpm hardhat compile" first.`);
  }
  const artifact = JSON.parse(readFileSync(abs, "utf8")) as { deployedBytecode?: string };
  const hex = artifact.deployedBytecode;
  if (typeof hex !== "string" || !hex.startsWith("0x")) {
    assert.fail(`${name}: missing deployedBytecode`);
  }
  return (hex.length - 2) / 2;
}

{
  const modeBytes = deployedBytecodeBytes(
    "artifacts/contracts/FixedPriceConsignment.sol/FixedPriceConsignment.json",
    "FixedPriceConsignment",
  );
  process.stdout.write("\n--- FixedPriceConsignment EIP-170 ---\n");
  process.stdout.write(`| FixedPriceConsignment | ${modeBytes} |\n`);
  process.stdout.write(`| EIP-170 limit | ${EIP170_MAX} |\n`);
  process.stdout.write(`| Headroom | ${EIP170_MAX - modeBytes} |\n\n`);
  assert.ok(modeBytes <= EIP170_MAX, `overweight: ${modeBytes}`);
}

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    return err.message.includes(errorName);
  };
}

function currencyCode(s: string): `0x${string}` {
  // Solidity `bytes32("USD")` right-pads; viem padHex defaults to left.
  return padHex(stringToHex(s), { size: 32, dir: "right" });
}

const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const DENOM_ASSET = { kind: 0, currencyCode: BYTES32_ZERO } as const;
const DENOM_USD = { kind: 1, currencyCode: currencyCode("USD") } as const;
const DENOM_EUR = { kind: 1, currencyCode: currencyCode("EUR") } as const;
const COMP_MARGIN = { form: 0, commissionBps: 0 } as const;
const COMP_COMMISSION_500 = { form: 1, commissionBps: 500 } as const;

const TOKEN = 1n;
const INTENT_OPEN = 1; // IKarPassportEncumbrance.Intent.OpenConsignment

describe("FixedPriceConsignment", () => {
  let connection: Connection;
  let viem: ViemSuite;
  let publicClient: PublicClient;

  let mode: DeployedContract;
  let passport: DeployedContract;
  let nativeFeed: DeployedContract;
  let owner: WalletClient;
  let agent: WalletClient;
  let buyer: WalletClient;
  let platform: WalletClient;
  let stranger: WalletClient;
  let guardian: WalletClient;
  let modeImpl: DeployedContract;

  async function deployStack(useHarness = false) {
    connection = await hardhat.network.connect();
    viem = connection.viem;
    publicClient = await viem.getPublicClient();
    const wallets = await viem.getWalletClients();
    [owner, agent, buyer, platform, stranger, guardian] = wallets;

    passport = await viem.deployContract("MockPassportEncumbrance", []);
    nativeFeed = await viem.deployContract("MockV3Aggregator", [8, ETH_USD_1E8]);

    const deployed = await deployFixedPriceConsignment(viem, {
      passport: passport.address,
      platformRecipient: platform.account.address,
      feeBps: PLATFORM_FEE_BPS,
      nativeUsdFeed: nativeFeed.address,
      nativeUsdStalenessTolerance: DEFAULT_FEED_TOLERANCE,
      owner: owner.account.address,
      guardian: guardian.account.address,
      harness: useHarness,
    });
    mode = deployed.mode;
    modeImpl = deployed.impl;
  }

  async function mintAndApprove(tokenId: bigint, holder: WalletClient = owner) {
    await passport.write.mint([holder.account.address, tokenId], { account: holder.account });
    await passport.write.setMay([tokenId, INTENT_OPEN, true]);
    await passport.write.approve([mode.address, tokenId], { account: holder.account });
  }

  async function admitWithUsdFeed(
    token: `0x${string}`,
    answer: bigint = USDC_USD_1E8,
    stalenessTolerance: number = DEFAULT_FEED_TOLERANCE,
  ): Promise<DeployedContract> {
    const feed = await viem.deployContract("MockV3Aggregator", [8, answer]);
    await mode.write.approvePaymentToken([token, feed.address, stalenessTolerance], {
      account: owner.account,
    });
    return feed;
  }

  beforeEach(async () => {
    await deployStack(false);
  });

  it("VERSION matches CONTRACT_VERSIONS", async () => {
    assert.equal(await mode.read.VERSION(), "2.4.0-rc.1");
  });

  it("source carries no verifier-admission / staking gate symbols (N2)", () => {
    const src = readFileSync(
      path.join(repoRoot, "contracts/FixedPriceConsignment.sol"),
      "utf8",
    );
    for (const banned of [
      "isActiveVerifier",
      "NotActiveVerifier",
      "karProStaking",
      "KarProStaking",
      "IKarProStaking",
    ]) {
      assert.ok(!src.includes(banned), `must not contain ${banned}`);
    }
  });

  it("ordinary EOA opens direct without verifier admission (N2)", async () => {
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, parseEther("1")], {
      account: owner.account,
    });
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 1); // Offered
    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      mode.address.toLowerCase(),
    );
  });

  it("Nuclear #4: UNVERIFIED passport can open FixedPrice direct", async () => {
    await mintAndApprove(TOKEN);
    await passport.write.setPassportStatus([TOKEN, 0]); // UNVERIFIED
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, parseEther("1")], {
      account: owner.account,
    });
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 1);
  });

  it("ZeroFeedStaleness on initialize", async () => {
    const impl = await viem.deployContract("FixedPriceConsignment", []);
    const initData = encodeFunctionData({
      abi: FixedPriceConsignmentAbi,
      functionName: "initialize",
      args: [
        passport.address,
        platform.account.address,
        PLATFORM_FEE_BPS,
        nativeFeed.address,
        0,
        owner.account.address,
        guardian.account.address,
      ],
    });
    await assert.rejects(
      viem.deployContract("ERC1967Proxy", [impl.address, initData]),
      (err) => {
        if (!(err instanceof Error)) return false;
        return err.message.includes("ZeroFeedStaleness") || err.message.includes("FailedCall");
      },
    );
  });

  it("setNativeUsdStalenessTolerance: owner retunes native feed window; out-of-bounds reverts", async () => {
    await assert.rejects(
      mode.write.setNativeUsdStalenessTolerance([0], { account: owner.account }),
      revertsWith("FeedStalenessOutOfBounds"),
    );
    const next = DEFAULT_FEED_TOLERANCE * 2;
    await mode.write.setNativeUsdStalenessTolerance([next], { account: owner.account });
    assert.equal(await mode.read.nativeUsdStalenessTolerance(), next);
  });

  it("DirectEthNotAccepted on bare receive", async () => {
    await assert.rejects(
      owner.sendTransaction({
        to: mode.address,
        value: 1n,
      }),
      revertsWith("DirectEthNotAccepted"),
    );
  });

  // ---- Precision (6 and 18) ----

  it("fiat USD → ERC-20@6: quote and seller proceeds use admission decimals", async () => {
    const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
    await admitWithUsdFeed(usdc.address);

    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_USD, usdc.address, FIAT_100_USD], {
      account: owner.account,
    });

    const quote = (await mode.read.quoteBuy([TOKEN])) as bigint;
    // $100 @ $1 feed @ 6 decimals → 100e6
    assert.equal(quote, 100n * 10n ** 6n);

    await usdc.write.mint([buyer.account.address, quote]);
    await usdc.write.approve([mode.address, quote], { account: buyer.account });

    const sellerBefore = (await usdc.read.balanceOf([owner.account.address])) as bigint;
    const platformBefore = (await usdc.read.balanceOf([platform.account.address])) as bigint;

    await mode.write.buy([TOKEN], { account: buyer.account });

    const platformFee = (quote * PLATFORM_FEE_BPS) / 10_000n;
    const sellerShare = quote - platformFee;
    assert.equal(
      ((await usdc.read.balanceOf([platform.account.address])) as bigint) - platformBefore,
      platformFee,
    );
    assert.equal(
      ((await usdc.read.balanceOf([owner.account.address])) as bigint) - sellerBefore,
      sellerShare,
    );
    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      buyer.account.address.toLowerCase(),
    );
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 2); // Closed
  });

  it("fiat USD → ERC-20@18: quote and seller proceeds use admission decimals", async () => {
    const dai = await viem.deployContract("MockERC20Decimals", ["DAI", "DAI", 18]);
    await admitWithUsdFeed(dai.address);

    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_USD, dai.address, FIAT_100_USD], {
      account: owner.account,
    });

    const quote = (await mode.read.quoteBuy([TOKEN])) as bigint;
    assert.equal(quote, 100n * 10n ** 18n);

    await dai.write.mint([buyer.account.address, quote]);
    await dai.write.approve([mode.address, quote], { account: buyer.account });

    const sellerBefore = (await dai.read.balanceOf([owner.account.address])) as bigint;
    await mode.write.buy([TOKEN], { account: buyer.account });
    const platformFee = (quote * PLATFORM_FEE_BPS) / 10_000n;
    assert.equal(
      ((await dai.read.balanceOf([owner.account.address])) as bigint) - sellerBefore,
      quote - platformFee,
    );
    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      buyer.account.address.toLowerCase(),
    );
  });

  // ---- Fiat refuse ----

  it("stale feed → StalePrice", async () => {
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_USD, ZERO, FIAT_100_USD], {
      account: owner.account,
    });
    await increaseTime(publicClient, MAX_STALENESS + 1n);
    await assert.rejects(mode.read.quoteBuy([TOKEN]), revertsWith("StalePrice"));
  });

  it("non-positive oracle answer → BadOracleAnswer", async () => {
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_USD, ZERO, FIAT_100_USD], {
      account: owner.account,
    });
    await nativeFeed.write.setAnswer([0n]);
    await assert.rejects(mode.read.quoteBuy([TOKEN]), revertsWith("BadOracleAnswer"));
    await nativeFeed.write.setAnswer([-1n]);
    await assert.rejects(mode.read.quoteBuy([TOKEN]), revertsWith("BadOracleAnswer"));
  });

  it("unregistered fiat currency → CurrencyNotAvailableOnChain", async () => {
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_EUR, ZERO, FIAT_100_USD], {
      account: owner.account,
    });
    await assert.rejects(mode.read.quoteBuy([TOKEN]), revertsWith("CurrencyNotAvailableOnChain"));
  });

  // ---- Asset denom ----

  it("asset-denom native buy: exact units, no feed read for price", async () => {
    const price = parseEther("0.5");
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, price], { account: owner.account });

    // Poison native feed — asset denom must still quote exact price
    await nativeFeed.write.setAnswer([0n]);
    assert.equal(await mode.read.quoteBuy([TOKEN]), price);

    await nativeFeed.write.setAnswer([ETH_USD_1E8]); // restore for other invariants
    const platformBefore = await publicClient.getBalance({ address: platform.account.address });
    await mode.write.buy([TOKEN], { account: buyer.account, value: price });
    const platformFee = (price * PLATFORM_FEE_BPS) / 10_000n;
    const platformAfter = await publicClient.getBalance({ address: platform.account.address });
    assert.equal(platformAfter - platformBefore, platformFee);
    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      buyer.account.address.toLowerCase(),
    );
  });

  it("asset-denom ERC-20: PaymentTokenNotSupported when not admitted at open", async () => {
    const tok = await viem.deployContract("MockERC20Decimals", ["T", "T", 18]);
    await mintAndApprove(TOKEN);
    await assert.rejects(
      mode.write.openDirect([TOKEN, DENOM_ASSET, tok.address, 1_000n], {
        account: owner.account,
      }),
      revertsWith("PaymentTokenNotSupported"),
    );
  });

  it("WrongValue when native msg.value mismatches quote", async () => {
    const price = parseEther("1");
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, price], { account: owner.account });
    await assert.rejects(
      mode.write.buy([TOKEN], { account: buyer.account, value: price - 1n }),
      revertsWith("WrongValue"),
    );
  });

  // ---- Agented on-chain + P3 fiat floor convert ----

  it("agented margin fiat buy: floor converts with same rate; agent earns remainder", async () => {
    const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
    await admitWithUsdFeed(usdc.address);

    const floor = 80n * 10n ** 8n; // $80
    const price = FIAT_100_USD; // $100
    await mintAndApprove(TOKEN);
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, usdc.address, DENOM_USD, floor, COMP_MARGIN],
      { account: owner.account },
    );
    await mode.write.openFromMandate([TOKEN, DENOM_USD, price], { account: agent.account });

    const quote = (await mode.read.quoteBuy([TOKEN])) as bigint;
    assert.equal(quote, 100n * 10n ** 6n);
    const floorAsset = 80n * 10n ** 6n;

    await usdc.write.mint([buyer.account.address, quote]);
    await usdc.write.approve([mode.address, quote], { account: buyer.account });

    const sellerBefore = (await usdc.read.balanceOf([owner.account.address])) as bigint;
    const agentBefore = (await usdc.read.balanceOf([agent.account.address])) as bigint;
    const platformBefore = (await usdc.read.balanceOf([platform.account.address])) as bigint;

    await mode.write.buy([TOKEN], { account: buyer.account });

    const platformFee = (quote * PLATFORM_FEE_BPS) / 10_000n;
    assert.equal(
      ((await usdc.read.balanceOf([platform.account.address])) as bigint) - platformBefore,
      platformFee,
    );
    assert.equal(
      ((await usdc.read.balanceOf([owner.account.address])) as bigint) - sellerBefore,
      floorAsset,
    );
    assert.equal(
      ((await usdc.read.balanceOf([agent.account.address])) as bigint) - agentBefore,
      quote - platformFee - floorAsset,
    );
  });

  // ---- Base-scaled fiat floor snapshot (PENDING-REDEPLOY §5) ----
  // Construction: open proves F ≤ baseFiat ⇒ floorAsset = mulDiv(baseAsset, F, baseFiat) ≤ baseAsset
  // ⇒ settle cannot BelowFloor. Independent quote(F) deleted.

  const BPS = 10_000n;
  function commissionOwnerShare(settled: bigint, commissionBps: bigint) {
    const cut = PLATFORM_FEE_BPS + commissionBps;
    return cut >= BPS ? 0n : (settled * (BPS - cut)) / BPS;
  }
  function marginScaleBase(settled: bigint) {
    return settled - (settled * PLATFORM_FEE_BPS) / BPS;
  }

  it("base-scaled floor: Commission zero headroom, native — buy succeeds", async () => {
    const commissionBps = 500n;
    const price = FIAT_100_USD;
    const floor = commissionOwnerShare(price, commissionBps);
    assert.ok(floor > 0n);

    await mintAndApprove(TOKEN);
    await mode.write.grant(
      [
        TOKEN,
        agent.account.address,
        0n,
        ZERO,
        DENOM_USD,
        floor,
        { form: 1, commissionBps: Number(commissionBps) },
      ],
      { account: owner.account },
    );
    await mode.write.openFromMandate([TOKEN, DENOM_USD, price], { account: agent.account });

    const amount = (await mode.read.quoteBuy([TOKEN])) as bigint;
    const expectedFloorAsset = commissionOwnerShare(amount, commissionBps);

    const sellerBefore = await publicClient.getBalance({ address: owner.account.address });
    const agentBefore = await publicClient.getBalance({ address: agent.account.address });
    const platformBefore = await publicClient.getBalance({ address: platform.account.address });

    await mode.write.buy([TOKEN], { account: buyer.account, value: amount });

    const platformFee = (amount * PLATFORM_FEE_BPS) / BPS;
    assert.equal(
      (await publicClient.getBalance({ address: platform.account.address })) - platformBefore,
      platformFee,
    );
    assert.equal(
      (await publicClient.getBalance({ address: owner.account.address })) - sellerBefore,
      expectedFloorAsset,
    );
    assert.equal(
      (await publicClient.getBalance({ address: agent.account.address })) - agentBefore,
      amount - platformFee - expectedFloorAsset,
    );
  });

  it("base-scaled floor: Commission zero headroom, USDC-6 — buy succeeds", async () => {
    const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
    await admitWithUsdFeed(usdc.address);

    const commissionBps = 500n;
    const price = FIAT_100_USD;
    const floor = commissionOwnerShare(price, commissionBps);

    await mintAndApprove(TOKEN);
    await mode.write.grant(
      [
        TOKEN,
        agent.account.address,
        0n,
        usdc.address,
        DENOM_USD,
        floor,
        { form: 1, commissionBps: Number(commissionBps) },
      ],
      { account: owner.account },
    );
    await mode.write.openFromMandate([TOKEN, DENOM_USD, price], { account: agent.account });

    const amount = (await mode.read.quoteBuy([TOKEN])) as bigint;
    const expectedFloorAsset = commissionOwnerShare(amount, commissionBps);

    await usdc.write.mint([buyer.account.address, amount]);
    await usdc.write.approve([mode.address, amount], { account: buyer.account });

    const sellerBefore = (await usdc.read.balanceOf([owner.account.address])) as bigint;
    await mode.write.buy([TOKEN], { account: buyer.account });
    assert.equal(
      ((await usdc.read.balanceOf([owner.account.address])) as bigint) - sellerBefore,
      expectedFloorAsset,
    );
  });

  it("base-scaled floor: Margin max floor F = P − ⌊P·p/B⌋, native — buy succeeds", async () => {
    const price = FIAT_100_USD;
    const floor = marginScaleBase(price);

    await mintAndApprove(TOKEN);
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, ZERO, DENOM_USD, floor, COMP_MARGIN],
      { account: owner.account },
    );
    await mode.write.openFromMandate([TOKEN, DENOM_USD, price], { account: agent.account });

    const amount = (await mode.read.quoteBuy([TOKEN])) as bigint;
    const expectedFloorAsset = marginScaleBase(amount);

    const sellerBefore = await publicClient.getBalance({ address: owner.account.address });
    const agentBefore = await publicClient.getBalance({ address: agent.account.address });
    const platformBefore = await publicClient.getBalance({ address: platform.account.address });

    await mode.write.buy([TOKEN], { account: buyer.account, value: amount });

    const platformFee = (amount * PLATFORM_FEE_BPS) / BPS;
    assert.equal(
      (await publicClient.getBalance({ address: platform.account.address })) - platformBefore,
      platformFee,
    );
    assert.equal(
      (await publicClient.getBalance({ address: owner.account.address })) - sellerBefore,
      expectedFloorAsset,
    );
    assert.equal(
      (await publicClient.getBalance({ address: agent.account.address })) - agentBefore,
      amount - platformFee - expectedFloorAsset,
    );
    assert.equal(expectedFloorAsset, amount - platformFee);
  });

  it("base-scaled floor: Margin max floor, USDC-6 — buy succeeds", async () => {
    const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
    await admitWithUsdFeed(usdc.address);

    const price = FIAT_100_USD;
    const floor = marginScaleBase(price);

    await mintAndApprove(TOKEN);
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, usdc.address, DENOM_USD, floor, COMP_MARGIN],
      { account: owner.account },
    );
    await mode.write.openFromMandate([TOKEN, DENOM_USD, price], { account: agent.account });

    const amount = (await mode.read.quoteBuy([TOKEN])) as bigint;
    const expectedFloorAsset = marginScaleBase(amount);

    await usdc.write.mint([buyer.account.address, amount]);
    await usdc.write.approve([mode.address, amount], { account: buyer.account });

    const sellerBefore = (await usdc.read.balanceOf([owner.account.address])) as bigint;
    const agentBefore = (await usdc.read.balanceOf([agent.account.address])) as bigint;
    await mode.write.buy([TOKEN], { account: buyer.account });
    assert.equal(
      ((await usdc.read.balanceOf([owner.account.address])) as bigint) - sellerBefore,
      expectedFloorAsset,
    );
    assert.equal(
      ((await usdc.read.balanceOf([agent.account.address])) as bigint) - agentBefore,
      0n,
    );
  });

  it("base-scaled floor: independent quote(F) would BelowFloor; mulDiv path succeeds", async () => {
    // ETH/USD = $1999: for P=$100 and F=ownerShare(P), ⌊F·1e18/rate⌋ = ownerShare(A)+1.
    // Old buy wrote that snapshot then _paySplit reverted BelowFloor. New path scales from base.
    const ethUsd = 1_999n * 10n ** 8n;
    await nativeFeed.write.setAnswer([ethUsd]);

    const commissionBps = 500n;
    const price = FIAT_100_USD;
    const floor = commissionOwnerShare(price, commissionBps);

    await mintAndApprove(TOKEN);
    await mode.write.grant(
      [
        TOKEN,
        agent.account.address,
        0n,
        ZERO,
        DENOM_USD,
        floor,
        { form: 1, commissionBps: Number(commissionBps) },
      ],
      { account: owner.account },
    );
    await mode.write.openFromMandate([TOKEN, DENOM_USD, price], { account: agent.account });

    const amount = (await mode.read.quoteBuy([TOKEN])) as bigint;
    const baseAsset = commissionOwnerShare(amount, commissionBps);
    const independentQuoteFloor = (floor * 10n ** 18n) / ethUsd;
    assert.ok(
      independentQuoteFloor > baseAsset,
      `expected independent quote(F)=${independentQuoteFloor} > owner(A)=${baseAsset}`,
    );

    const sellerBefore = await publicClient.getBalance({ address: owner.account.address });
    await mode.write.buy([TOKEN], { account: buyer.account, value: amount });
    assert.equal(
      (await publicClient.getBalance({ address: owner.account.address })) - sellerBefore,
      baseAsset,
    );
  });

  // ---- External path (C7 / R4) ----

  it("external: note required; NFT moves; no money moved; poisoned floor ignored", async () => {
    await deployStack(true); // harness for floor poison

    await mintAndApprove(TOKEN);
    const price = parseEther("1");
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, price], { account: owner.account });

    await assert.rejects(
      mode.write.confirmExternalPayment([TOKEN, buyer.account.address], {
        account: owner.account,
      }),
      revertsWith("EmptySettlementNote"),
    );

    await mode.write.setSettlementNote([TOKEN, stringToHex("ln:invoice")], {
      account: owner.account,
    });

    // Poison floor far above price — must not affect external confirm (R4)
    await mode.write.forceSetConsignmentFloor([TOKEN, parseEther("100")]);
    assert.equal(await mode.read.consignmentFloorOf([TOKEN]), parseEther("100"));

    const sellerEth = await publicClient.getBalance({ address: owner.account.address });
    const platformEth = await publicClient.getBalance({ address: platform.account.address });
    const modeEth = await publicClient.getBalance({ address: mode.address });

    await mode.write.confirmExternalPayment([TOKEN, buyer.account.address], {
      account: owner.account,
    });

    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      buyer.account.address.toLowerCase(),
    );
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 2); // Closed
    // Mode ETH unchanged (no split intake); platform unchanged
    assert.equal(await publicClient.getBalance({ address: mode.address }), modeEth);
    assert.equal(await publicClient.getBalance({ address: platform.account.address }), platformEth);
    // Seller may have paid gas only — balance did not increase from protocol
    assert.ok((await publicClient.getBalance({ address: owner.account.address })) <= sellerEth);
  });

  it("external: agent may confirm; stranger cannot; empty buyer refused", async () => {
    const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
    await admitWithUsdFeed(usdc.address);
    await mintAndApprove(TOKEN);
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, usdc.address, DENOM_USD, 50n * 10n ** 8n, COMP_MARGIN],
      { account: owner.account },
    );
    await mode.write.openFromMandate([TOKEN, DENOM_USD, FIAT_100_USD], {
      account: agent.account,
    });
    await mode.write.setSettlementNote([TOKEN, stringToHex("cash")], {
      account: agent.account,
    });

    await assert.rejects(
      mode.write.confirmExternalPayment([TOKEN, buyer.account.address], {
        account: stranger.account,
      }),
      revertsWith("NotSellerOrAgent"),
    );
    await assert.rejects(
      mode.write.confirmExternalPayment([TOKEN, ZERO], { account: agent.account }),
      revertsWith("ZeroAddress"),
    );

    const usdcModeBefore = (await usdc.read.balanceOf([mode.address])) as bigint;
    await mode.write.confirmExternalPayment([TOKEN, buyer.account.address], {
      account: agent.account,
    });
    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      buyer.account.address.toLowerCase(),
    );
    assert.equal(await usdc.read.balanceOf([mode.address]), usdcModeBefore);
  });

  it("EmptySettlementNote on setSettlementNote empty bytes", async () => {
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, parseEther("1")], {
      account: owner.account,
    });
    await assert.rejects(
      mode.write.setSettlementNote([TOKEN, "0x"], { account: owner.account }),
      revertsWith("EmptySettlementNote"),
    );
  });

  it("InvalidCurrencyCode when registering USD as a feed", async () => {
    await assert.rejects(
      mode.write.setCurrencyFeed([currencyCode("USD"), nativeFeed.address, DEFAULT_FEED_TOLERANCE], {
        account: owner.account,
      }),
      revertsWith("InvalidCurrencyCode"),
    );
  });

  it("InvalidFeed / InvalidFeedDecimals on approvePaymentToken", async () => {
    const tok = await viem.deployContract("MockERC20Decimals", ["T", "T", 18]);
    await assert.rejects(
      mode.write.approvePaymentToken([tok.address, owner.account.address, DEFAULT_FEED_TOLERANCE], {
        account: owner.account,
      }),
      revertsWith("InvalidFeed"),
    );
    const badDec = await viem.deployContract("MockV3Aggregator", [18, ETH_USD_1E8]);
    await assert.rejects(
      mode.write.approvePaymentToken([tok.address, badDec.address, DEFAULT_FEED_TOLERANCE], {
        account: owner.account,
      }),
      revertsWith("InvalidFeedDecimals"),
    );
  });

  // ---- G3 pause + G4 UUPS ----

  it("G3: guardian pauses; only owner unpauses; stranger cannot; setGuardian onlyOwner", async () => {
    await assert.rejects(
      mode.write.pause({ account: stranger.account }),
      revertsWith("NotGuardian"),
    );
    await mode.write.pause({ account: guardian.account });
    assert.equal(await mode.read.paused(), true);
    await assert.rejects(
      mode.write.unpause({ account: guardian.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );
    await assert.rejects(
      mode.write.unpause({ account: stranger.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );
    await mode.write.unpause({ account: owner.account });
    assert.equal(await mode.read.paused(), false);

    await assert.rejects(
      mode.write.setGuardian([stranger.account.address], { account: stranger.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );
    await mode.write.setGuardian([stranger.account.address], { account: owner.account });
    assert.equal(
      ((await mode.read.guardian()) as string).toLowerCase(),
      stranger.account.address.toLowerCase(),
    );
  });

  it("platformFeeBps snapshot: direct buy uses open fee after live force", async () => {
    await deployStack(true);
    const price = parseEther("1");
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, price], { account: owner.account });
    await mode.write.forceSetPlatformFeeBps([1000]);
    assert.equal(await mode.read.platformFeeBps(), 1000);
    const platformBefore = await publicClient.getBalance({ address: platform.account.address });
    await mode.write.buy([TOKEN], { account: buyer.account, value: price });
    const platformAfter = await publicClient.getBalance({ address: platform.account.address });
    assert.equal(platformAfter - platformBefore, (price * PLATFORM_FEE_BPS) / 10_000n);
  });

  it("platformFeeBps snapshot: commission buy uses open fee after live force", async () => {
    await deployStack(true);
    const price = parseEther("1");
    const floor = parseEther("0.5");
    await mintAndApprove(TOKEN);
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, floor, COMP_COMMISSION_500],
      { account: owner.account },
    );
    await mode.write.openFromMandate([TOKEN, DENOM_ASSET, price], { account: agent.account });
    await mode.write.forceSetPlatformFeeBps([1000]);
    const platformBefore = await publicClient.getBalance({ address: platform.account.address });
    const agentBefore = await publicClient.getBalance({ address: agent.account.address });
    await mode.write.buy([TOKEN], { account: buyer.account, value: price });
    const platformAfter = await publicClient.getBalance({ address: platform.account.address });
    const agentAfter = await publicClient.getBalance({ address: agent.account.address });
    const agentCut = (price * 500n) / 10_000n;
    assert.equal(platformAfter - platformBefore, (price * PLATFORM_FEE_BPS) / 10_000n);
    assert.equal(agentAfter - agentBefore, agentCut);
  });

  it("platformFeeBps snapshot: margin buy uses open fee after live force", async () => {
    await deployStack(true);
    const price = parseEther("1");
    const floor = parseEther("0.8");
    await mintAndApprove(TOKEN);
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, floor, COMP_MARGIN],
      { account: owner.account },
    );
    await mode.write.openFromMandate([TOKEN, DENOM_ASSET, price], { account: agent.account });
    await mode.write.forceSetPlatformFeeBps([1000]);
    const platformBefore = await publicClient.getBalance({ address: platform.account.address });
    const ownerBefore = await publicClient.getBalance({ address: owner.account.address });
    await mode.write.buy([TOKEN], { account: buyer.account, value: price });
    const platformAfter = await publicClient.getBalance({ address: platform.account.address });
    const ownerAfter = await publicClient.getBalance({ address: owner.account.address });
    assert.equal(platformAfter - platformBefore, (price * PLATFORM_FEE_BPS) / 10_000n);
    assert.equal(ownerAfter - ownerBefore, floor);
  });

  it("G3: pause blocks open + buy; confirmExternalPayment and withdrawClaim still work", async () => {
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, parseEther("1")], {
      account: owner.account,
    });
    await mode.write.pause({ account: guardian.account });

    const token2 = 2n;
    await mintAndApprove(token2);
    await assert.rejects(
      mode.write.openDirect([token2, DENOM_ASSET, ZERO, parseEther("1")], {
        account: owner.account,
      }),
      revertsWith("ContractPaused"),
    );
    await assert.rejects(
      mode.write.buy([TOKEN], { account: buyer.account, value: parseEther("1") }),
      revertsWith("ContractPaused"),
    );

    await mode.write.setSettlementNote([TOKEN, stringToHex("wire")], {
      account: owner.account,
    });
    await mode.write.confirmExternalPayment([TOKEN, buyer.account.address], {
      account: owner.account,
    });
    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      buyer.account.address.toLowerCase(),
    );

    await mode.write.unpause({ account: owner.account });
    await mode.write.openDirect([token2, DENOM_ASSET, ZERO, parseEther("1")], {
      account: owner.account,
    });
    await mode.write.buy([token2], { account: buyer.account, value: parseEther("1") });
  });

  it("G4: owner upgrade preserves live consignment; non-owner cannot upgrade", async () => {
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, parseEther("2")], {
      account: owner.account,
    });
    const priceBefore = (await mode.read.consignmentPriceOf([TOKEN])) as bigint;

    const nextImpl = await viem.deployContract("FixedPriceConsignment", []);
    await assert.rejects(
      mode.write.upgradeToAndCall([nextImpl.address, "0x"], { account: stranger.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );
    await mode.write.upgradeToAndCall([nextImpl.address, "0x"], { account: owner.account });
    assert.equal(await mode.read.VERSION(), "2.4.0-rc.1");
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 1);
    assert.equal(await mode.read.consignmentPriceOf([TOKEN]), priceBefore);
    void modeImpl;
  });

  // ---- Encumbrance registration gate + G3 revoke ----

  it("ModeNotEncumbranceSource: direct and mandate open refuse when unregistered", async () => {
    await passport.write.setEncumbranceSource([mode.address, false]);
    await mintAndApprove(TOKEN);
    await assert.rejects(
      mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, parseEther("1")], {
        account: owner.account,
      }),
      revertsWith("ModeNotEncumbranceSource"),
    );
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, parseEther("0.5"), COMP_MARGIN],
      { account: owner.account },
    );
    await assert.rejects(
      mode.write.openFromMandate([TOKEN, DENOM_ASSET, parseEther("1")], {
        account: agent.account,
      }),
      revertsWith("ModeNotEncumbranceSource"),
    );
  });

  it("open succeeds once registered; refused again after source removed", async () => {
    await passport.write.setEncumbranceSource([mode.address, false]);
    await mintAndApprove(TOKEN);
    await assert.rejects(
      mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, parseEther("1")], {
        account: owner.account,
      }),
      revertsWith("ModeNotEncumbranceSource"),
    );
    await passport.write.setEncumbranceSource([mode.address, true]);
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, parseEther("1")], {
      account: owner.account,
    });
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 1);
    await mode.write.ownerWithdraw([TOKEN], { account: owner.account });

    await passport.write.setEncumbranceSource([mode.address, false]);
    const token2 = TOKEN + 1n;
    await mintAndApprove(token2);
    await assert.rejects(
      mode.write.openDirect([token2, DENOM_ASSET, ZERO, parseEther("1")], {
        account: owner.account,
      }),
      revertsWith("ModeNotEncumbranceSource"),
    );
  });

  it("live consignment still buys after encumbrance source removed", async () => {
    const price = parseEther("1");
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, price], { account: owner.account });
    await passport.write.setEncumbranceSource([mode.address, false]);
    await mode.write.buy([TOKEN], { account: buyer.account, value: price });
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 2);
    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      buyer.account.address.toLowerCase(),
    );
  });

  it("G3 revoke: guardian can revoke, cannot approve; mid-sale buy still settles", async () => {
    const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
    const usdcFeed = await admitWithUsdFeed(usdc.address);

    await assert.rejects(
      mode.write.approvePaymentToken([usdc.address, usdcFeed.address, DEFAULT_FEED_TOLERANCE], {
        account: guardian.account,
      }),
      revertsWith("OwnableUnauthorizedAccount"),
    );
    await assert.rejects(
      mode.write.revokePaymentToken([usdc.address], { account: stranger.account }),
      revertsWith("NotGuardianOrOwner"),
    );

    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_USD, usdc.address, FIAT_100_USD], {
      account: owner.account,
    });
    await mode.write.revokePaymentToken([usdc.address], { account: guardian.account });
    const cfg = (await mode.read.paymentTokens([usdc.address])) as
      | { feed: string; decimals: number; enabled: boolean }
      | readonly [string, number, boolean];
    const enabled = Array.isArray(cfg) ? cfg[2] : cfg.enabled;
    const decimals = Array.isArray(cfg) ? cfg[1] : cfg.decimals;
    assert.equal(enabled, false);
    assert.equal(Number(decimals), 6);

    const quote = (await mode.read.quoteBuy([TOKEN])) as bigint;
    assert.equal(quote, 100n * 10n ** 6n);
    await usdc.write.mint([buyer.account.address, quote]);
    await usdc.write.approve([mode.address, quote], { account: buyer.account });
    await mode.write.buy([TOKEN], { account: buyer.account });
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 2);

    // New open in revoked asset refused.
    const token2 = TOKEN + 1n;
    await mintAndApprove(token2);
    await assert.rejects(
      mode.write.openDirect([token2, DENOM_USD, usdc.address, FIAT_100_USD], {
        account: owner.account,
      }),
      revertsWith("PaymentTokenNotSupported"),
    );

    // Owner can re-approve with same feed (monotonic) and revoke.
    await mode.write.approvePaymentToken([usdc.address, usdcFeed.address, DEFAULT_FEED_TOLERANCE], {
      account: owner.account,
    });
    await mode.write.revokePaymentToken([usdc.address], { account: owner.account });
    const afterOwnerRevoke = (await mode.read.paymentTokens([usdc.address])) as
      | { enabled: boolean }
      | readonly unknown[];
    assert.equal(
      Array.isArray(afterOwnerRevoke) ? afterOwnerRevoke[2] : afterOwnerRevoke.enabled,
      false,
    );
  });

  describe("accountability event surface (args vs chain state)", () => {
    async function lastEvent(eventName: string) {
      const logs = await publicClient.getContractEvents({
        address: mode.address,
        abi: mode.abi,
        eventName: eventName as "ConsignmentOpened",
        fromBlock: 0n,
        toBlock: "latest",
      });
      assert.ok(logs.length > 0, `expected ${eventName}`);
      return logs[logs.length - 1]!;
    }

    it("ConsignmentOpened matches open storage; buy emits SplitPaid + Closed Sold", async () => {
      const price = parseEther("1");
      await mintAndApprove(TOKEN);
      await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, price], { account: owner.account });
      const opened = await lastEvent("ConsignmentOpened");
      const a = opened.args as {
        tokenId: bigint;
        seller: string;
        price: bigint;
        platformFeeBps: number;
        openedAt: bigint;
      };
      assert.equal(a.tokenId, TOKEN);
      assert.equal(a.seller.toLowerCase(), owner.account.address.toLowerCase());
      assert.equal(a.price, price);
      assert.equal(BigInt(a.platformFeeBps), PLATFORM_FEE_BPS);
      assert.equal(a.openedAt, await mode.read.consignmentOpenedAt([TOKEN]));
      assert.equal(await mode.read.consignmentPriceOf([TOKEN]), price);

      await mode.write.buy([TOKEN], { account: buyer.account, value: price });
      const split = await lastEvent("ConsignmentSplitPaid");
      const s = split.args as {
        tokenId: bigint;
        ownerAmount: bigint;
        platformAmount: bigint;
        agentAmount: bigint;
      };
      const platformShare = (price * PLATFORM_FEE_BPS) / 10_000n;
      assert.equal(s.tokenId, TOKEN);
      assert.equal(s.platformAmount, platformShare);
      assert.equal(s.ownerAmount, price - platformShare);
      assert.equal(s.agentAmount, 0n);

      const closed = await lastEvent("ConsignmentClosed");
      assert.equal((closed.args as { reason: number }).reason, 1); // Sold
      assert.equal(await mode.read.consignmentPhase([TOKEN]), 2); // Closed
    });

    it("ConsignmentPriceSet matches storage after setPrice", async () => {
      await mintAndApprove(TOKEN);
      await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, parseEther("1")], {
        account: owner.account,
      });
      await mode.write.setPrice([TOKEN, parseEther("2")], { account: owner.account });
      const priced = await lastEvent("ConsignmentPriceSet");
      const p = priced.args as { tokenId: bigint; setter: string; newPrice: bigint };
      assert.equal(p.tokenId, TOKEN);
      assert.equal(p.setter.toLowerCase(), owner.account.address.toLowerCase());
      assert.equal(p.newPrice, parseEther("2"));
      assert.equal(await mode.read.consignmentPriceOf([TOKEN]), p.newPrice);
    });
  });

  // ---- PA1: undeliverable split legs become claims (buy → _paySplit → _payNative) ----

  /** Direct (and Margin platform leg): platform-first remainder. */
  function directSplitLegs(price: bigint) {
    const platformLeg = (price * PLATFORM_FEE_BPS) / 10_000n;
    return { platformLeg, agentLeg: 0n, ownerLeg: price - platformLeg };
  }

  /** Commission (S32): platform = ⌊S·p/B⌋ first; owner = ⌊S·(B−p−c)/B⌋; agent = residual. */
  function commissionSplitLegs(price: bigint, commissionBps: bigint) {
    const BPS = 10_000n;
    const platformLeg = (price * PLATFORM_FEE_BPS) / BPS;
    const cut = PLATFORM_FEE_BPS + commissionBps;
    const ownerLeg = cut >= BPS ? 0n : (price * (BPS - cut)) / BPS;
    const agentLeg = price - platformLeg - ownerLeg;
    return { platformLeg, agentLeg, ownerLeg };
  }

  async function mintToContract(
    tokenId: bigint,
    seller: DeployedContract,
  ) {
    await passport.write.mint([seller.address, tokenId], { account: owner.account });
    await passport.write.setMay([tokenId, INTENT_OPEN, true]);
    await seller.write.approvePassport([passport.address, mode.address, true]);
  }

  it("PA1: reverting owner leg credits claim; withdraw after accept", async () => {
    const price = parseEther("1");
    const { platformLeg, ownerLeg } = directSplitLegs(price);
    const seller = await viem.deployContract("RevertingRecipient", []);
    await seller.write.setAcceptEth([false]);

    await mintToContract(TOKEN, seller);
    await seller.write.openFixedDirect([
      mode.address,
      TOKEN,
      0,
      BYTES32_ZERO,
      ZERO,
      price,
    ]);

    const platformBefore = await publicClient.getBalance({ address: platform.account.address });
    await mode.write.buy([TOKEN], { account: buyer.account, value: price });

    assert.equal(getAddress(await passport.read.ownerOf([TOKEN])), getAddress(buyer.account.address));
    assert.equal(await mode.read.pendingClaims([seller.address, ZERO]), ownerLeg);
    assert.equal(await mode.read.totalPendingNative(), ownerLeg);
    assert.equal(
      (await publicClient.getBalance({ address: platform.account.address })) - platformBefore,
      platformLeg,
    );

    await seller.write.setAcceptEth([true]);
    await seller.write.withdrawClaim([mode.address, ZERO]);
    assert.equal(await mode.read.pendingClaims([seller.address, ZERO]), 0n);
    assert.equal(await mode.read.totalPendingNative(), 0n);
  });

  it("PA1: reverting agent leg credits claim; withdraw after accept", async () => {
    const price = parseEther("1");
    const commissionBps = 500n;
    const { platformLeg, agentLeg, ownerLeg } = commissionSplitLegs(price, commissionBps);
    const agentSink = await viem.deployContract("RevertingRecipient", []);
    await agentSink.write.setAcceptEth([false]);

    await mintAndApprove(TOKEN);
    await mode.write.grant(
      [
        TOKEN,
        agentSink.address,
        0n,
        ZERO,
        DENOM_ASSET,
        price / 2n,
        { form: 1, commissionBps: Number(commissionBps) },
      ],
      { account: owner.account },
    );
    await agentSink.write.openFixedFromMandate([
      mode.address,
      TOKEN,
      0,
      BYTES32_ZERO,
      price,
    ]);

    const ownerBefore = await publicClient.getBalance({ address: owner.account.address });
    const platformBefore = await publicClient.getBalance({ address: platform.account.address });
    await mode.write.buy([TOKEN], { account: buyer.account, value: price });

    assert.equal(getAddress(await passport.read.ownerOf([TOKEN])), getAddress(buyer.account.address));
    assert.equal(await mode.read.pendingClaims([agentSink.address, ZERO]), agentLeg);
    assert.equal(await mode.read.totalPendingNative(), agentLeg);
    assert.equal(
      (await publicClient.getBalance({ address: owner.account.address })) - ownerBefore,
      ownerLeg,
    );
    assert.equal(
      (await publicClient.getBalance({ address: platform.account.address })) - platformBefore,
      platformLeg,
    );

    await agentSink.write.setAcceptEth([true]);
    await agentSink.write.withdrawClaim([mode.address, ZERO]);
    assert.equal(await mode.read.pendingClaims([agentSink.address, ZERO]), 0n);
    assert.equal(await mode.read.totalPendingNative(), 0n);
  });

  it("PA1: reverting platform leg credits claim; withdraw after accept", async () => {
    const price = parseEther("1");
    const { platformLeg, ownerLeg } = directSplitLegs(price);
    const platformSink = await viem.deployContract("RevertingRecipient", []);
    await platformSink.write.setAcceptEth([false]);

    const deployed = await deployFixedPriceConsignment(viem, {
      passport: passport.address,
      platformRecipient: platformSink.address,
      feeBps: PLATFORM_FEE_BPS,
      nativeUsdFeed: nativeFeed.address,
      nativeUsdStalenessTolerance: DEFAULT_FEED_TOLERANCE,
      owner: owner.account.address,
      guardian: guardian.account.address,
    });
    mode = deployed.mode;

    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, price], { account: owner.account });

    const ownerBefore = await publicClient.getBalance({ address: owner.account.address });
    await mode.write.buy([TOKEN], { account: buyer.account, value: price });

    assert.equal(getAddress(await passport.read.ownerOf([TOKEN])), getAddress(buyer.account.address));
    assert.equal(await mode.read.pendingClaims([platformSink.address, ZERO]), platformLeg);
    assert.equal(await mode.read.totalPendingNative(), platformLeg);
    assert.equal(
      (await publicClient.getBalance({ address: owner.account.address })) - ownerBefore,
      ownerLeg,
    );

    await platformSink.write.setAcceptEth([true]);
    await platformSink.write.withdrawClaim([mode.address, ZERO]);
    assert.equal(await mode.read.pendingClaims([platformSink.address, ZERO]), 0n);
    assert.equal(await mode.read.totalPendingNative(), 0n);
  });

  it("PA1: all three legs reverting credit exact claims; withdraw each", async () => {
    const price = parseEther("1");
    const commissionBps = 500n;
    const { platformLeg, agentLeg, ownerLeg } = commissionSplitLegs(price, commissionBps);
    assert.equal(platformLeg + agentLeg + ownerLeg, price);

    const seller = await viem.deployContract("RevertingRecipient", []);
    const agentSink = await viem.deployContract("RevertingRecipient", []);
    const platformSink = await viem.deployContract("RevertingRecipient", []);
    await seller.write.setAcceptEth([false]);
    await agentSink.write.setAcceptEth([false]);
    await platformSink.write.setAcceptEth([false]);

    const deployed = await deployFixedPriceConsignment(viem, {
      passport: passport.address,
      platformRecipient: platformSink.address,
      feeBps: PLATFORM_FEE_BPS,
      nativeUsdFeed: nativeFeed.address,
      nativeUsdStalenessTolerance: DEFAULT_FEED_TOLERANCE,
      owner: owner.account.address,
      guardian: guardian.account.address,
    });
    mode = deployed.mode;

    await mintToContract(TOKEN, seller);
    await seller.write.grantFixed([
      mode.address,
      TOKEN,
      agentSink.address,
      0n,
      ZERO,
      0,
      BYTES32_ZERO,
      price / 2n,
      1,
      Number(commissionBps),
    ]);
    await agentSink.write.openFixedFromMandate([
      mode.address,
      TOKEN,
      0,
      BYTES32_ZERO,
      price,
    ]);

    await mode.write.buy([TOKEN], { account: buyer.account, value: price });

    assert.equal(getAddress(await passport.read.ownerOf([TOKEN])), getAddress(buyer.account.address));
    assert.equal(await mode.read.pendingClaims([seller.address, ZERO]), ownerLeg);
    assert.equal(await mode.read.pendingClaims([agentSink.address, ZERO]), agentLeg);
    assert.equal(await mode.read.pendingClaims([platformSink.address, ZERO]), platformLeg);
    assert.equal(await mode.read.totalPendingNative(), price);

    await seller.write.setAcceptEth([true]);
    await agentSink.write.setAcceptEth([true]);
    await platformSink.write.setAcceptEth([true]);
    await seller.write.withdrawClaim([mode.address, ZERO]);
    await agentSink.write.withdrawClaim([mode.address, ZERO]);
    await platformSink.write.withdrawClaim([mode.address, ZERO]);

    assert.equal(await mode.read.pendingClaims([seller.address, ZERO]), 0n);
    assert.equal(await mode.read.pendingClaims([agentSink.address, ZERO]), 0n);
    assert.equal(await mode.read.pendingClaims([platformSink.address, ZERO]), 0n);
    assert.equal(await mode.read.totalPendingNative(), 0n);
  });

  // ---- Payment-token admission refusals ----

  async function paymentTokenEnabled(token: `0x${string}`): Promise<boolean> {
    const cfg = (await mode.read.paymentTokens([token])) as {
      enabled: boolean;
    };
    // Public mapping returns tuple or object depending on viem decode.
    if (typeof cfg === "object" && cfg !== null && "enabled" in cfg) {
      return Boolean(cfg.enabled);
    }
    const row = cfg as unknown as readonly [string, number, boolean];
    return Boolean(row[2]);
  }

  it("TokenHasNoCode on approvePaymentToken; retry still refuses; conforming admits", async () => {
    const eoa = stranger.account.address;
    await assert.rejects(
      mode.write.approvePaymentToken([eoa, ZERO, 0], { account: owner.account }),
      revertsWith("TokenHasNoCode"),
    );
    assert.equal(await paymentTokenEnabled(eoa), false);
    await assert.rejects(
      mode.write.approvePaymentToken([eoa, ZERO, 0], { account: owner.account }),
      revertsWith("TokenHasNoCode"),
    );

    const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
    await mode.write.approvePaymentToken([usdc.address, ZERO, 0], { account: owner.account });
    assert.equal(await paymentTokenEnabled(usdc.address), true);
  });

  it("TokenDecimalsUnavailable on approvePaymentToken; retry still refuses", async () => {
    const bad = await viem.deployContract("NoDecimalsErc20", []);
    await assert.rejects(
      mode.write.approvePaymentToken([bad.address, ZERO, 0], { account: owner.account }),
      revertsWith("TokenDecimalsUnavailable"),
    );
    assert.equal(await paymentTokenEnabled(bad.address), false);
    await assert.rejects(
      mode.write.approvePaymentToken([bad.address, ZERO, 0], { account: owner.account }),
      revertsWith("TokenDecimalsUnavailable"),
    );
  });

  it("StalePrice at admit when payment-token feed is stale; retry still refuses until fresh", async () => {
    const tok = await viem.deployContract("MockERC20Decimals", ["T", "T", 18]);
    const feed = await viem.deployContract("MockV3Aggregator", [8, ETH_USD_1E8]);
    await increaseTime(publicClient, MAX_STALENESS + 1n);

    await assert.rejects(
      mode.write.approvePaymentToken([tok.address, feed.address, DEFAULT_FEED_TOLERANCE], { account: owner.account }),
      revertsWith("StalePrice"),
    );
    assert.equal(await paymentTokenEnabled(tok.address), false);
    await assert.rejects(
      mode.write.approvePaymentToken([tok.address, feed.address, DEFAULT_FEED_TOLERANCE], { account: owner.account }),
      revertsWith("StalePrice"),
    );

    await feed.write.setAnswer([ETH_USD_1E8]);
    await mode.write.approvePaymentToken([tok.address, feed.address, DEFAULT_FEED_TOLERANCE], { account: owner.account });
    assert.equal(await paymentTokenEnabled(tok.address), true);
  });

  // ---- Per-feed staleness ----

  describe("per-feed staleness", () => {
    function abiFunctionNames(): string[] {
      const artifact = JSON.parse(
        readFileSync(
          path.join(
            repoRoot,
            "artifacts/contracts/FixedPriceConsignment.sol/FixedPriceConsignment.json",
          ),
          "utf8",
        ),
      ) as { abi: Array<{ type?: string; name?: string }> };
      return artifact.abi
        .filter((item) => item.type === "function" && item.name)
        .map((item) => item.name as string);
    }

    it("ABI exposes per-feed tolerance only (no global maxFeedStaleness)", () => {
      const names = abiFunctionNames();
      assert.ok(!names.includes("maxFeedStaleness"));
      assert.ok(!names.includes("setMaxFeedStaleness"));
      assert.ok(names.includes("nativeUsdStalenessTolerance"));
      assert.ok(names.includes("setNativeUsdStalenessTolerance"));
    });

    it("feed within its own tolerance quotes", async () => {
      const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
      await admitWithUsdFeed(usdc.address);
      await mintAndApprove(TOKEN);
      await mode.write.openDirect([TOKEN, DENOM_USD, usdc.address, FIAT_100_USD], {
        account: owner.account,
      });
      await increaseTime(publicClient, MAX_STALENESS - 100n);
      assert.equal(await mode.read.quoteBuy([TOKEN]), 100n * 10n ** 6n);
    });

    it("same feed beyond its tolerance refuses with StalePrice", async () => {
      await mintAndApprove(TOKEN);
      await mode.write.openDirect([TOKEN, DENOM_USD, ZERO, FIAT_100_USD], {
        account: owner.account,
      });
      await increaseTime(publicClient, MAX_STALENESS + 1n);
      await assert.rejects(mode.read.quoteBuy([TOKEN]), revertsWith("StalePrice"));
    });

    it("two payment tokens with different tolerances behave independently", async () => {
      const tokA = await viem.deployContract("MockERC20Decimals", ["A", "A", 18]);
      const tokB = await viem.deployContract("MockERC20Decimals", ["B", "B", 18]);
      const feedA = await viem.deployContract("MockV3Aggregator", [8, USDC_USD_1E8]);
      const feedB = await viem.deployContract("MockV3Aggregator", [8, USDC_USD_1E8]);
      const tolA = DEFAULT_FEED_TOLERANCE;
      const tolB = DEFAULT_FEED_TOLERANCE * 2;
      await mode.write.approvePaymentToken([tokA.address, feedA.address, tolA], {
        account: owner.account,
      });
      await mode.write.approvePaymentToken([tokB.address, feedB.address, tolB], {
        account: owner.account,
      });

      const tokenA = TOKEN;
      const tokenB = TOKEN + 1n;
      await mintAndApprove(tokenA);
      await mintAndApprove(tokenB);
      await mode.write.openDirect([tokenA, DENOM_USD, tokA.address, FIAT_100_USD], {
        account: owner.account,
      });
      await mode.write.openDirect([tokenB, DENOM_USD, tokB.address, FIAT_100_USD], {
        account: owner.account,
      });

      await increaseTime(publicClient, BigInt(tolA) + 1n);
      await assert.rejects(mode.read.quoteBuy([tokenA]), revertsWith("StalePrice"));
      assert.equal(await mode.read.quoteBuy([tokenB]), 100n * 10n ** 18n);

      await increaseTime(publicClient, BigInt(tolB - tolA));
      await assert.rejects(mode.read.quoteBuy([tokenB]), revertsWith("StalePrice"));
    });

    it("FeedStalenessOutOfBounds at admission (below MIN and above MAX)", async () => {
      const tok = await viem.deployContract("MockERC20Decimals", ["T", "T", 18]);
      const feed = await viem.deployContract("MockV3Aggregator", [8, USDC_USD_1E8]);
      await assert.rejects(
        mode.write.approvePaymentToken([tok.address, feed.address, MIN_FEED_STALENESS - 1], {
          account: owner.account,
        }),
        revertsWith("FeedStalenessOutOfBounds"),
      );
      await assert.rejects(
        mode.write.approvePaymentToken([tok.address, feed.address, MAX_FEED_STALENESS_BOUND + 1], {
          account: owner.account,
        }),
        revertsWith("FeedStalenessOutOfBounds"),
      );
    });

    it("StalenessWithoutFeed / ZeroFeedStaleness: feed and tolerance pairing", async () => {
      const tok = await viem.deployContract("MockERC20Decimals", ["T", "T", 18]);
      const feed = await viem.deployContract("MockV3Aggregator", [8, USDC_USD_1E8]);
      await assert.rejects(
        mode.write.approvePaymentToken([tok.address, ZERO, DEFAULT_FEED_TOLERANCE], {
          account: owner.account,
        }),
        revertsWith("StalenessWithoutFeed"),
      );
      await assert.rejects(
        mode.write.approvePaymentToken([tok.address, feed.address, 0], { account: owner.account }),
        revertsWith("ZeroFeedStaleness"),
      );
      await mode.write.approvePaymentToken([tok.address, ZERO, 0], { account: owner.account });
      assert.equal(await paymentTokenEnabled(tok.address), true);
    });
  });

  // ---- P4: measured feed for fiat; feedless asset-only; monotonic feed ----

  it("P4: zero-feed admission proceeds; fiat open refused; asset denom opens and settles", async () => {
    const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
    await mode.write.approvePaymentToken([usdc.address, ZERO, 0], { account: owner.account });
    assert.equal(await paymentTokenEnabled(usdc.address), true);

    await mintAndApprove(TOKEN);
    await assert.rejects(
      mode.write.openDirect([TOKEN, DENOM_USD, usdc.address, FIAT_100_USD], {
        account: owner.account,
      }),
      revertsWith("PaymentTokenFeedRequired"),
    );

    const assetPrice = 500n * 10n ** 6n;
    await mode.write.openDirect([TOKEN, DENOM_ASSET, usdc.address, assetPrice], {
      account: owner.account,
    });
    assert.equal(await mode.read.quoteBuy([TOKEN]), assetPrice);
    await usdc.write.mint([buyer.account.address, assetPrice]);
    await usdc.write.approve([mode.address, assetPrice], { account: buyer.account });
    await mode.write.buy([TOKEN], { account: buyer.account });
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 2);
    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      buyer.account.address.toLowerCase(),
    );
  });

  it("P4: fiat with fed token quotes via oracle; clearing feed refused; open lot not repriced", async () => {
    const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
    const usdcFeed = await admitWithUsdFeed(usdc.address);

    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_USD, usdc.address, FIAT_100_USD], {
      account: owner.account,
    });
    assert.equal(await mode.read.quoteBuy([TOKEN]), 100n * 10n ** 6n);

    await assert.rejects(
      mode.write.approvePaymentToken([usdc.address, ZERO, 0], { account: owner.account }),
      revertsWith("CannotClearPaymentTokenFeed"),
    );
    const cfg = (await mode.read.paymentTokens([usdc.address])) as
      | { feed: string }
      | readonly [string, number, boolean];
    const feedAddr = Array.isArray(cfg) ? cfg[0] : cfg.feed;
    assert.equal(getAddress(feedAddr as string), getAddress(usdcFeed.address));
    assert.equal(await mode.read.quoteBuy([TOKEN]), 100n * 10n ** 6n);
  });

  it("P4: quote refuses when payment-token feed cleared (no parity) or unusable", async () => {
    await deployStack(true); // harness can force-clear feed after open
    const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
    const usdcFeed = await admitWithUsdFeed(usdc.address);

    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_USD, usdc.address, FIAT_100_USD], {
      account: owner.account,
    });
    assert.equal(await mode.read.quoteBuy([TOKEN]), 100n * 10n ** 6n);

    await usdcFeed.write.setAnswer([0n]);
    await assert.rejects(mode.read.quoteBuy([TOKEN]), revertsWith("BadOracleAnswer"));
    await usdcFeed.write.setAnswer([USDC_USD_1E8]);
    assert.equal(await mode.read.quoteBuy([TOKEN]), 100n * 10n ** 6n);

    await increaseTime(publicClient, MAX_STALENESS + 1n);
    await assert.rejects(mode.read.quoteBuy([TOKEN]), revertsWith("StalePrice"));
    await usdcFeed.write.setAnswer([USDC_USD_1E8]);
    assert.equal(await mode.read.quoteBuy([TOKEN]), 100n * 10n ** 6n);

    await mode.write.forceSetPaymentTokenFeed([usdc.address, ZERO, 0]);
    await assert.rejects(mode.read.quoteBuy([TOKEN]), revertsWith("PaymentTokenFeedRequired"));
  });

  it("P4: source has no USD-stable parity branch", () => {
    const src = readFileSync(
      path.join(repoRoot, "contracts/FixedPriceConsignment.sol"),
      "utf8",
    );
    assert.ok(!src.includes("USD-stable"), "NatSpec must not describe USD-stable peg");
    assert.ok(
      !src.includes("(usd1e8 * scale) / _FIAT_SCALE"),
      "parity math branch must be gone",
    );
    assert.ok(src.includes("PaymentTokenFeedRequired"));
    assert.ok(src.includes("CannotClearPaymentTokenFeed"));
  });

  describe("S36 ShortDelivery on ERC-20 buy", () => {
    it("fee-on-transfer token reverts ShortDelivery; custody and phase unchanged", async () => {
      const feeToken = await viem.deployContract("MockFeeToken", [1000n]); // 10%
      await mode.write.approvePaymentToken([feeToken.address, ZERO, 0], { account: owner.account });

      const price = 1_000_000n;
      await mintAndApprove(TOKEN);
      await mode.write.openDirect([TOKEN, DENOM_ASSET, feeToken.address, price], {
        account: owner.account,
      });

      await feeToken.write.mint([buyer.account.address, price]);
      await feeToken.write.approve([mode.address, price], { account: buyer.account });

      await assert.rejects(
        mode.write.buy([TOKEN], { account: buyer.account }),
        revertsWith("ShortDelivery"),
      );

      assert.equal(await mode.read.consignmentPhase([TOKEN]), 1); // still Offered
      assert.equal(
        ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
        mode.address.toLowerCase(),
      );
      assert.equal(await feeToken.read.balanceOf([mode.address]), 0n);
    });

    it("zero-fee ERC-20 buy still settles at requested amount", async () => {
      const feeToken = await viem.deployContract("MockFeeToken", [0n]);
      await mode.write.approvePaymentToken([feeToken.address, ZERO, 0], { account: owner.account });

      const price = 1_000_000n;
      await mintAndApprove(TOKEN);
      await mode.write.openDirect([TOKEN, DENOM_ASSET, feeToken.address, price], {
        account: owner.account,
      });

      await feeToken.write.mint([buyer.account.address, price]);
      await feeToken.write.approve([mode.address, price], { account: buyer.account });
      await mode.write.buy([TOKEN], { account: buyer.account });

      assert.equal(await mode.read.consignmentPhase([TOKEN]), 2);
      assert.equal(await feeToken.read.balanceOf([mode.address]), 0n); // paid out in split
    });
  });
});
