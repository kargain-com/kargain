import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { encodeFunctionData, getAddress, stringToHex, toHex } from "viem";

import {
  CURRENCY_USD,
  deployEscrowStack,
  deployMarketplaceViaProxy,
  deployPassportStack,
  deployTimelock,
  increaseTime,
  joinVerifier,
  mintPassport,
  NATIVE_USD_8D,
  receiptLogs,
  ZERO,
} from "../scripts/lib/local-stack.js";
const CURRENCY_EUR = stringToHex("EUR", { size: 32 });
const CURRENCY_NATIVE = stringToHex("NATIVE", { size: 32 });
const MAX_FEE_BPS = 1000n;
const MAX_AGENT_FEE_BPS = 3000;

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    if (err.message.includes(errorName)) return true;
    if (errorName === "TransferFailed" && err.message.includes("0x90b8ec18")) return true;
    if (errorName === "NoClaim" && err.message.includes("0x9b0e91e1")) return true;
    if (errorName === "TokenHasNoCode" && err.message.includes("0x72a73200")) return true;
    if (errorName === "TokenNonConforming" && err.message.includes("0xda440b93")) return true;
    return false;
  };
}

describe("MarketplaceEscrow v2 — currency registry", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("USD and NATIVE list without feed registration", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://u");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    const listing = await marketplace.read.listings([tokenId]);
    assert.equal(listing[2], true);
  });

  it("unregistered currency reverts CurrencyNotAvailableOnChain", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://eur");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await assert.rejects(
      marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_EUR], { account: seller.account }),
      revertsWith("CurrencyNotAvailableOnChain"),
    );
  });

  it("setCurrencyFeed registers live feed", async () => {
    const { viem } = connection;
    const { admin, seller, passport, marketplace, nativeFeed } = await deployEscrowStack(viem);
    const eurFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, 110n * 10n ** 8n]);
    await marketplace.write.setCurrencyFeed([CURRENCY_EUR, eurFeed.address], { account: admin.account });
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://eur");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 200n * 10n ** 8n, CURRENCY_EUR], { account: seller.account });
    const gross = await marketplace.read.quoteBuyWithNative([tokenId]);
    assert.ok(gross > 0n);
    void nativeFeed;
  });

  it("receive() reverts DirectEthNotAccepted", async () => {
    const { viem } = connection;
    const { buyer, marketplace } = await deployEscrowStack(viem);
    await assert.rejects(
      buyer.sendTransaction({ to: marketplace.address, value: 1n }),
      revertsWith("DirectEthNotAccepted"),
    );
  });
});

describe("MarketplaceEscrow v2 — agent model", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("authorizeAgent requires marketplace approval", async () => {
    const { viem } = connection;
    const { seller, verifier, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://agent");
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
    await assert.rejects(
      marketplace.write.authorizeAgent([tokenId, verifier.account.address, expiry, 0n], {
        account: seller.account,
      }),
      revertsWith("EscrowNotApproved"),
    );
  });

  it("agent listing enforces ownerMinPrice", async () => {
    const { viem } = connection;
    const { seller, verifier, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://agent");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
    const min = 900n * 10n ** 8n;
    await marketplace.write.authorizeAgent([tokenId, verifier.account.address, expiry, min], {
      account: seller.account,
    });
    await assert.rejects(
      marketplace.write.listOnBehalf(
        [tokenId, 1000n * 10n ** 8n, CURRENCY_USD, 2000, "0x"],
        { account: verifier.account },
      ),
      revertsWith("BelowOwnerMinPrice"),
    );
  });

  it("expiry 0 allows listOnBehalf without expiration", async () => {
    const { viem } = connection;
    const { seller, verifier, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://no-expiry");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.authorizeAgent([tokenId, verifier.account.address, 0n, 0n], {
      account: seller.account,
    });
    await marketplace.write.listOnBehalf(
      [tokenId, 500n * 10n ** 8n, CURRENCY_USD, 500, "0x"],
      { account: verifier.account },
    );
    assert.equal(await marketplace.read.isListed([tokenId]), true);
  });

  it("agent listing uses platform fee without verifier discount", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, seller, buyer, verifier, passport, marketplace, feeBps, proFeeBps, staking } =
      await deployEscrowStack(viem);
    await joinVerifier(staking, seller);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://agent-buy");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
    await marketplace.write.authorizeAgent([tokenId, verifier.account.address, expiry, 0n], {
      account: seller.account,
    });
    const price = 1000n * 10n ** 8n;
    await marketplace.write.listOnBehalf(
      [tokenId, price, CURRENCY_USD, 1000, "0x"],
      { account: verifier.account },
    );
    const gross = await marketplace.read.quoteBuyWithNative([tokenId]);
    const adminBefore = await publicClient.getBalance({ address: admin.account.address });
    await marketplace.write.buyWithNative([tokenId], { account: buyer.account, value: gross });
    const platformFee = (gross * feeBps) / 10_000n;
    const proFee = (gross * proFeeBps) / 10_000n;
    const adminAfter = await publicClient.getBalance({ address: admin.account.address });
    assert.equal(adminAfter - adminBefore, platformFee);
    assert.notEqual(platformFee, proFee);
  });
});

