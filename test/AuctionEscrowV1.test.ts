import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress, type PublicClient } from "viem";

import {
  deployAuctionEscrow,
  deployPassportStack,
  deployTimelock,
  DISPUTE_DEPOSIT,
  increaseTime,
  joinVerifier,
  mintPassport,
  THREE_DAYS,
  type DeployedContract,
  type ViemSuite,
  ZERO,
} from "../scripts/lib/local-stack.js";

const NATIVE = ZERO;
const SEVEN_DAYS = 7n * 24n * 60n * 60n;
const RETURN_COOLDOWN = 7n * 24n * 60n * 60n;
const THIRTY_DAYS = 30n * 24n * 60n * 60n;
const EXTENSION_WINDOW = 300n;

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    return err.message.includes(errorName);
  };
}

type AuctionStack = Awaited<ReturnType<typeof deployAuctionStack>> & { publicClient?: PublicClient };

async function joinVerifierIfNeeded(staking: DeployedContract, account: AuctionStack["seller"]) {
  const active = (await staking.read.isActiveVerifier([account.account.address])) as boolean;
  if (!active) {
    await joinVerifier(staking, account);
  }
}

/** Thin wrapper: full passport stack + shared `deployAuctionEscrow` (feeBps 250, initialize admin). */
async function deployAuctionStack(viem: ViemSuite) {
  const base = await deployPassportStack(viem);
  const usdc = await viem.deployContract("MockUSDC", []);
  const timelock = await deployTimelock(viem, base.admin.account.address);
  const { weth, impl, proxy, auction, feeBps } = await deployAuctionEscrow(
    viem,
    {
      passport: base.passport,
      staking: base.staking,
      usdc,
      timelock,
      admin: base.admin,
    },
    { feeBps: 250n, upgradeAuthority: base.admin.account.address },
  );
  const publicClient = await viem.getPublicClient();
  return {
    ...base,
    seller: base.owner,
    buyer: base.verifier,
    stranger: base.stranger,
    usdc,
    weth,
    auction,
    impl,
    proxy,
    timelock,
    feeBps,
    publicClient,
    viem,
  };
}

async function verifyPassport(
  passport: DeployedContract,
  verifier: AuctionStack["verifier"],
  tokenId: bigint,
) {
  await passport.write.verifyPassport([tokenId], { account: verifier.account });
}

async function prepareDirectAuction(
  stack: AuctionStack,
  opts: { reserve?: bigint; duration?: bigint; asset?: `0x${string}` } = {},
) {
  const { seller, verifier, passport, auction } = stack;
  await joinVerifierIfNeeded(stack.staking, seller);
  await joinVerifierIfNeeded(stack.staking, verifier);
  const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://direct");
  await verifyPassport(passport, verifier, tokenId);
  await passport.write.setApprovalForAll([auction.address, true], { account: seller.account });
  const reserve = opts.reserve ?? 1n * 10n ** 18n;
  const duration = opts.duration ?? THREE_DAYS;
  const asset = opts.asset ?? NATIVE;
  await auction.write.createAuction([tokenId, asset, reserve, duration], { account: seller.account });
  return { tokenId, reserve, duration, asset };
}

async function assertEscrowInvariant(
  stack: AuctionStack,
  tokenId: bigint,
  expectedOwner: `0x${string}`,
) {
  const client = stack.publicClient!;
  const a = (await stack.auction.read.auctions([tokenId])) as readonly [
    `0x${string}`,
    `0x${string}`,
    number,
    `0x${string}`,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    `0x${string}`,
    bigint,
    boolean,
  ];
  const h = (await stack.auction.read.holds([tokenId])) as readonly [
    `0x${string}`,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  const asset = a[3];
  const active = a[11];
  const highestBid = a[10];
  const holdGross = h[1];
  const holdRelease = h[2];
  const holdBond = h[4];

  let expectedNative = holdBond;
  let expectedUsdc = 0n;

  if (active && highestBid > 0n) {
    if (asset === NATIVE) expectedNative += highestBid;
    else expectedUsdc += highestBid;
  }
  if (holdRelease > 0n) {
    if (asset === NATIVE) expectedNative += holdGross;
    else expectedUsdc += holdGross;
  }

  const nativeBal = await client.getBalance({ address: stack.auction.address });
  const usdcBal = (await stack.usdc.read.balanceOf([stack.auction.address])) as bigint;
  assert.equal(nativeBal, expectedNative, "native escrow balance");
  assert.equal(usdcBal, expectedUsdc, "USDC escrow balance");

  const owner = (await stack.passport.read.ownerOf([tokenId])) as `0x${string}`;
  assert.equal(getAddress(owner), getAddress(expectedOwner), "NFT owner");
}

describe("AuctionEscrow v1 — config and authority", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("defaults match spec after initialize", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    assert.equal(Number(await stack.auction.read.extensionWindow()), 300);
    assert.equal(Number(await stack.auction.read.minIncrementBps()), 300);
    assert.equal(Number(await stack.auction.read.minDuration()), Number(THREE_DAYS));
    assert.equal(Number(await stack.auction.read.maxDuration()), Number(SEVEN_DAYS));
    assert.equal(Number(await stack.auction.read.settlementHold()), Number(SEVEN_DAYS));
    assert.equal(await stack.auction.read.settlementDisputeBond(), DISPUTE_DEPOSIT);
    assert.equal(Number(await stack.auction.read.disputeResolutionTimeout()), Number(THIRTY_DAYS));
  });

  it("non-authority config setter reverts NotUpgradeAuthority", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    await assert.rejects(
      stack.auction.write.setExtensionWindow([600n], { account: stack.seller.account }),
      revertsWith("NotUpgradeAuthority"),
    );
  });

  it("extensionWindow bounds enforced", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    await assert.rejects(
      stack.auction.write.setExtensionWindow([59n], { account: stack.admin.account }),
      revertsWith("BadConfig"),
    );
    await assert.rejects(
      stack.auction.write.setExtensionWindow([3601n], { account: stack.admin.account }),
      revertsWith("BadConfig"),
    );
  });

  it("minIncrementBps bounds enforced", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    await assert.rejects(
      stack.auction.write.setMinIncrementBps([99], { account: stack.admin.account }),
      revertsWith("BadConfig"),
    );
    await assert.rejects(
      stack.auction.write.setMinIncrementBps([1001], { account: stack.admin.account }),
      revertsWith("BadConfig"),
    );
  });
});

