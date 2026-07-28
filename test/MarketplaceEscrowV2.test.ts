import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress, stringToHex, toHex } from "viem";

import {
  CURRENCY_USD,
  deployEscrowStack,
  deployMarketplaceViaProxy,
  deployPassportStack,
  deployTimelock,
  joinVerifier,
  mintPassport,
  NATIVE_USD_8D,
  receiptLogs,
} from "../scripts/lib/local-stack.js";
const CURRENCY_EUR = stringToHex("EUR", { size: 32 });

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    return err.message.includes(errorName);
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
      revertsWith("MarketplaceNotApproved"),
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

  it("reverting platformRecipient blocks buyWithNative", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployPassportStack(viem);
    const usdc = await viem.deployContract("MockUSDC", []);
    const nativeFeed = await viem.deployContract("ChainlinkV3TestFeed", [8, NATIVE_USD_8D]);
    const timelock = await deployTimelock(viem, stack.admin.account.address);
    // Known limitation: immutable platformRecipient that reverts on ETH blocks all native sales.
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
    const gross = await marketplace.read.quoteBuyWithNative([tokenId]);
    await assert.rejects(
      marketplace.write.buyWithNative([tokenId], { account: buyer.account, value: gross }),
      revertsWith("TransferFailed"),
    );
    assert.equal(await marketplace.read.isListed([tokenId]), true);
    void publicClient;
  });

  it("reverting seller blocks settlement; NFT stays in escrow", async () => {
    const { viem } = connection;
    const { seller, buyer, passport, marketplace } = await deployEscrowStack(viem);
    const helper = await viem.deployContract("SelfDestructSender", []);
    const tokenId = await mintPassport(passport, seller, helper.address, "ar://reject-seller");
    const price = 100n * 10n ** 8n;
    await helper.write.approveAndList(
      [passport.address, marketplace.address, tokenId, price, CURRENCY_USD],
    );
    const gross = await marketplace.read.quoteBuyWithNative([tokenId]);
    await assert.rejects(
      marketplace.write.buyWithNative([tokenId], { account: buyer.account, value: gross }),
      revertsWith("TransferFailed"),
    );
    assert.equal(await marketplace.read.isListed([tokenId]), true);
    assert.equal(
      getAddress(await passport.read.ownerOf([tokenId])),
      getAddress(marketplace.address),
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

  it("VERSION is 2.1.0-rc.1", async () => {
    const { viem } = connection;
    const { marketplace } = await deployEscrowStack(viem);
    assert.equal(await marketplace.read.VERSION(), "2.1.0-rc.1");
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

  it("owner revokeAgent while listed reverts AgentAuthorizationActive not NotOwner", async () => {
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
      revertsWith("AgentAuthorizationActive"),
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