describe("MarketplaceEscrow v2 — pause and external payment", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("setPaused blocks list", async () => {
    const { viem } = connection;
    const { admin, seller, passport, marketplace } = await deployEscrowStack(viem);
    await marketplace.write.setPaused([true], { account: admin.account });
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://pause");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await assert.rejects(
      marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], { account: seller.account }),
      revertsWith("ContractPaused"),
    );
  });

  it("confirmExternalPayment transfers NFT with settlement note", async () => {
    const { viem } = connection;
    const { seller, buyer, verifier, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://ext");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
    await marketplace.write.authorizeAgent([tokenId, verifier.account.address, expiry, 0n], {
      account: seller.account,
    });
    const note = "0xdeadbeef";
    await marketplace.write.listOnBehalf(
      [tokenId, 500n * 10n ** 8n, CURRENCY_USD, 500, note],
      { account: verifier.account },
    );
    await marketplace.write.confirmExternalPayment([tokenId, buyer.account.address], {
      account: verifier.account,
    });
    assert.equal(
      getAddress(await passport.read.ownerOf([tokenId])),
      getAddress(buyer.account.address),
    );
  });

  it("isListed returns active state", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://listed");
    assert.equal(await marketplace.read.isListed([tokenId]), false);
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    assert.equal(await marketplace.read.isListed([tokenId]), true);
  });
});

describe("MarketplaceEscrow v2 — buyWithToken", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("buyWithToken settles USDC", async () => {
    const { viem } = connection;
    const { admin, seller, buyer, passport, usdc, marketplace, feeBps } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://usdc");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    const usd1e8 = 200n * 10n ** 8n;
    await marketplace.write.list([tokenId, usd1e8, CURRENCY_USD], { account: seller.account });
    const gross = await marketplace.read.quoteBuyWithToken([tokenId, usdc.address]);
    await usdc.write.mint([buyer.account.address, gross]);
    await usdc.write.approve([marketplace.address, gross], { account: buyer.account });
    const adminBefore = await usdc.read.balanceOf([admin.account.address]);
    await marketplace.write.buyWithToken([tokenId, usdc.address], { account: buyer.account });
    const fee = (gross * feeBps) / 10_000n;
    const adminAfter = await usdc.read.balanceOf([admin.account.address]);
    assert.equal(adminAfter - adminBefore, fee);
  });
});