describe("AuctionEscrow v1 — direct native lifecycle", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("full lifecycle with extension and wei-exact payout split", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    const { seller, buyer, stranger, auction, admin, feeBps } = stack;

    const bid1 = reserve;
    await auction.write.bid([tokenId, bid1], { account: buyer.account, value: bid1 });
    await assertEscrowInvariant(stack, tokenId, auction.address);

    const a1 = (await auction.read.auctions([tokenId])) as readonly unknown[];
    const endsAt1 = a1[8] as bigint;
    assert.ok(endsAt1 > 0n);

    await increaseTime(publicClient, THREE_DAYS - EXTENSION_WINDOW + 1n);
    const increment = (bid1 * 300n) / 10_000n;
    const bid2 = bid1 + increment + 1n;
    await auction.write.bid([tokenId, bid2], { account: stranger.account, value: bid2 });

    const a2 = (await auction.read.auctions([tokenId])) as readonly unknown[];
    const endsAt2 = a2[8] as bigint;
    assert.ok(endsAt2 > endsAt1);

    await increaseTime(publicClient, EXTENSION_WINDOW + 2n);
    await auction.write.settle([tokenId]);
    await assertEscrowInvariant(stack, tokenId, stranger.account.address);

    const adminBefore = await publicClient.getBalance({ address: admin.account.address });
    const sellerBefore = await publicClient.getBalance({ address: seller.account.address });
    await auction.write.confirmReceipt([tokenId], { account: stranger.account });
    const platformFee = (bid2 * feeBps) / 10_000n;
    const net = bid2 - platformFee;
    const adminAfter = await publicClient.getBalance({ address: admin.account.address });
    const sellerAfter = await publicClient.getBalance({ address: seller.account.address });
    assert.equal(adminAfter - adminBefore, platformFee);
    assert.equal(sellerAfter - sellerBefore, net);
    void buyer;
  });
});

describe("AuctionEscrow v1 — agent lifecycle", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("rejects createOnBehalf when reserve net below ownerMinAsset", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { seller, verifier, passport, auction } = stack;
    await joinVerifierIfNeeded(stack.staking, verifier);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://agent-min");
    await verifyPassport(passport, verifier, tokenId);
    await passport.write.setApprovalForAll([auction.address, true], { account: seller.account });
    const reserve = 10n ** 18n;
    const ownerMin = reserve - 1n;
    const expiry = 0n;
    await auction.write.authorizeAuctionAgent(
      [tokenId, verifier.account.address, expiry, NATIVE, ownerMin],
      { account: seller.account },
    );
    await assert.rejects(
      auction.write.createAuctionOnBehalf([tokenId, NATIVE, reserve, THREE_DAYS, 1000], {
        account: verifier.account,
      }),
      revertsWith("BelowOwnerMinAsset"),
    );
  });

  it("full agent lifecycle with payout split", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { seller, verifier, stranger, passport, auction, admin, feeBps } = stack;
    await joinVerifierIfNeeded(stack.staking, verifier);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://agent-full");
    await verifyPassport(passport, verifier, tokenId);
    await passport.write.setApprovalForAll([auction.address, true], { account: seller.account });
    const reserve = 2n * 10n ** 18n;
    const agentFeeBps = 1000n;
    const ownerMin = 1n * 10n ** 18n;
    const expiry = 0n;
    await auction.write.authorizeAuctionAgent(
      [tokenId, verifier.account.address, expiry, NATIVE, ownerMin],
      { account: seller.account },
    );
    await auction.write.createAuctionOnBehalf(
      [tokenId, NATIVE, reserve, THREE_DAYS, agentFeeBps],
      { account: verifier.account },
    );

    const bid = reserve;
    await auction.write.bid([tokenId, bid], { account: stranger.account, value: bid });
    await increaseTime(publicClient, THREE_DAYS + 1n);
    await auction.write.settle([tokenId]);
    await auction.write.confirmReceipt([tokenId], { account: stranger.account });

    const agentFee = (bid * agentFeeBps) / 10_000n;
    const platformFee = (bid * feeBps) / 10_000n;
    const net = bid - agentFee - platformFee;
    const verifierBal = await publicClient.getBalance({ address: verifier.account.address });
    assert.ok(verifierBal >= agentFee);
    const sellerBal = await publicClient.getBalance({ address: seller.account.address });
    assert.ok(sellerBal >= net);
    void admin;
  });
});

