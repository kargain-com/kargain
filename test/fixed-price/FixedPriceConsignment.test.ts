import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { parseEther, stringToHex, padHex } from "viem";

import hardhat from "hardhat";
import { increaseTime, ZERO } from "../../scripts/lib/local-stack.js";

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

  async function deployStack(useHarness = false) {
    connection = await hardhat.network.connect();
    viem = connection.viem;
    publicClient = await viem.getPublicClient();
    const wallets = await viem.getWalletClients();
    [owner, agent, buyer, platform, stranger] = wallets;

    passport = await viem.deployContract("MockPassportEncumbrance", []);
    nativeFeed = await viem.deployContract("MockV3Aggregator", [8, ETH_USD_1E8]);

    const name = useHarness ? "FixedPriceConsignmentHarness" : "FixedPriceConsignment";
    mode = await viem.deployContract(name, [
      passport.address,
      platform.account.address,
      PLATFORM_FEE_BPS,
      nativeFeed.address,
      MAX_STALENESS,
      owner.account.address,
    ]);
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
    assert.equal(await mode.read.VERSION(), "1.0.0-rc.1");
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

  it("ZeroFeedStaleness on ctor", async () => {
    await assert.rejects(
      viem.deployContract("FixedPriceConsignment", [
        passport.address,
        platform.account.address,
        PLATFORM_FEE_BPS,
        nativeFeed.address,
        0n,
        owner.account.address,
      ]),
      revertsWith("ZeroFeedStaleness"),
    );
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
});