describe("MarketplaceEscrow v2 — audit fixes", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  async function agentListed(
    viem: Awaited<ReturnType<typeof hardhat.network.connect>>["viem"],
    agentFeeBps = 100,
    ownerMin = 0n,
  ) {
    const stack = await deployEscrowStack(viem);
    const tokenId = await mintPassport(
      stack.passport,
      stack.seller,
      stack.seller.account.address,
      "ar://audit",
    );
    await stack.passport.write.setApprovalForAll([stack.marketplace.address, true], {
      account: stack.seller.account,
    });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
    await stack.marketplace.write.authorizeAgent(
      [tokenId, stack.verifier.account.address, expiry, ownerMin],
      { account: stack.seller.account },
    );
    await stack.marketplace.write.listOnBehalf(
      [tokenId, 1000n * 10n ** 8n, CURRENCY_USD, agentFeeBps, "0x"],
      { account: stack.verifier.account },
    );
    return { ...stack, tokenId };
  }

  it("double requestReturn reverts ReturnAlreadyRequested", async () => {
    const { viem } = connection;
    const { seller, marketplace, tokenId } = await agentListed(viem);
    await marketplace.write.requestReturn([tokenId], { account: seller.account });
    const requestedAt = (await marketplace.read.returnRequestedAt([tokenId])) as bigint;
    assert.ok(requestedAt > 0n);
    await assert.rejects(
      marketplace.write.requestReturn([tokenId], { account: seller.account }),
      revertsWith("ReturnAlreadyRequested"),
    );
    assert.equal(await marketplace.read.returnRequestedAt([tokenId]), requestedAt);
  });

  it("reverting platformRecipient credits claim; sale completes", async () => {
    const { viem } = connection;
    const stack = await deployPassportStack(viem);
    const usdc = await viem.deployContract("MockUSDC", []);
    const nativeFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
    const timelock = await deployTimelock(viem, stack.admin.account.address);
    const { marketplace } = await deployMarketplaceViaProxy(viem, {
      karPassport: stack.passport.address,
      usdc: usdc.address,
      nativeFeed: nativeFeed.address,
      karProStaking: stack.staking.address,
      platformRecipient: usdc.address,
      feeBps: 250n,
      proFeeBps: 100n,
      maxStale: 3600n,
      timelock: timelock.address,
      genesisAuthority: stack.admin.account.address,
    });
    const seller = stack.owner;
    const buyer = stack.verifier;
    const tokenId = await mintPassport(stack.passport, seller, seller.account.address, "ar://fee-dos");
    await stack.passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    const gross = (await marketplace.read.quoteBuyWithNative([tokenId])) as bigint;
    await marketplace.write.buyWithNative([tokenId], { account: buyer.account, value: gross });
    assert.equal(await marketplace.read.isListed([tokenId]), false);
    const platformFee = (gross * 250n) / 10_000n;
    assert.equal(await marketplace.read.pendingClaims([usdc.address, ZERO]), platformFee);
    assert.equal(
      getAddress(await stack.passport.read.ownerOf([tokenId])),
      getAddress(buyer.account.address),
    );
  });

  it("reverting seller credits claim; NFT transfers to buyer", async () => {
    const { viem } = connection;
    const { seller, buyer, passport, marketplace, feeBps } = await deployEscrowStack(viem);
    const helper = await viem.deployContract("SelfDestructSender", []);
    const tokenId = await mintPassport(passport, seller, helper.address, "ar://reject-seller");
    const price = 100n * 10n ** 8n;
    await helper.write.approveAndList(
      [passport.address, marketplace.address, tokenId, price, CURRENCY_USD],
    );
    const gross = (await marketplace.read.quoteBuyWithNative([tokenId])) as bigint;
    await marketplace.write.buyWithNative([tokenId], { account: buyer.account, value: gross });
    assert.equal(await marketplace.read.isListed([tokenId]), false);
    const platformFee = (gross * feeBps) / 10_000n;
    const net = gross - platformFee;
    assert.equal(await marketplace.read.pendingClaims([helper.address, ZERO]), net);
    assert.equal(
      getAddress(await passport.read.ownerOf([tokenId])),
      getAddress(buyer.account.address),
    );
  });

  it("withdrawClaim with no balance reverts NoClaim", async () => {
    const { viem } = connection;
    const { marketplace, stranger } = await deployEscrowStack(viem);
    await assert.rejects(
      marketplace.write.withdrawClaim([ZERO], { account: stranger.account }),
      revertsWith("NoClaim"),
    );
  });

  it("withdrawClaim while recipient still rejects reverts TransferFailed", async () => {
    const { viem } = connection;
    const stack = await deployPassportStack(viem);
    const usdc = await viem.deployContract("MockUSDC", []);
    const nativeFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
    const timelock = await deployTimelock(viem, stack.admin.account.address);
    const recipient = await viem.deployContract("RevertingRecipient", []);
    const { marketplace } = await deployMarketplaceViaProxy(viem, {
      karPassport: stack.passport.address,
      usdc: usdc.address,
      nativeFeed: nativeFeed.address,
      karProStaking: stack.staking.address,
      platformRecipient: recipient.address,
      feeBps: 250n,
      proFeeBps: 100n,
      maxStale: 3600n,
      timelock: timelock.address,
      genesisAuthority: stack.admin.account.address,
    });
    const seller = stack.owner;
    const buyer = stack.verifier;
    const tokenId = await mintPassport(stack.passport, seller, seller.account.address, "ar://tf");
    await stack.passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], {
      account: seller.account,
    });
    const gross = (await marketplace.read.quoteBuyWithNative([tokenId])) as bigint;
    await marketplace.write.buyWithNative([tokenId], { account: buyer.account, value: gross });
    assert.ok(((await marketplace.read.pendingClaims([recipient.address, ZERO])) as bigint) > 0n);
    await assert.rejects(
      recipient.write.withdrawClaim([marketplace.address, ZERO]),
      revertsWith("TransferFailed"),
    );
  });

  it("gas-burning platformRecipient credits claim; sale completes; withdraw works", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployPassportStack(viem);
    const usdc = await viem.deployContract("MockUSDC", []);
    const nativeFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
    const timelock = await deployTimelock(viem, stack.admin.account.address);
    const burner = await viem.deployContract("GasBurningRecipient", []);
    const { marketplace } = await deployMarketplaceViaProxy(viem, {
      karPassport: stack.passport.address,
      usdc: usdc.address,
      nativeFeed: nativeFeed.address,
      karProStaking: stack.staking.address,
      platformRecipient: burner.address,
      feeBps: 250n,
      proFeeBps: 100n,
      maxStale: 3600n,
      timelock: timelock.address,
      genesisAuthority: stack.admin.account.address,
    });
    const seller = stack.owner;
    const buyer = stack.verifier;
    const tokenId = await mintPassport(stack.passport, seller, seller.account.address, "ar://gas");
    await stack.passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], {
      account: seller.account,
    });
    const gross = (await marketplace.read.quoteBuyWithNative([tokenId])) as bigint;
    await marketplace.write.buyWithNative([tokenId], { account: buyer.account, value: gross });
    const platformFee = (gross * 250n) / 10_000n;
    assert.equal(await marketplace.read.pendingClaims([burner.address, ZERO]), platformFee);
    const balance = await publicClient.getBalance({ address: marketplace.address });
    assert.ok(balance >= ((await marketplace.read.totalPendingNative()) as bigint));
    await burner.write.setAcceptEth([true]);
    await burner.write.withdrawClaim([marketplace.address, ZERO]);
    assert.equal(await marketplace.read.pendingClaims([burner.address, ZERO]), 0n);
  });

  it("approvePaymentToken rejects no-code and non-conforming tokens", async () => {
    const { viem } = connection;
    const { admin, stranger, marketplace } = await deployEscrowStack(viem);
    await assert.rejects(
      marketplace.write.approvePaymentToken([stranger.account.address, ZERO], {
        account: admin.account,
      }),
      revertsWith("TokenHasNoCode"),
    );
    const bad = await viem.deployContract("NonConformingErc20", []);
    await assert.rejects(
      marketplace.write.approvePaymentToken([bad.address, ZERO], { account: admin.account }),
      revertsWith("TokenNonConforming"),
    );
  });

  it("approvePaymentToken rejects zero token", async () => {
    const { viem } = connection;
    const { admin, marketplace } = await deployEscrowStack(viem);
    await assert.rejects(
      marketplace.write.approvePaymentToken([ZERO, ZERO], { account: admin.account }),
      revertsWith("ZeroAddress"),
    );
  });

  it("agent can update fees between quote and purchase", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { seller, stranger, verifier, marketplace, feeBps, tokenId } = await agentListed(viem, 100);
    const gross = await marketplace.read.quoteBuyWithNative([tokenId]);
    await marketplace.write.updateListing([tokenId, 1000n * 10n ** 8n, 3000], {
      account: verifier.account,
    });
    const agentBefore = await publicClient.getBalance({ address: verifier.account.address });
    const sellerBefore = await publicClient.getBalance({ address: seller.account.address });
    await marketplace.write.buyWithNative([tokenId], { account: stranger.account, value: gross });
    const agentFee = (gross * 3000n) / 10_000n;
    const platformFee = (gross * BigInt(feeBps)) / 10_000n;
    const sellerNet = gross - agentFee - platformFee;
    const agentAfter = await publicClient.getBalance({ address: verifier.account.address });
    const sellerAfter = await publicClient.getBalance({ address: seller.account.address });
    assert.equal(agentAfter - agentBefore, agentFee);
    assert.equal(sellerAfter - sellerBefore, sellerNet);
    assert.ok(agentFee > (gross * 100n) / 10_000n);
  });

  it("setSettlementNote enables confirmExternalPayment for direct listing", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { seller, buyer, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://direct");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 500n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    const note = toHex(new TextEncoder().encode("lightning:lnbc..."));
    const setHash = await marketplace.write.setSettlementNote([tokenId, note], {
      account: seller.account,
    });
    const setLogs = await receiptLogs(publicClient, setHash, marketplace.abi);
    assert.ok(setLogs.some((l) => l.eventName === "SettlementNoteSet"));
    const confirmHash = await marketplace.write.confirmExternalPayment(
      [tokenId, buyer.account.address],
      { account: seller.account },
    );
    const confirmLogs = await receiptLogs(publicClient, confirmHash, marketplace.abi);
    assert.ok(confirmLogs.some((l) => l.eventName === "ExternalPaymentConfirmed"));
    assert.equal(
      getAddress(await passport.read.ownerOf([tokenId])),
      getAddress(buyer.account.address),
    );
    assert.equal(await marketplace.read.isListed([tokenId]), false);
  });

  it("setSettlementNote reverts for inactive listing", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://inactive");
    await assert.rejects(
      marketplace.write.setSettlementNote([tokenId, "0x01"], { account: seller.account }),
      revertsWith("NotActive"),
    );
  });

  it("setSettlementNote reverts for non-seller", async () => {
    const { viem } = connection;
    const { seller, stranger, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://not-seller");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    await assert.rejects(
      marketplace.write.setSettlementNote([tokenId, "0x01"], { account: stranger.account }),
      revertsWith("NotSeller"),
    );
  });

  it("confirmExternalPayment on direct listing without note reverts", async () => {
    const { viem } = connection;
    const { seller, buyer, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://no-note");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    await assert.rejects(
      marketplace.write.confirmExternalPayment([tokenId, buyer.account.address], {
        account: seller.account,
      }),
      revertsWith("EmptySettlementNote"),
    );
  });

  it("forceReturn before requestReturn reverts ReturnNotRequested", async () => {
    const { viem } = connection;
    const { seller, marketplace, tokenId } = await agentListed(viem);
    await assert.rejects(
      marketplace.write.forceReturn([tokenId], { account: seller.account }),
      revertsWith("ReturnNotRequested"),
    );
  });

  it("list with bytes32(0) currency reverts CurrencyNotAvailableOnChain", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://zero-currency");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    const zeroCurrency = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
    await assert.rejects(
      marketplace.write.list([tokenId, 100n * 10n ** 8n, zeroCurrency], { account: seller.account }),
      revertsWith("CurrencyNotAvailableOnChain"),
    );
  });

  it("authorizeAgent with past expiry — listOnBehalf reverts", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { seller, verifier, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://expired");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    const block = await publicClient.getBlock();
    const pastExpiry = block.timestamp - 1n;
    await marketplace.write.authorizeAgent(
      [tokenId, verifier.account.address, pastExpiry, 0n],
      { account: seller.account },
    );
    await assert.rejects(
      marketplace.write.listOnBehalf(
        [tokenId, 500n * 10n ** 8n, CURRENCY_USD, 500, "0x"],
        { account: verifier.account },
      ),
      revertsWith("AgentNotAuthorized"),
    );
  });
});