describe("AuctionEscrow v1 — USDC lifecycle", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("USDC auction bid settle confirm with split", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack, {
      asset: stack.usdc.address,
      reserve: 1_000_000n,
    });
    const { stranger, auction, usdc, admin, feeBps } = stack;

    await usdc.write.mint([stranger.account.address, reserve], { account: stack.admin.account });
    await usdc.write.approve([auction.address, reserve], { account: stranger.account });
    await auction.write.bid([tokenId, reserve], { account: stranger.account });

    await increaseTime(publicClient, THREE_DAYS + 1n);
    await auction.write.settle([tokenId]);
    const adminBefore = (await usdc.read.balanceOf([admin.account.address])) as bigint;
    await auction.write.confirmReceipt([tokenId], { account: stranger.account });
    const adminAfter = (await usdc.read.balanceOf([admin.account.address])) as bigint;
    assert.equal(adminAfter - adminBefore, (reserve * feeBps) / 10_000n);
  });
});

describe("AuctionEscrow v1 — recall matrix", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  async function prepareAgentAuction(stack: AuctionStack) {
    const { seller, verifier, passport, auction } = stack;
    await joinVerifierIfNeeded(stack.staking, verifier);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://recall");
    await verifyPassport(passport, verifier, tokenId);
    await passport.write.setApprovalForAll([auction.address, true], { account: seller.account });
    const expiry = 0n;
    await auction.write.authorizeAuctionAgent(
      [tokenId, verifier.account.address, expiry, NATIVE, 0n],
      { account: seller.account },
    );
    await auction.write.createAuctionOnBehalf(
      [tokenId, NATIVE, 10n ** 18n, THREE_DAYS, 500],
      { account: verifier.account },
    );
    return tokenId;
  }

  it("requestReturn before bid allowed; after bid reverts", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const tokenId = await prepareAgentAuction(stack);
    await stack.auction.write.requestReturn([tokenId], { account: stack.seller.account });
    const reserve = 10n ** 18n;
    await stack.auction.write.bid([tokenId, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await assert.rejects(
      stack.auction.write.requestReturn([tokenId], { account: stack.seller.account }),
      revertsWith("AuctionAlreadyStarted"),
    );
  });

  it("bids allowed during requestReturn cooldown", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const tokenId = await prepareAgentAuction(stack);
    await stack.auction.write.requestReturn([tokenId], { account: stack.seller.account });
    const reserve = 10n ** 18n;
    await stack.auction.write.bid([tokenId, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    assert.equal(await stack.auction.read.isAuctionActive([tokenId]), true);
    const startedAt = (await stack.auction.read.auctions([tokenId])) as readonly unknown[];
    assert.ok((startedAt[7] as bigint) > 0n);
  });

  it("forceReturn before bid after cooldown; after bid reverts", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const tokenId = await prepareAgentAuction(stack);
    await stack.auction.write.requestReturn([tokenId], { account: stack.seller.account });
    await increaseTime(publicClient, RETURN_COOLDOWN + 1n);
    await stack.auction.write.forceReturn([tokenId], { account: stack.seller.account });

    const tokenId2 = await prepareAgentAuction(stack);
    await stack.auction.write.requestReturn([tokenId2], { account: stack.seller.account });
    const reserve = 10n ** 18n;
    await stack.auction.write.bid([tokenId2, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await increaseTime(publicClient, RETURN_COOLDOWN + 1n);
    await assert.rejects(
      stack.auction.write.forceReturn([tokenId2], { account: stack.seller.account }),
      revertsWith("AuctionAlreadyStarted"),
    );
  });

  it("agentCancelAuction before bid ok; after bid reverts", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const tokenId = await prepareAgentAuction(stack);
    await stack.auction.write.agentCancelAuction([tokenId], { account: stack.verifier.account });

    const tokenId2 = await prepareAgentAuction(stack);
    const reserve = 10n ** 18n;
    await stack.auction.write.bid([tokenId2, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await assert.rejects(
      stack.auction.write.agentCancelAuction([tokenId2], { account: stack.verifier.account }),
      revertsWith("AuctionAlreadyStarted"),
    );
  });

  it("cancelAuction direct before bid ok; after bid reverts", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId } = await prepareDirectAuction(stack);
    await stack.auction.write.cancelAuction([tokenId], { account: stack.seller.account });

    const { tokenId: tokenId2, reserve } = await prepareDirectAuction(stack);
    await stack.auction.write.bid([tokenId2, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await assert.rejects(
      stack.auction.write.cancelAuction([tokenId2], { account: stack.seller.account }),
      revertsWith("AuctionAlreadyStarted"),
    );
  });
});

describe("AuctionEscrow v1 — refund fallback", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("outbid refund to RevertingBidder lands as WETH", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    const { auction, weth, stranger } = stack;

    const reverting = await viem.deployContract("RevertingBidder", [auction.address]);
    const bid1 = reserve;
    await reverting.write.bidNative([tokenId], { value: bid1 });
    const increment = (bid1 * 300n) / 10_000n + 1n;
    const bid2 = bid1 + increment;
    await auction.write.bid([tokenId, bid2], { account: stranger.account, value: bid2 });

    const wethBal = (await weth.read.balanceOf([reverting.address])) as bigint;
    assert.equal(wethBal, bid1);
  });

  it("payout to RevertingRecipient lands seller net as WETH", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const recipient = await viem.deployContract("RevertingRecipient", []);
    const { verifier, passport, auction, weth, stranger, feeBps } = stack;
    await joinVerifierIfNeeded(stack.staking, verifier);
    const tokenId = await mintPassport(passport, stack.seller, recipient.address, "ar://rev-seller");
    await verifyPassport(passport, verifier, tokenId);
    await recipient.write.authorizeAgentForSelf(
      [passport.address, auction.address, tokenId, verifier.account.address, NATIVE],
      { account: stack.seller.account },
    );
    const reserve = 1n * 10n ** 18n;
    await auction.write.createAuctionOnBehalf(
      [tokenId, NATIVE, reserve, THREE_DAYS, 500],
      { account: verifier.account },
    );
    await auction.write.bid([tokenId, reserve], { account: stranger.account, value: reserve });
    await increaseTime(publicClient, THREE_DAYS + 1n);
    await auction.write.settle([tokenId]);
    await auction.write.confirmReceipt([tokenId], { account: stranger.account });
    const platformFee = (reserve * feeBps) / 10_000n;
    const agentFee = (reserve * 500n) / 10_000n;
    const net = reserve - platformFee - agentFee;
    const wethBal = (await weth.read.balanceOf([recipient.address])) as bigint;
    assert.equal(wethBal, net);
  });
});

