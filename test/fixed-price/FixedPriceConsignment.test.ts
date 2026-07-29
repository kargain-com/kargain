import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { parseEther, stringToHex, padHex } from "viem";

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
const ETH_USD_1E8 = 2_000n * 10n ** 8n; // $2000
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
      maxFeedStaleness: MAX_STALENESS,
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

  beforeEach(async () => {
    await deployStack(false);
  });

  it("VERSION matches CONTRACT_VERSIONS", async () => {
    assert.equal(await mode.read.VERSION(), "2.1.0-rc.1");
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
        0n,
        owner.account.address,
        guardian.account.address,
      ],
    });
    await assert.rejects(
      viem.deployContract("ERC1967Proxy", [impl.address, initData]),
      revertsWith("ZeroFeedStaleness"),
    );
  });

  it("setMaxFeedStaleness: owner updates live window; zero reverts", async () => {
    await assert.rejects(
      mode.write.setMaxFeedStaleness([0n], { account: owner.account }),
      revertsWith("ZeroFeedStaleness"),
    );
    await mode.write.setMaxFeedStaleness([MAX_STALENESS * 2n], { account: owner.account });
    assert.equal(await mode.read.maxFeedStaleness(), MAX_STALENESS * 2n);
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
    await mode.write.approvePaymentToken([usdc.address, ZERO], { account: owner.account });

    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_USD, usdc.address, FIAT_100_USD], {
      account: owner.account,
    });

    const quote = (await mode.read.quoteBuy([TOKEN])) as bigint;
    // $100 pegged @ 6 decimals → 100e6
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
    await mode.write.approvePaymentToken([dai.address, ZERO], { account: owner.account });

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

  it("asset-denom ERC-20: PaymentTokenNotSupported when not admitted", async () => {
    const tok = await viem.deployContract("MockERC20Decimals", ["T", "T", 18]);
    await mintAndApprove(TOKEN);
    await mode.write.openDirect([TOKEN, DENOM_ASSET, tok.address, 1_000n], {
      account: owner.account,
    });
    await assert.rejects(mode.read.quoteBuy([TOKEN]), revertsWith("PaymentTokenNotSupported"));
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
    await mode.write.approvePaymentToken([usdc.address, ZERO], { account: owner.account });

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
    await mode.write.approvePaymentToken([usdc.address, ZERO], { account: owner.account });
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
      mode.write.setCurrencyFeed([currencyCode("USD"), nativeFeed.address], {
        account: owner.account,
      }),
      revertsWith("InvalidCurrencyCode"),
    );
  });

  it("InvalidFeed / InvalidFeedDecimals on approvePaymentToken", async () => {
    const tok = await viem.deployContract("MockERC20Decimals", ["T", "T", 18]);
    await assert.rejects(
      mode.write.approvePaymentToken([tok.address, owner.account.address], {
        account: owner.account,
      }),
      revertsWith("InvalidFeed"),
    );
    const badDec = await viem.deployContract("MockV3Aggregator", [18, ETH_USD_1E8]);
    await assert.rejects(
      mode.write.approvePaymentToken([tok.address, badDec.address], {
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
    assert.equal(await mode.read.VERSION(), "2.1.0-rc.1");
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 1);
    assert.equal(await mode.read.consignmentPriceOf([TOKEN]), priceBefore);
    void modeImpl;
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
});