describe("MarketplaceEscrow v2 — guard order and AlreadyListed", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("VERSION is 2.2.0-rc.1", async () => {
    const { viem } = connection;
    const { marketplace } = await deployEscrowStack(viem);
    assert.equal(await marketplace.read.VERSION(), "2.2.0-rc.1");
  });

  it("list on already-listed token reverts AlreadyListed", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://dbl");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    await assert.rejects(
      marketplace.write.list([tokenId, 200n * 10n ** 8n, CURRENCY_USD], { account: seller.account }),
      revertsWith("AlreadyListed"),
    );
  });

  it("owner authorizeAgent while listed reverts AlreadyListed not NotOwner", async () => {
    const { viem } = connection;
    const { seller, verifier, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://auth-listed");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
    await assert.rejects(
      marketplace.write.authorizeAgent([tokenId, verifier.account.address, expiry, 0n], {
        account: seller.account,
      }),
      revertsWith("AlreadyListed"),
    );
  });

  it("owner revokeAgent while listed reverts AlreadyListed not NotOwner", async () => {
    const { viem } = connection;
    const { seller, verifier, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://rev-listed");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
    await marketplace.write.authorizeAgent([tokenId, verifier.account.address, expiry, 0n], {
      account: seller.account,
    });
    await marketplace.write.listOnBehalf(
      [tokenId, 1000n * 10n ** 8n, CURRENCY_USD, 100, "0x"],
      { account: verifier.account },
    );
    await assert.rejects(
      marketplace.write.revokeAgent([tokenId], { account: seller.account }),
      revertsWith("AlreadyListed"),
    );
  });

  it("stranger authorizeAgent when not listed reverts NotOwner", async () => {
    const { viem } = connection;
    const { seller, stranger, verifier, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://stranger");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
    await assert.rejects(
      marketplace.write.authorizeAgent([tokenId, verifier.account.address, expiry, 0n], {
        account: stranger.account,
      }),
      revertsWith("NotOwner"),
    );
  });

  it("stranger revokeAgent when not listed reverts NotOwner", async () => {
    const { viem } = connection;
    const { seller, stranger, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://stranger-rev");
    await assert.rejects(
      marketplace.write.revokeAgent([tokenId], { account: stranger.account }),
      revertsWith("NotOwner"),
    );
  });
});

describe("MarketplaceEscrow — error coverage matrix", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  async function agentListed(
    viem: Awaited<ReturnType<typeof hardhat.network.connect>>["viem"],
    opts: { agentFeeBps?: number; ownerMin?: bigint; price?: bigint } = {},
  ) {
    const stack = await deployEscrowStack(viem);
    const tokenId = await mintPassport(
      stack.passport,
      stack.seller,
      stack.seller.account.address,
      "ar://err-matrix",
    );
    await stack.passport.write.setApprovalForAll([stack.marketplace.address, true], {
      account: stack.seller.account,
    });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
    const ownerMin = opts.ownerMin ?? 0n;
    await stack.marketplace.write.authorizeAgent(
      [tokenId, stack.verifier.account.address, expiry, ownerMin],
      { account: stack.seller.account },
    );
    const price = opts.price ?? 1000n * 10n ** 8n;
    const agentFeeBps = opts.agentFeeBps ?? 100;
    await stack.marketplace.write.listOnBehalf(
      [tokenId, price, CURRENCY_USD, agentFeeBps, "0x"],
      { account: stack.verifier.account },
    );
    return { ...stack, tokenId };
  }

  it("ZeroAddress — constructor rejects zero karPassport", async () => {
    const { viem } = connection;
    const stack = await deployPassportStack(viem);
    const nativeFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
    await assert.rejects(
      viem.deployContract("MarketplaceEscrow", [
        ZERO,
        nativeFeed.address,
        stack.staking.address,
        stack.admin.account.address,
        250n,
        100n,
        3600n,
      ]),
      revertsWith("ZeroAddress"),
    );
  });

  it("ZeroAddress — initialize rejects zero timelock", async () => {
    const { viem } = connection;
    const stack = await deployPassportStack(viem);
    const nativeFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
    const implementation = await viem.deployContract("MarketplaceEscrow", [
      stack.passport.address,
      nativeFeed.address,
      stack.staking.address,
      stack.admin.account.address,
      250n,
      100n,
      3600n,
    ]);
    const initData = encodeFunctionData({
      abi: implementation.abi,
      functionName: "initialize",
      args: [ZERO],
    });
    await assert.rejects(
      viem.deployContract("ERC1967Proxy", [implementation.address, initData]),
      revertsWith("ZeroAddress"),
    );
  });

  it("FeeTooHigh — constructor rejects feeBps over cap", async () => {
    const { viem } = connection;
    const stack = await deployPassportStack(viem);
    const nativeFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
    await assert.rejects(
      viem.deployContract("MarketplaceEscrow", [
        stack.passport.address,
        nativeFeed.address,
        stack.staking.address,
        stack.admin.account.address,
        MAX_FEE_BPS + 1n,
        100n,
        3600n,
      ]),
      revertsWith("FeeTooHigh"),
    );
  });

  it("NotUpgradeAuthority — non-authority setPaused", async () => {
    const { viem } = connection;
    const { seller, marketplace } = await deployEscrowStack(viem);
    await assert.rejects(
      marketplace.write.setPaused([true], { account: seller.account }),
      revertsWith("NotUpgradeAuthority"),
    );
  });

  it("PaymentTokenNotSupported — buyWithToken unapproved ERC-20", async () => {
    const { viem } = connection;
    const { seller, buyer, passport, marketplace } = await deployEscrowStack(viem);
    const other = await viem.deployContract("MockUSDC", []);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://bad-token");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], {
      account: seller.account,
    });
    await assert.rejects(
      marketplace.write.buyWithToken([tokenId, other.address], { account: buyer.account }),
      revertsWith("PaymentTokenNotSupported"),
    );
  });

  it("BadPrice — list with zero price", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://zero-price");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await assert.rejects(
      marketplace.write.list([tokenId, 0n, CURRENCY_USD], { account: seller.account }),
      revertsWith("BadPrice"),
    );
  });

  it("AgentFeeTooHigh — listOnBehalf fee over cap", async () => {
    const { viem } = connection;
    const { seller, verifier, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://fee-cap");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
    await marketplace.write.authorizeAgent([tokenId, verifier.account.address, expiry, 0n], {
      account: seller.account,
    });
    await assert.rejects(
      marketplace.write.listOnBehalf(
        [tokenId, 1000n * 10n ** 8n, CURRENCY_USD, MAX_AGENT_FEE_BPS + 1, "0x"],
        { account: verifier.account },
      ),
      revertsWith("AgentFeeTooHigh"),
    );
  });

  it("CannotRaiseMinPrice — seller raises owner min on agent listing", async () => {
    const { viem } = connection;
    const min = 500n * 10n ** 8n;
    const { seller, marketplace, tokenId } = await agentListed(viem, {
      ownerMin: min,
      price: 1000n * 10n ** 8n,
      agentFeeBps: 100,
    });
    await assert.rejects(
      marketplace.write.updateOwnerMinPrice([tokenId, min + 1n], { account: seller.account }),
      revertsWith("CannotRaiseMinPrice"),
    );
  });

  it("ListingHasAgent — seller delist when agent set", async () => {
    const { viem } = connection;
    const { seller, marketplace, tokenId } = await agentListed(viem);
    await assert.rejects(
      marketplace.write.delist([tokenId], { account: seller.account }),
      revertsWith("ListingHasAgent"),
    );
  });

  it("ReturnCooldownPending — forceReturn before cooldown ends", async () => {
    const { viem } = connection;
    const { seller, marketplace, tokenId } = await agentListed(viem);
    await marketplace.write.requestReturn([tokenId], { account: seller.account });
    await assert.rejects(
      marketplace.write.forceReturn([tokenId], { account: seller.account }),
      revertsWith("ReturnCooldownPending"),
    );
  });

  it("NotAgent — caller is not the agent (updateListing)", async () => {
    const { viem } = connection;
    const { stranger, marketplace, tokenId } = await agentListed(viem);
    await assert.rejects(
      marketplace.write.updateListing([tokenId, 1000n * 10n ** 8n, 100], {
        account: stranger.account,
      }),
      revertsWith("NotAgent"),
    );
  });

  it("NotAgent — caller is not the agent (agentDelist)", async () => {
    const { viem } = connection;
    const { stranger, marketplace, tokenId } = await agentListed(viem);
    await assert.rejects(
      marketplace.write.agentDelist([tokenId], { account: stranger.account }),
      revertsWith("NotAgent"),
    );
  });

  it("NoAgent — listing has no agent (updateOwnerMinPrice)", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://direct-min");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], {
      account: seller.account,
    });
    await assert.rejects(
      marketplace.write.updateOwnerMinPrice([tokenId, 50n * 10n ** 8n], {
        account: seller.account,
      }),
      revertsWith("NoAgent"),
    );
  });

  it("NoAgent — listing has no agent (requestReturn)", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://direct-ret");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], {
      account: seller.account,
    });
    await assert.rejects(
      marketplace.write.requestReturn([tokenId], { account: seller.account }),
      revertsWith("NoAgent"),
    );
  });

  it("NotSellerOrAgent — confirmExternalPayment by stranger", async () => {
    const { viem } = connection;
    const { seller, buyer, stranger, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://ext-auth");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], {
      account: seller.account,
    });
    await marketplace.write.setSettlementNote([tokenId, "0x01"], { account: seller.account });
    await assert.rejects(
      marketplace.write.confirmExternalPayment([tokenId, buyer.account.address], {
        account: stranger.account,
      }),
      revertsWith("NotSellerOrAgent"),
    );
  });

  it("InvalidFeed — setCurrencyFeed EOA with no code", async () => {
    const { viem } = connection;
    const { admin, stranger, marketplace } = await deployEscrowStack(viem);
    await assert.rejects(
      marketplace.write.setCurrencyFeed([CURRENCY_EUR, stranger.account.address], {
        account: admin.account,
      }),
      revertsWith("InvalidFeed"),
    );
  });

  it("InvalidFeedDecimals — setCurrencyFeed MockV3Aggregator non-8 decimals", async () => {
    const { viem } = connection;
    const { admin, marketplace } = await deployEscrowStack(viem);
    const badDecimals = await viem.deployContract("MockV3Aggregator", [18, 110n * 10n ** 8n]);
    await assert.rejects(
      marketplace.write.setCurrencyFeed([CURRENCY_EUR, badDecimals.address], {
        account: admin.account,
      }),
      revertsWith("InvalidFeedDecimals"),
    );
  });

  it("BadOracleAnswer — setCurrencyFeed ChainlinkV3TestFeed non-positive answer", async () => {
    const { viem } = connection;
    const { admin, marketplace } = await deployEscrowStack(viem);
    const badAnswer = await viem.deployContract("ChainlinkV3TestFeed", [8, 0n]);
    await assert.rejects(
      marketplace.write.setCurrencyFeed([CURRENCY_EUR, badAnswer.address], {
        account: admin.account,
      }),
      revertsWith("BadOracleAnswer"),
    );
  });

  it("StalePrice — quoteBuyWithNative after maxFeedStaleness", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://stale");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], {
      account: seller.account,
    });
    await increaseTime(publicClient, 3600n + 1n);
    await assert.rejects(marketplace.read.quoteBuyWithNative([tokenId]), revertsWith("StalePrice"));
  });

  it("BadOracleAnswer — quoteBuyWithNative after native feed setAnswer(0)", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace, nativeFeed } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://bad-oracle");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], {
      account: seller.account,
    });
    await nativeFeed.write.setAnswer([0n]);
    await assert.rejects(
      marketplace.read.quoteBuyWithNative([tokenId]),
      revertsWith("BadOracleAnswer"),
    );
  });
  it("WrongValue — buyWithNative wrong msg.value", async () => {
    const { viem } = connection;
    const { seller, buyer, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://wrong-value");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    const gross = await marketplace.read.quoteBuyWithNative([tokenId]);
    await assert.rejects(
      marketplace.write.buyWithNative([tokenId], { account: buyer.account, value: gross + 1n }),
      revertsWith("WrongValue"),
    );
  });

  it("ZeroAddress — confirmExternalPayment zero buyer", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://zero-buyer");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    const note = toHex(new TextEncoder().encode("pay offline"));
    await marketplace.write.setSettlementNote([tokenId, note], { account: seller.account });
    await assert.rejects(
      marketplace.write.confirmExternalPayment([tokenId, ZERO], { account: seller.account }),
      revertsWith("ZeroAddress"),
    );
  });

  it("ZeroAddress — authorizeAgent zero agent", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://zero-agent");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await assert.rejects(
      marketplace.write.authorizeAgent([tokenId, ZERO, 0n, 0n], { account: seller.account }),
      revertsWith("ZeroAddress"),
    );
  });

  it("InvalidCurrencyCode — setCurrencyFeed rejects NATIVE", async () => {
    const { viem } = connection;
    const { admin, stranger, marketplace } = await deployEscrowStack(viem);
    const eurFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
    await assert.rejects(
      marketplace.write.setCurrencyFeed([CURRENCY_NATIVE, eurFeed.address], { account: admin.account }),
      revertsWith("InvalidCurrencyCode"),
    );
    void stranger;
  });

  it("ZeroFeedStaleness — marketplace ctor rejects maxFeedStaleness 0", async () => {
    const { viem } = connection;
    const { passport, staking, admin } = await deployEscrowStack(viem);
    const nativeFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
    await assert.rejects(
      viem.deployContract("MarketplaceEscrow", [
        passport.address,
        nativeFeed.address,
        staking.address,
        admin.account.address,
        250n,
        100n,
        0n,
      ]),
      revertsWith("ZeroFeedStaleness"),
    );
  });

  it("TokenDecimalsUnavailable — approvePaymentToken rejects token without decimals()", async () => {
    const { viem } = connection;
    const { admin, marketplace } = await deployEscrowStack(viem);
    const noDec = await viem.deployContract("NoDecimalsErc20", []);
    await assert.rejects(
      marketplace.write.approvePaymentToken([noDec.address, ZERO], { account: admin.account }),
      revertsWith("TokenDecimalsUnavailable"),
    );
  });

  it("StalePrice — approvePaymentToken rejects stale feed at admission", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, marketplace } = await deployEscrowStack(viem);
    const feed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
    const token18 = await viem.deployContract("MockERC20Decimals", ["Eighteen", "E18", 18]);
    await increaseTime(publicClient, 3600n + 1n);
    await assert.rejects(
      marketplace.write.approvePaymentToken([token18.address, feed.address], {
        account: admin.account,
      }),
      revertsWith("StalePrice"),
    );
  });

  it("StalePrice — setCurrencyFeed rejects stale feed at admission", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, marketplace } = await deployEscrowStack(viem);
    const feed = await viem.deployContract("ChainlinkV3TestFeed", [8, 110n * 10n ** 8n]);
    await increaseTime(publicClient, 3600n + 1n);
    await assert.rejects(
      marketplace.write.setCurrencyFeed([CURRENCY_EUR, feed.address], { account: admin.account }),
      revertsWith("StalePrice"),
    );
  });
});