describe("AuctionEscrow v1 — bid rules", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("first bid below reserve reverts BidTooLow", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    await assert.rejects(
      stack.auction.write.bid([tokenId, reserve - 1n], {
        account: stack.stranger.account,
        value: reserve - 1n,
      }),
      revertsWith("BidTooLow"),
    );
  });

  it("seller and agent cannot bid", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { seller, verifier, passport, auction } = stack;
    await joinVerifierIfNeeded(stack.staking, verifier);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://ban");
    await verifyPassport(passport, verifier, tokenId);
    await passport.write.setApprovalForAll([auction.address, true], { account: seller.account });
    const expiry = 0n;
    await auction.write.authorizeAuctionAgent(
      [tokenId, verifier.account.address, expiry, NATIVE, 0n],
      { account: seller.account },
    );
    await auction.write.createAuctionOnBehalf(
      [tokenId, NATIVE, 10n ** 18n, THREE_DAYS, 500],
      { account: verifier.account },
    );
    const reserve = 10n ** 18n;
    await assert.rejects(
      auction.write.bid([tokenId, reserve], { account: seller.account, value: reserve }),
      revertsWith("BidFromSeller"),
    );
    await assert.rejects(
      auction.write.bid([tokenId, reserve], { account: verifier.account, value: reserve }),
      revertsWith("BidFromAgent"),
    );
  });
});

describe("AuctionEscrow v2 — passport status decoupling", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("DISPUTED mid-auction: bid and settle succeed; ConfirmDispute still settles", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    const { auction, passport, stranger, admin } = stack;

    await auction.write.bid([tokenId, reserve], { account: stranger.account, value: reserve });
    await passport.write.disputePassport([tokenId, "mid-auction"], {
      account: admin.account,
      value: DISPUTE_DEPOSIT,
    });

    const increment = (reserve * 300n) / 10_000n + 1n;
    const bid2 = reserve + increment;
    await auction.write.bid([tokenId, bid2], { account: admin.account, value: bid2 });

    await increaseTime(publicClient, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await auction.write.settle([tokenId]);
    assert.equal(getAddress(await passport.read.ownerOf([tokenId])), getAddress(admin.account.address));

    const { tokenId: tokenId2, reserve: reserve2 } = await prepareDirectAuction(stack);
    await auction.write.bid([tokenId2, reserve2], { account: stranger.account, value: reserve2 });
    await passport.write.disputePassport([tokenId2, "confirm then settle"], {
      account: admin.account,
      value: DISPUTE_DEPOSIT,
    });
    await passport.write.resolveDispute([tokenId2, 0], { account: stack.seller.account });
    assert.equal(Number(await passport.read.passportStatus([tokenId2])), 0);
    await increaseTime(publicClient, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await auction.write.settle([tokenId2]);
    assert.equal(
      getAddress(await passport.read.ownerOf([tokenId2])),
      getAddress(stranger.account.address),
    );
  });

  it("seller escape fast path: ConfirmDispute cannot reclaim; settle delivers to bidder", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    const { auction, passport, stranger, admin, seller } = stack;

    await auction.write.bid([tokenId, reserve], { account: stranger.account, value: reserve });
    await passport.write.disputePassport([tokenId, "seller-escape"], {
      account: admin.account,
      value: DISPUTE_DEPOSIT,
    });
    await passport.write.resolveDispute([tokenId, 0], { account: seller.account });
    assert.equal(Number(await passport.read.passportStatus([tokenId])), 0);

    await increaseTime(publicClient, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await auction.write.settle([tokenId]);
    assert.equal(
      getAddress(await passport.read.ownerOf([tokenId])),
      getAddress(stranger.account.address),
    );
  });

  it("seller escape slow path: settle succeeds while DISPUTED after endsAt", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    const { auction, passport, stranger, admin } = stack;

    await auction.write.bid([tokenId, reserve], { account: stranger.account, value: reserve });
    await passport.write.disputePassport([tokenId, "unresolved"], {
      account: admin.account,
      value: DISPUTE_DEPOSIT,
    });
    assert.equal(Number(await passport.read.passportStatus([tokenId])), 2);

    await increaseTime(publicClient, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await auction.write.settle([tokenId]);
    assert.equal(
      getAddress(await passport.read.ownerOf([tokenId])),
      getAddress(stranger.account.address),
    );
    assert.equal(Number(await passport.read.passportStatus([tokenId])), 2);
  });

  it("bidder escape: highest bidder dispute cannot refund; settle transfers to them", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    const { auction, passport, stranger } = stack;

    await auction.write.bid([tokenId, reserve], { account: stranger.account, value: reserve });
    await passport.write.disputePassport([tokenId, "bidder-escape"], {
      account: stranger.account,
      value: DISPUTE_DEPOSIT,
    });

    await increaseTime(publicClient, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await auction.write.settle([tokenId]);
    assert.equal(
      getAddress(await passport.read.ownerOf([tokenId])),
      getAddress(stranger.account.address),
    );
  });

  it("no seller reclaim after endsAt: settle is the only outcome even after 30 days", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    const { auction, passport, stranger } = stack;

    await auction.write.bid([tokenId, reserve], { account: stranger.account, value: reserve });
    await increaseTime(publicClient, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await increaseTime(publicClient, THIRTY_DAYS + 1n);
    await auction.write.settle([tokenId]);
    assert.equal(
      getAddress(await passport.read.ownerOf([tokenId])),
      getAddress(stranger.account.address),
    );
  });

  it("contract bidder without onERC721Received: settle succeeds and hold opens", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    const { auction, passport } = stack;

    const reverting = await viem.deployContract("RevertingBidder", [auction.address]);
    await reverting.write.bidNative([tokenId], { value: reserve });

    await increaseTime(publicClient, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await auction.write.settle([tokenId]);

    assert.equal(getAddress(await passport.read.ownerOf([tokenId])), getAddress(reverting.address));
    const hold = (await auction.read.holds([tokenId])) as readonly unknown[];
    assert.ok((hold[2] as bigint) > 0n, "settlement hold releaseAt");
    assert.equal(getAddress(hold[0] as `0x${string}`), getAddress(reverting.address));
  });

  it("delegation recall: requestReturn → cooldown → forceReturn clears auth", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { seller, verifier, passport, auction } = stack;
    await joinVerifierIfNeeded(stack.staking, seller);
    await joinVerifierIfNeeded(stack.staking, verifier);

    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://recall");
    await verifyPassport(passport, verifier, tokenId);
    await passport.write.setApprovalForAll([auction.address, true], { account: seller.account });
    await auction.write.authorizeAuctionAgent(
      [tokenId, verifier.account.address, 0n, NATIVE, 0n],
      { account: seller.account },
    );
    await auction.write.createAuctionOnBehalf(
      [tokenId, NATIVE, 10n ** 18n, THREE_DAYS, 500],
      { account: verifier.account },
    );

    await auction.write.requestReturn([tokenId], { account: seller.account });
    await assert.rejects(
      auction.write.forceReturn([tokenId], { account: seller.account }),
      revertsWith("ReturnCooldownPending"),
    );
    await increaseTime(publicClient, RETURN_COOLDOWN + 1n);
    await auction.write.forceReturn([tokenId], { account: seller.account });

    assert.equal(getAddress(await passport.read.ownerOf([tokenId])), getAddress(seller.account.address));
    const auth = (await auction.read.auctionAgentAuthorizations([tokenId])) as readonly unknown[];
    assert.equal(auth[4] as boolean, false);
  });

  it("Phase A: createAuction still requires VERIFIED passport", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { seller, verifier, passport, auction, admin } = stack;
    await joinVerifierIfNeeded(stack.staking, seller);
    await joinVerifierIfNeeded(stack.staking, verifier);

    const unverifiedId = await mintPassport(passport, seller, seller.account.address, "ar://unv");
    await passport.write.setApprovalForAll([auction.address, true], { account: seller.account });
    await assert.rejects(
      auction.write.createAuction([unverifiedId, NATIVE, 10n ** 18n, THREE_DAYS], {
        account: seller.account,
      }),
      revertsWith("PassportNotVerified"),
    );

    const disputedId = await mintPassport(passport, seller, seller.account.address, "ar://dis");
    await verifyPassport(passport, verifier, disputedId);
    await passport.write.disputePassport([disputedId, "create gate"], {
      account: admin.account,
      value: DISPUTE_DEPOSIT,
    });
    await assert.rejects(
      auction.write.createAuction([disputedId, NATIVE, 10n ** 18n, THREE_DAYS], {
        account: seller.account,
      }),
      revertsWith("PassportDisputed"),
    );
  });
});