describe("MarketplaceEscrow — payment token decimals", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("quotes and settles an 18-decimal pegged stable (feed=0)", async () => {
    const { viem } = connection;
    const { admin, seller, buyer, passport, marketplace, feeBps } = await deployEscrowStack(viem);
    const token18 = await viem.deployContract("MockERC20Decimals", ["Stable18", "S18", 18]);
    await marketplace.write.approvePaymentToken([token18.address, ZERO], { account: admin.account });

    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://18");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    const usd1e8 = 100n * 10n ** 8n;
    await marketplace.write.list([tokenId, usd1e8, CURRENCY_USD], { account: seller.account });

    const gross = await marketplace.read.quoteBuyWithToken([tokenId, token18.address]);
    assert.equal(gross, 100n * 10n ** 18n);

    await token18.write.mint([buyer.account.address, gross]);
    await token18.write.approve([marketplace.address, gross], { account: buyer.account });
    const sellerBefore = await token18.read.balanceOf([seller.account.address]);
    await marketplace.write.buyWithToken([tokenId, token18.address], { account: buyer.account });
    const fee = (gross * feeBps) / 10_000n;
    const sellerAfter = await token18.read.balanceOf([seller.account.address]);
    assert.equal(sellerAfter - sellerBefore, gross - fee);
  });

  it("quotes an 8-decimal pegged stable (feed=0)", async () => {
    const { viem } = connection;
    const { admin, seller, passport, marketplace } = await deployEscrowStack(viem);
    const token8 = await viem.deployContract("MockERC20Decimals", ["Stable8", "S8", 8]);
    await marketplace.write.approvePaymentToken([token8.address, ZERO], { account: admin.account });

    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://8");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    await marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], { account: seller.account });

    const gross = await marketplace.read.quoteBuyWithToken([tokenId, token8.address]);
    assert.equal(gross, 100n * 10n ** 8n);
  });

  it("agent settle with ownerMin uses recorded 18-dec precision", async () => {
    const { viem } = connection;
    const {
      admin,
      seller,
      buyer,
      verifier,
      passport,
      marketplace,
      feeBps,
    } = await deployEscrowStack(viem);
    const token18 = await viem.deployContract("MockERC20Decimals", ["Stable18", "S18", 18]);
    await marketplace.write.approvePaymentToken([token18.address, ZERO], { account: admin.account });

    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://omin18");
    await passport.write.setApprovalForAll([marketplace.address, true], { account: seller.account });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
    // list-time 1e8 check: 1000 - 10% - 2.5% = 875 >= 500
    const ownerMin = 500n * 10n ** 8n;
    await marketplace.write.authorizeAgent(
      [tokenId, verifier.account.address, expiry, ownerMin],
      { account: seller.account },
    );
    await marketplace.write.listOnBehalf(
      [tokenId, 1000n * 10n ** 8n, CURRENCY_USD, 1000, "0x"],
      { account: verifier.account },
    );

    const gross = await marketplace.read.quoteBuyWithToken([tokenId, token18.address]);
    assert.equal(gross, 1000n * 10n ** 18n);
    await token18.write.mint([buyer.account.address, gross]);
    await token18.write.approve([marketplace.address, gross], { account: buyer.account });

    const sellerBefore = await token18.read.balanceOf([seller.account.address]);
    await marketplace.write.buyWithToken([tokenId, token18.address], { account: buyer.account });
    const agentFee = (gross * 1000n) / 10_000n;
    const platformFee = (gross * feeBps) / 10_000n;
    const sellerAfter = await token18.read.balanceOf([seller.account.address]);
    assert.equal(sellerAfter - sellerBefore, gross - agentFee - platformFee);
  });
});