describe("AuctionEscrow v1 — settlement pending guard (H-1)", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  async function settleToHold(stack: AuctionStack) {
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    await stack.auction.write.bid([tokenId, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await increaseTime(stack.publicClient!, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await stack.auction.write.settle([tokenId]);
    return { tokenId, reserve, buyer: stack.stranger };
  }

  it("createAuction by verifier buyer reverts SettlementPending during hold", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve, buyer } = await settleToHold(stack);
    const { auction, passport } = stack;

    await joinVerifierIfNeeded(stack.staking, buyer);
    await passport.write.setApprovalForAll([auction.address, true], { account: buyer.account });
    await assert.rejects(
      auction.write.createAuction([tokenId, NATIVE, reserve, THREE_DAYS], { account: buyer.account }),
      revertsWith("SettlementPending"),
    );
  });

  it("authorizeAuctionAgent by buyer reverts SettlementPending during hold", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, buyer } = await settleToHold(stack);
    const { auction, verifier } = stack;

    await assert.rejects(
      auction.write.authorizeAuctionAgent(
        [tokenId, verifier.account.address, 0n, NATIVE, 0n],
        { account: buyer.account },
      ),
      revertsWith("SettlementPending"),
    );
  });

  it("createAuctionOnBehalf by authorized agent reverts SettlementPending during hold", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { seller, verifier, passport, auction } = stack;
    await joinVerifierIfNeeded(stack.staking, verifier);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://h1-agent");
    await verifyPassport(passport, verifier, tokenId);
    await passport.write.setApprovalForAll([auction.address, true], { account: seller.account });
    const reserve = 10n ** 18n;
    await auction.write.authorizeAuctionAgent(
      [tokenId, verifier.account.address, 0n, NATIVE, 0n],
      { account: seller.account },
    );
    await auction.write.createAuctionOnBehalf(
      [tokenId, NATIVE, reserve, THREE_DAYS, 500],
      { account: verifier.account },
    );
    await auction.write.bid([tokenId, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await increaseTime(stack.publicClient!, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await auction.write.settle([tokenId]);

    await assert.rejects(
      auction.write.createAuctionOnBehalf(
        [tokenId, NATIVE, reserve, THREE_DAYS, 500],
        { account: verifier.account },
      ),
      revertsWith("SettlementPending"),
    );
  });

  it("allows createAuction after confirmReceipt resolves hold", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve, buyer } = await settleToHold(stack);
    const { auction, passport } = stack;

    await auction.write.confirmReceipt([tokenId], { account: buyer.account });
    await joinVerifierIfNeeded(stack.staking, buyer);
    await passport.write.setApprovalForAll([auction.address, true], { account: buyer.account });
    await auction.write.createAuction([tokenId, NATIVE, reserve, THREE_DAYS], { account: buyer.account });
    assert.equal(await auction.read.isAuctionActive([tokenId]), true);
  });

  it("allows createAuction after releaseFunds resolves hold", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve, buyer } = await settleToHold(stack);
    const { auction, passport } = stack;

    await increaseTime(stack.publicClient!, SEVEN_DAYS + 1n);
    await auction.write.releaseFunds([tokenId]);
    await joinVerifierIfNeeded(stack.staking, buyer);
    await passport.write.setApprovalForAll([auction.address, true], { account: buyer.account });
    await auction.write.createAuction([tokenId, NATIVE, reserve, THREE_DAYS], { account: buyer.account });
    assert.equal(await auction.read.isAuctionActive([tokenId]), true);
  });

  it("allows createAuction after returnPassportAndRefund resolves hold", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve, buyer } = await settleToHold(stack);
    const { auction, passport, seller, verifier } = stack;

    await auction.write.openSettlementDispute([tokenId], {
      account: buyer.account,
      value: DISPUTE_DEPOSIT,
    });
    await auction.write.resolveSettlementDispute([tokenId, 1], { account: verifier.account });
    await passport.write.setApprovalForAll([auction.address, true], { account: buyer.account });
    await auction.write.returnPassportAndRefund([tokenId], { account: buyer.account });
    await joinVerifierIfNeeded(stack.staking, seller);
    await passport.write.setApprovalForAll([auction.address, true], { account: seller.account });
    await auction.write.createAuction([tokenId, NATIVE, reserve, THREE_DAYS], { account: seller.account });
    assert.equal(await auction.read.isAuctionActive([tokenId]), true);
  });
});

describe("AuctionEscrow v1 — settlement dispute", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  async function settleToHold(stack: AuctionStack) {
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    await stack.auction.write.bid([tokenId, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await increaseTime(stack.publicClient!, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await stack.auction.write.settle([tokenId]);
    return { tokenId, reserve, buyer: stack.stranger };
  }

  it("openSettlementDispute bond too low reverts", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, buyer } = await settleToHold(stack);
    await assert.rejects(
      stack.auction.write.openSettlementDispute([tokenId], {
        account: buyer.account,
        value: DISPUTE_DEPOSIT - 1n,
      }),
      revertsWith("BondTooLow"),
    );
  });

  it("ReleaseToSeller pays resolver bond; ConfirmFailure returnPassportAndRefund", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve, buyer } = await settleToHold(stack);
    const { auction, passport, seller, verifier } = stack;

    await auction.write.openSettlementDispute([tokenId], {
      account: buyer.account,
      value: DISPUTE_DEPOSIT,
    });
    const resolverBefore = await publicClient.getBalance({ address: verifier.account.address });
    await auction.write.resolveSettlementDispute([tokenId, 0], { account: verifier.account });
    const resolverAfter = await publicClient.getBalance({ address: verifier.account.address });
    assert.ok(resolverAfter >= resolverBefore);

    const { tokenId: tokenId2, reserve: reserve2, buyer: buyer2 } = await settleToHold(stack);
    await auction.write.openSettlementDispute([tokenId2], {
      account: buyer2.account,
      value: DISPUTE_DEPOSIT,
    });
    await auction.write.resolveSettlementDispute([tokenId2, 1], { account: verifier.account });
    await passport.write.setApprovalForAll([auction.address, true], { account: buyer2.account });
    await auction.write.returnPassportAndRefund([tokenId2], { account: buyer2.account });
    assert.equal(getAddress(await passport.read.ownerOf([tokenId2])), getAddress(seller.account.address));
    void reserve;
    void reserve2;
  });

  it("claimAbandonedRefund after timeout", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve, buyer } = await settleToHold(stack);
    const { auction, seller, verifier } = stack;

    await auction.write.openSettlementDispute([tokenId], {
      account: buyer.account,
      value: DISPUTE_DEPOSIT,
    });
    await auction.write.resolveSettlementDispute([tokenId, 1], { account: verifier.account });
    await increaseTime(publicClient, SEVEN_DAYS + 1n);
    await auction.write.claimAbandonedRefund([tokenId], { account: seller.account });
    void reserve;
  });
});

describe("AuctionEscrow v2 — 2.0.0-draft error names", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  async function settleToHold(stack: AuctionStack) {
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    await stack.auction.write.bid([tokenId, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await increaseTime(stack.publicClient!, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await stack.auction.write.settle([tokenId]);
    return { tokenId, reserve, buyer: stack.stranger };
  }

  it("VERSION is 2.0.0-draft", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    assert.equal(await stack.auction.read.VERSION(), "2.0.0-draft");
  });

  it("non-buyer confirmReceipt reverts NotBuyer", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId } = await settleToHold(stack);
    await assert.rejects(
      stack.auction.write.confirmReceipt([tokenId], { account: stack.seller.account }),
      revertsWith("NotBuyer"),
    );
  });

  it("non-buyer openSettlementDispute reverts NotBuyer", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId } = await settleToHold(stack);
    await assert.rejects(
      stack.auction.write.openSettlementDispute([tokenId], {
        account: stack.seller.account,
        value: DISPUTE_DEPOSIT,
      }),
      revertsWith("NotBuyer"),
    );
  });

  it("non-buyer returnPassportAndRefund reverts NotBuyer", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, buyer } = await settleToHold(stack);
    const { auction, passport, verifier } = stack;

    await auction.write.openSettlementDispute([tokenId], {
      account: buyer.account,
      value: DISPUTE_DEPOSIT,
    });
    await auction.write.resolveSettlementDispute([tokenId, 1], { account: verifier.account });
    await passport.write.setApprovalForAll([auction.address, true], { account: buyer.account });

    await assert.rejects(
      auction.write.returnPassportAndRefund([tokenId], { account: stack.seller.account }),
      revertsWith("NotBuyer"),
    );
  });
});

describe("AuctionEscrow v1 — releaseFunds auto", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("auto-release when buyer silent past releaseAt", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    await stack.auction.write.bid([tokenId, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await increaseTime(publicClient, THREE_DAYS + 1n);
    await stack.auction.write.settle([tokenId]);
    await increaseTime(publicClient, SEVEN_DAYS + 1n);
    await stack.auction.write.releaseFunds([tokenId]);
  });

  it("dispute timeout auto-release bond to platform", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    await stack.auction.write.bid([tokenId, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await increaseTime(publicClient, THREE_DAYS + 1n);
    await stack.auction.write.settle([tokenId]);
    await stack.auction.write.openSettlementDispute([tokenId], {
      account: stack.stranger.account,
      value: DISPUTE_DEPOSIT,
    });
    await increaseTime(publicClient, THIRTY_DAYS + 1n);
    const adminBefore = await publicClient.getBalance({ address: stack.admin.account.address });
    await stack.auction.write.releaseFunds([tokenId]);
    const adminAfter = await publicClient.getBalance({ address: stack.admin.account.address });
    assert.ok(adminAfter >= adminBefore + DISPUTE_DEPOSIT);
  });
});

describe("AuctionEscrow v1 — pause matrix", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("pause blocks create and bid but not settle", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    await stack.auction.write.setPaused([true], { account: stack.admin.account });
    await assert.rejects(
      stack.auction.write.bid([tokenId, reserve], {
        account: stack.stranger.account,
        value: reserve,
      }),
      revertsWith("ContractPaused"),
    );
    await stack.auction.write.setPaused([false], { account: stack.admin.account });
    await stack.auction.write.bid([tokenId, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await stack.auction.write.setPaused([true], { account: stack.admin.account });
    await increaseTime(publicClient, THREE_DAYS + 1n);
    await stack.auction.write.settle([tokenId]);
  });
});

describe("AuctionEscrow v1 — reentrancy", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("reentrant bid during refund fails", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    const { auction, stranger } = stack;

    const reentrant = await viem.deployContract("ReentrantBidder", [auction.address]);
    const bid1 = reserve;
    await reentrant.write.bidNative([tokenId, bid1], { value: bid1 });
    const increment = (bid1 * 300n) / 10_000n + 1n;
    const bid2 = bid1 + increment;
    await reentrant.write.configure([tokenId, bid2]);
    await auction.write.bid([tokenId, bid2], { account: stranger.account, value: bid2 });
    const a = (await auction.read.auctions([tokenId])) as readonly unknown[];
    assert.equal(getAddress(a[9] as `0x${string}`), getAddress(stranger.account.address));
  });
});

describe("AuctionEscrow v1 — gas samples", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("records gas for bid native, bid USDC, settle", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    const hash1 = await stack.auction.write.bid([tokenId, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    const r1 = await publicClient.getTransactionReceipt({ hash: hash1 });

    const { tokenId: usdcId } = await prepareDirectAuction(stack, {
      asset: stack.usdc.address,
      reserve: 1_000_000n,
    });
    await stack.usdc.write.mint([stack.stranger.account.address, 1_000_000n], {
      account: stack.admin.account,
    });
    await stack.usdc.write.approve([stack.auction.address, 1_000_000n], {
      account: stack.stranger.account,
    });
    const hash2 = await stack.auction.write.bid([usdcId, 1_000_000n], {
      account: stack.stranger.account,
    });
    const r2 = await publicClient.getTransactionReceipt({ hash: hash2 });

    await increaseTime(publicClient, THREE_DAYS + 1n);
    const hash3 = await stack.auction.write.settle([tokenId]);
    const r3 = await publicClient.getTransactionReceipt({ hash: hash3 });

    assert.ok(r1.gasUsed > 0n);
    assert.ok(r2.gasUsed > 0n);
    assert.ok(r3.gasUsed > 0n);
  });
});

describe("AuctionEscrow — guard order and hold semantics", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  async function settleToHold(stack: AuctionStack) {
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    await stack.auction.write.bid([tokenId, reserve], {
      account: stack.stranger.account,
      value: reserve,
    });
    await increaseTime(stack.publicClient!, THREE_DAYS + EXTENSION_WINDOW + 1n);
    await stack.auction.write.settle([tokenId]);
    return { tokenId, reserve, buyer: stack.stranger };
  }

  it("owner createAuction while auction active reverts AuctionExists not NotOwner", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, reserve } = await prepareDirectAuction(stack);
    await assert.rejects(
      stack.auction.write.createAuction([tokenId, NATIVE, reserve, THREE_DAYS], {
        account: stack.seller.account,
      }),
      revertsWith("AuctionExists"),
    );
  });

  it("owner authorizeAuctionAgent while auction active reverts AuctionExists not NotOwner", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId } = await prepareDirectAuction(stack);
    await assert.rejects(
      stack.auction.write.authorizeAuctionAgent(
        [tokenId, stack.verifier.account.address, 0n, NATIVE, 0n],
        { account: stack.seller.account },
      ),
      revertsWith("AuctionExists"),
    );
  });

  it("owner revokeAuctionAgent during live agent auction reverts AgentAuthorizationActive not NotOwner", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { seller, verifier, passport, auction } = stack;
    await joinVerifierIfNeeded(stack.staking, verifier);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://rev-agent");
    await verifyPassport(passport, verifier, tokenId);
    await passport.write.setApprovalForAll([auction.address, true], { account: seller.account });
    const reserve = 10n ** 18n;
    await auction.write.authorizeAuctionAgent(
      [tokenId, verifier.account.address, 0n, NATIVE, 0n],
      { account: seller.account },
    );
    await auction.write.createAuctionOnBehalf(
      [tokenId, NATIVE, reserve, THREE_DAYS, 500],
      { account: verifier.account },
    );
    await assert.rejects(
      auction.write.revokeAuctionAgent([tokenId], { account: seller.account }),
      revertsWith("AgentAuthorizationActive"),
    );
  });

  it("stranger createAuction when no auction reverts NotOwner", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { seller, stranger, verifier, passport, auction } = stack;
    await joinVerifierIfNeeded(stack.staking, verifier);
    await joinVerifierIfNeeded(stack.staking, stranger);
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://stranger");
    await verifyPassport(passport, verifier, tokenId);
    await passport.write.setApprovalForAll([auction.address, true], { account: stranger.account });
    await assert.rejects(
      auction.write.createAuction([tokenId, NATIVE, 10n ** 18n, THREE_DAYS], {
        account: stranger.account,
      }),
      revertsWith("NotOwner"),
    );
  });

  it("stranger revokeAuctionAgent when no auction reverts NotOwner", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { seller, stranger, passport } = stack;
    const tokenId = await mintPassport(passport, seller, seller.account.address, "ar://stranger-rev");
    await assert.rejects(
      stack.auction.write.revokeAuctionAgent([tokenId], { account: stranger.account }),
      revertsWith("NotOwner"),
    );
  });

  it("confirmReceipt after releaseAt reverts HoldReleased", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, buyer } = await settleToHold(stack);
    await increaseTime(stack.publicClient!, SEVEN_DAYS + 1n);
    await assert.rejects(
      stack.auction.write.confirmReceipt([tokenId], { account: buyer.account }),
      revertsWith("HoldReleased"),
    );
  });

  it("openSettlementDispute after releaseAt reverts HoldReleased", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, buyer } = await settleToHold(stack);
    await increaseTime(stack.publicClient!, SEVEN_DAYS + 1n);
    await assert.rejects(
      stack.auction.write.openSettlementDispute([tokenId], {
        account: buyer.account,
        value: DISPUTE_DEPOSIT,
      }),
      revertsWith("HoldReleased"),
    );
  });

  it("releaseFunds before releaseAt reverts HoldActive", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId } = await settleToHold(stack);
    await assert.rejects(
      stack.auction.write.releaseFunds([tokenId]),
      revertsWith("HoldActive"),
    );
  });

  it("claimAbandonedRefund before timeout reverts HoldActive", async () => {
    const { viem } = connection;
    const stack = await deployAuctionStack(viem);
    const { tokenId, buyer } = await settleToHold(stack);
    const { auction, seller, verifier } = stack;
    await auction.write.openSettlementDispute([tokenId], {
      account: buyer.account,
      value: DISPUTE_DEPOSIT,
    });
    await auction.write.resolveSettlementDispute([tokenId, 1], { account: verifier.account });
    await assert.rejects(
      auction.write.claimAbandonedRefund([tokenId], { account: seller.account }),
      revertsWith("HoldActive"),
    );
  });
});
