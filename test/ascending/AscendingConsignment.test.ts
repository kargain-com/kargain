import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { getAddress, parseEther, stringToHex, padHex } from "viem";

import hardhat from "hardhat";
import {
  deployAscendingConsignment,
  deployAscendingLibraries,
  increaseTime,
  ZERO,
} from "../../scripts/lib/local-stack.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Connection = Awaited<ReturnType<typeof hardhat.network.connect>>;
type ViemSuite = Connection["viem"];
type WalletClient = Awaited<ReturnType<ViemSuite["getWalletClients"]>>[number];
type DeployedContract = Awaited<ReturnType<ViemSuite["deployContract"]>>;
type PublicClient = Awaited<ReturnType<ViemSuite["getPublicClient"]>>;

const EIP170_MAX = 24_576;
const PLATFORM_FEE_BPS = 250n;
const INTENT_OPEN = 1;
const INTENT_LEAVE = 0;
const TOKEN = 1n;
const RESERVE = parseEther("1");
const BOND = parseEther("0.01");
const MIN_DURATION = 100n;
const MAX_DURATION = 10_000n;
const DURATION = 1_000n;
const EXTENSION = 50n;
const MIN_INCREMENT_BPS = 300n;
const PROTECTION = 1_000n;
const ABANDONMENT = 200n;
const CHALLENGE_WINDOW = 300n;

{
  const abs = path.join(
    repoRoot,
    "artifacts/contracts/AscendingConsignment.sol/AscendingConsignment.json",
  );
  if (existsSync(abs)) {
    const artifact = JSON.parse(readFileSync(abs, "utf8")) as { deployedBytecode?: string };
    const hex = artifact.deployedBytecode ?? "";
    const bytes = (hex.length - 2) / 2;
    const overage = bytes - EIP170_MAX;
    process.stdout.write("\n--- AscendingConsignment EIP-170 ---\n");
    process.stdout.write(`| AscendingConsignment | ${bytes} |\n`);
    process.stdout.write(`| EIP-170 limit | ${EIP170_MAX} |\n`);
    process.stdout.write(`| Headroom | ${EIP170_MAX - bytes} |\n`);
    if (overage > 0) {
      process.stdout.write(
        `| STOP-AND-REPORT overage | ${overage} bytes (event surface; do not trim) |\n`,
      );
    }
    process.stdout.write("\n");
    // Official EIP-170 gate remains test/contract-size.test.ts.
  }
}

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    return err.message.includes(errorName);
  };
}

const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const DENOM_ASSET = { kind: 0, currencyCode: BYTES32_ZERO } as const;
const DENOM_USD = {
  kind: 1,
  currencyCode: padHex(stringToHex("USD"), { size: 32, dir: "right" }),
} as const;
const COMP_MARGIN = { form: 0, commissionBps: 0 } as const;
const COMP_COMMISSION_500 = { form: 1, commissionBps: 500 } as const;

describe("AscendingConsignment", () => {
  let connection: Connection;
  let viem: ViemSuite;
  let publicClient: PublicClient;

  let mode: DeployedContract;
  let passport: DeployedContract;
  let staking: DeployedContract;
  let owner: WalletClient;
  let agent: WalletClient;
  let buyer: WalletClient;
  let bidder2: WalletClient;
  let platform: WalletClient;
  let forfeit: WalletClient;
  let judge: WalletClient;
  let stranger: WalletClient;
  let guardian: WalletClient;

  async function deployMode(overrides: {
    minProtectionWindow?: bigint;
    maxProtectionWindow?: bigint;
    abandonmentWindow?: bigint;
    extensionWindow?: bigint;
    challengeWindow?: bigint;
    minDuration?: bigint;
    maxDuration?: bigint;
    harness?: boolean;
  } = {}) {
    connection = await hardhat.network.connect();
    viem = connection.viem;
    publicClient = await viem.getPublicClient();
    const wallets = await viem.getWalletClients();
    [owner, agent, buyer, bidder2, platform, forfeit, judge, stranger, guardian] = wallets;

    passport = await viem.deployContract("MockPassportEncumbrance", []);
    staking = await viem.deployContract("MockKarProActive", []);

    const deployed = await deployAscendingConsignment(viem, {
      passport: passport.address,
      karProStaking: staking.address,
      platformRecipient: platform.account.address,
      feeBps: PLATFORM_FEE_BPS,
      forfeitRecipient: forfeit.account.address,
      challengeBond: BOND,
      challengeWindow: overrides.challengeWindow ?? CHALLENGE_WINDOW,
      minDuration: overrides.minDuration ?? MIN_DURATION,
      maxDuration: overrides.maxDuration ?? MAX_DURATION,
      extensionWindow: overrides.extensionWindow ?? EXTENSION,
      minIncrementBps: MIN_INCREMENT_BPS,
      minProtectionWindow: overrides.minProtectionWindow ?? PROTECTION,
      maxProtectionWindow: overrides.maxProtectionWindow ?? PROTECTION * 10n,
      abandonmentWindow: overrides.abandonmentWindow ?? ABANDONMENT,
      owner: owner.account.address,
      guardian: guardian.account.address,
      harness: overrides.harness ?? false,
    });
    mode = deployed.mode;
  }

  async function mintAndApprove(tokenId: bigint = TOKEN, holder: WalletClient = owner) {
    await passport.write.mint([holder.account.address, tokenId], { account: holder.account });
    await passport.write.setMay([tokenId, INTENT_OPEN, true]);
    await passport.write.setMay([tokenId, INTENT_LEAVE, true]);
    await passport.write.approve([mode.address, tokenId], { account: holder.account });
  }

  async function activate(runner: WalletClient) {
    await staking.write.setActive([runner.account.address, true]);
  }

  async function activateJudge() {
    await activate(judge);
  }

  async function openDirect(
    reserve: bigint = RESERVE,
    duration: bigint = DURATION,
    protection: bigint = PROTECTION,
  ) {
    await activate(owner);
    await mintAndApprove();
    await mode.write.openAscendingDirect([TOKEN, ZERO, reserve, duration, protection], {
      account: owner.account,
    });
  }

  async function firstBid(amount: bigint = RESERVE, from: WalletClient = buyer) {
    await mode.write.bid([TOKEN, amount], { account: from.account, value: amount });
  }

  async function settleAfterEnd(extra = 2) {
    await increaseTime(publicClient, BigInt(Number(DURATION) + extra));
    await mode.write.settle([TOKEN], { account: stranger.account });
  }

  type AuctionRulesPartial = {
    minDuration?: bigint;
    maxDuration?: bigint;
    extensionWindow?: bigint;
    minIncrementBps?: bigint;
    minProtectionWindow?: bigint;
    maxProtectionWindow?: bigint;
    abandonmentWindow?: bigint;
    challengeBond?: bigint;
  };

  async function readAuctionRules() {
    const r = (await mode.read.auctionRules()) as {
      minDuration: number | bigint;
      maxDuration: number | bigint;
      extensionWindow: number | bigint;
      minIncrementBps: number | bigint;
      minProtectionWindow: number | bigint;
      maxProtectionWindow: number | bigint;
      abandonmentWindow: number | bigint;
      challengeBond: bigint;
    };
    return {
      minDuration: BigInt(r.minDuration),
      maxDuration: BigInt(r.maxDuration),
      extensionWindow: BigInt(r.extensionWindow),
      minIncrementBps: BigInt(r.minIncrementBps),
      minProtectionWindow: BigInt(r.minProtectionWindow),
      maxProtectionWindow: BigInt(r.maxProtectionWindow),
      abandonmentWindow: BigInt(r.abandonmentWindow),
      challengeBond: r.challengeBond,
    };
  }

  /** Full-set governance write — single-field patches merge onto live rules. */
  async function setAuctionRules(partial: AuctionRulesPartial = {}) {
    const cur = await readAuctionRules();
    await mode.write.setAuctionRules(
      [
        partial.minDuration ?? cur.minDuration,
        partial.maxDuration ?? cur.maxDuration,
        partial.extensionWindow ?? cur.extensionWindow,
        partial.minIncrementBps ?? cur.minIncrementBps,
        partial.minProtectionWindow ?? cur.minProtectionWindow,
        partial.maxProtectionWindow ?? cur.maxProtectionWindow,
        partial.abandonmentWindow ?? cur.abandonmentWindow,
        partial.challengeBond ?? cur.challengeBond,
      ],
      { account: owner.account },
    );
  }

  beforeEach(async () => {
    await deployMode();
  });

  it("VERSION matches CONTRACT_VERSIONS", async () => {
    assert.equal(await mode.read.VERSION(), "2.3.0-rc.1");
  });

  it("S30: challenge config getters readable before any open", async () => {
    assert.equal(await mode.read.windowDuration(), CHALLENGE_WINDOW);
    assert.equal(
      getAddress(await mode.read.forfeitRecipient()),
      getAddress(forfeit.account.address),
    );
  });

  // ---- N2 KarPro by behaviour (not source scan) ----

  it("N2: non-KarPro owner cannot open direct (behaviour)", async () => {
    await mintAndApprove();
    // staking.active[owner] defaults false
    await assert.rejects(
      mode.write.openAscendingDirect([TOKEN, ZERO, RESERVE, DURATION, PROTECTION], {
        account: owner.account,
      }),
      revertsWith("NotActiveVerifier"),
    );
  });

  it("N2: KarPro owner can open; fixed mode is not this contract", async () => {
    await openDirect();
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 1);
  });

  // ---- Opening gates ----

  it("AscendingOpenPath on base openDirect / openFromMandate", async () => {
    await activate(owner);
    await mintAndApprove();
    await assert.rejects(
      mode.write.openDirect([TOKEN, DENOM_ASSET, ZERO, RESERVE], { account: owner.account }),
      revertsWith("AscendingOpenPath"),
    );
    await assert.rejects(
      mode.write.openFromMandate([TOKEN, DENOM_ASSET, RESERVE], { account: owner.account }),
      revertsWith("AscendingOpenPath"),
    );
  });

  it("TermsFixed: setPrice refused (C4)", async () => {
    await openDirect();
    await assert.rejects(
      mode.write.setPrice([TOKEN, parseEther("2")], { account: owner.account }),
      revertsWith("TermsFixed"),
    );
  });

  it("NotAssetDenomination / BadReserve / BadDuration / PaymentTokenNotSupported", async () => {
    await activate(owner);
    await mintAndApprove();

    // Fiat mandate cannot open ascending (N4 via DenominationMismatch).
    await passport.write.approve([mode.address, TOKEN], { account: owner.account });
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, ZERO, DENOM_USD, parseEther("0.5"), COMP_MARGIN],
      { account: owner.account },
    );
    await activate(agent);
    await assert.rejects(
      mode.write.openAscendingFromMandate([TOKEN, RESERVE, DURATION, PROTECTION], { account: agent.account }),
      revertsWith("DenominationMismatch"),
    );

    await mode.write.revoke([TOKEN], { account: owner.account });
    await assert.rejects(
      mode.write.openAscendingDirect([TOKEN, ZERO, 0n, DURATION, PROTECTION], { account: owner.account }),
      revertsWith("BadReserve"),
    );
    await assert.rejects(
      mode.write.openAscendingDirect([TOKEN, ZERO, RESERVE, 1n, PROTECTION], { account: owner.account }),
      revertsWith("BadDuration"),
    );

    await assert.rejects(
      mode.write.openAscendingDirect([TOKEN, ZERO, RESERVE, DURATION, PROTECTION - 1n], {
        account: owner.account,
      }),
      revertsWith("ProtectionOutOfBounds"),
    );
    await assert.rejects(
      mode.write.openAscendingDirect([TOKEN, ZERO, RESERVE, DURATION, PROTECTION * 10n + 1n], {
        account: owner.account,
      }),
      revertsWith("ProtectionOutOfBounds"),
    );

    const token = await viem.deployContract("MockERC20Decimals", ["T", "T", 18]);
    await assert.rejects(
      mode.write.openAscendingDirect([TOKEN, token.address, RESERVE, DURATION, PROTECTION], {
        account: owner.account,
      }),
      revertsWith("PaymentTokenNotSupported"),
    );
  });

  it("BadDuration / BadConfig on invalid initialize and governance params", async () => {
    await assert.rejects(
      deployAscendingConsignment(viem, {
        passport: passport.address,
        karProStaking: staking.address,
        platformRecipient: platform.account.address,
        feeBps: PLATFORM_FEE_BPS,
        forfeitRecipient: forfeit.account.address,
        challengeBond: BOND,
        challengeWindow: CHALLENGE_WINDOW,
        minDuration: MIN_DURATION,
        maxDuration: MAX_DURATION,
        extensionWindow: 0n,
        minIncrementBps: MIN_INCREMENT_BPS,
        minProtectionWindow: PROTECTION,
        maxProtectionWindow: PROTECTION * 10n,
        abandonmentWindow: ABANDONMENT,
        owner: owner.account.address,
        guardian: guardian.account.address,
      }),
      revertsWith("BadConfig"),
    );
    await assert.rejects(
      deployAscendingConsignment(viem, {
        passport: passport.address,
        karProStaking: staking.address,
        platformRecipient: platform.account.address,
        feeBps: PLATFORM_FEE_BPS,
        forfeitRecipient: forfeit.account.address,
        challengeBond: BOND,
        challengeWindow: CHALLENGE_WINDOW,
        minDuration: 500n,
        maxDuration: 100n,
        extensionWindow: EXTENSION,
        minIncrementBps: MIN_INCREMENT_BPS,
        minProtectionWindow: PROTECTION,
        maxProtectionWindow: PROTECTION * 10n,
        abandonmentWindow: ABANDONMENT,
        owner: owner.account.address,
        guardian: guardian.account.address,
      }),
      revertsWith("BadConfig"),
    );
  });

  it("DirectEthNotAccepted on bare receive", async () => {
    await assert.rejects(
      owner.sendTransaction({ to: mode.address, value: 1n }),
      revertsWith("DirectEthNotAccepted"),
    );
  });

  // ---- Bidding ----

  it("first bid enters BINDING; seller/agent cannot bid; outbid refunds prior", async () => {
    await openDirect();
    await assert.rejects(
      mode.write.bid([TOKEN, RESERVE], { account: owner.account, value: RESERVE }),
      revertsWith("BidFromSeller"),
    );

    await firstBid();
    assert.equal(await mode.read.isBinding([TOKEN]), true);
    assert.equal(await mode.read.consignmentCommittedNotOffered([TOKEN]), true);

    const minNext = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n;
    await assert.rejects(
      mode.write.bid([TOKEN, RESERVE], { account: bidder2.account, value: RESERVE }),
      revertsWith("BidTooLow"),
    );

    const buyerBefore = await publicClient.getBalance({ address: buyer.account.address });
    await mode.write.bid([TOKEN, minNext], { account: bidder2.account, value: minNext });
    const buyerAfter = await publicClient.getBalance({ address: buyer.account.address });
    // Outbid refund via payout primitive (may be push or claim). Prefer balance increase or claim.
    const claim = (await mode.read.pendingClaims([buyer.account.address, ZERO])) as bigint;
    assert.ok(buyerAfter > buyerBefore || claim === RESERVE, "prior bidder refunded");
  });

  it("BidFromAgent on agented consignment", async () => {
    await activate(owner);
    await activate(agent);
    await mintAndApprove();
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, parseEther("0.5"), COMP_MARGIN],
      { account: owner.account },
    );
    await mode.write.openAscendingFromMandate([TOKEN, RESERVE, DURATION, PROTECTION], {
      account: agent.account,
    });
    await assert.rejects(
      mode.write.bid([TOKEN, RESERVE], { account: agent.account, value: RESERVE }),
      revertsWith("BidFromAgent"),
    );
  });

  it("B3 snapshot: extension frozen at open; storage change only affects later lots", async () => {
    await openDirect(RESERVE, DURATION);
    assert.equal(Number(await mode.read.auctionExtensionWindow([TOKEN])), Number(EXTENSION));
    await firstBid();
    const ends1 = Number(await mode.read.auctionEndsAt([TOKEN]));
    await increaseTime(publicClient, DURATION - EXTENSION + 1n);
    const raise = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n;
    await mode.write.bid([TOKEN, raise], { account: bidder2.account, value: raise });
    const afterExt = await publicClient.getBlock();
    const ends2 = Number(await mode.read.auctionEndsAt([TOKEN]));
    assert.ok(ends2 > ends1, "extension moved the end");
    const remainingA = ends2 - Number(afterExt.timestamp);
    assert.ok(
      remainingA >= Number(EXTENSION) - 2,
      `lot A anti-snipe leaves ~${EXTENSION}s, got ${remainingA}`,
    );

    const beforeGov = Number(await mode.read.auctionEndsAt([TOKEN]));
    await setAuctionRules({ extensionWindow: 1n });
    assert.equal(Number(await mode.read.auctionEndsAt([TOKEN])), beforeGov, "governance alone does not rewrite endsAt");
    assert.equal(Number(await mode.read.auctionExtensionWindow([TOKEN])), Number(EXTENSION), "lot A snapshot unchanged");
    assert.equal(Number((await readAuctionRules()).extensionWindow), 1);
    // Live remaining unchanged by governance (same endsAt).
    assert.equal(Number(await mode.read.auctionEndsAt([TOKEN])), ends2);

    // Finish lot A so custody returns for token B open on a fresh passport.
    await increaseTime(publicClient, BigInt(remainingA + 5));
    await mode.write.settle([TOKEN], { account: stranger.account });
    await mode.write.confirmReceipt([TOKEN], { account: bidder2.account });

    const tokenB = 2n;
    await activate(owner);
    await mintAndApprove(tokenB);
    await mode.write.openAscendingDirect([tokenB, ZERO, RESERVE, DURATION, PROTECTION], {
      account: owner.account,
    });
    assert.equal(Number(await mode.read.auctionExtensionWindow([tokenB])), 1);
    await mode.write.bid([tokenB, RESERVE], { account: buyer.account, value: RESERVE });
    // Leave 2s headroom: increaseTime+mine then the bid block each consume a second.
    await increaseTime(publicClient, DURATION - 2n);
    const raiseB = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n;
    await mode.write.bid([tokenB, raiseB], { account: bidder2.account, value: raiseB });
    const afterBid = await publicClient.getBlock();
    const endsB2 = Number(await mode.read.auctionEndsAt([tokenB]));
    const remainingB = endsB2 - Number(afterBid.timestamp);
    assert.ok(
      remainingB <= 3,
      `lot B extension leaves ~1s remaining, remaining=${remainingB}`,
    );
  });

  it("snapshot: minIncrementBps frozen at open; later lots use storage", async () => {
    await openDirect();
    await firstBid();
    assert.equal(Number(await mode.read.auctionMinIncrementBps([TOKEN])), Number(MIN_INCREMENT_BPS));

    const newBps = 5_000n; // 50%
    await setAuctionRules({ minIncrementBps: newBps });
    assert.equal(Number((await readAuctionRules()).minIncrementBps), Number(newBps));
    assert.equal(Number(await mode.read.auctionMinIncrementBps([TOKEN])), Number(MIN_INCREMENT_BPS));

    const oldNext = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n;
    await mode.write.bid([TOKEN, oldNext], { account: bidder2.account, value: oldNext });

    await increaseTime(publicClient, DURATION + 2n);
    await mode.write.settle([TOKEN], { account: stranger.account });
    await mode.write.confirmReceipt([TOKEN], { account: bidder2.account });

    const tokenB = 2n;
    await activate(owner);
    await mintAndApprove(tokenB);
    await mode.write.openAscendingDirect([tokenB, ZERO, RESERVE, DURATION, PROTECTION], {
      account: owner.account,
    });
    assert.equal(Number(await mode.read.auctionMinIncrementBps([tokenB])), Number(newBps));
    await mode.write.bid([tokenB, RESERVE], { account: buyer.account, value: RESERVE });
    await assert.rejects(
      mode.write.bid([tokenB, oldNext], { account: bidder2.account, value: oldNext }),
      revertsWith("BidTooLow"),
    );
    const newNext = RESERVE + (RESERVE * newBps) / 10_000n;
    await mode.write.bid([tokenB, newNext], { account: bidder2.account, value: newNext });
  });

  // ---- B1 single exit ----

  it("B1: while BINDING, withdraw/recall/re-open fail; settle succeeds after end", async () => {
    await openDirect();
    await firstBid();

    await assert.rejects(
      mode.write.ownerWithdraw([TOKEN], { account: owner.account }),
      revertsWith("NotOffered"),
    );
    await assert.rejects(
      mode.write.requestRecall([TOKEN], { account: owner.account }),
      revertsWith("NotOfferedAgented"),
    );
    await assert.rejects(
      mode.write.openAscendingDirect([TOKEN, ZERO, RESERVE, DURATION, PROTECTION], {
        account: owner.account,
      }),
      revertsWith("NotPassportOwner"), // custody still on mode; cannot open again
    );
    await assert.rejects(
      mode.write.settle([TOKEN], { account: stranger.account }),
      revertsWith("AuctionNotEnded"),
    );

    await settleAfterEnd();
    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      buyer.account.address.toLowerCase(),
    );
    assert.equal(
      ((await mode.read.holdBuyer([TOKEN])) as string).toLowerCase(),
      buyer.account.address.toLowerCase(),
    );
  });

  it("B1/B2: settlement succeeds for rejecting contract bidder (non-callback transfer)", async () => {
    await openDirect();
    const rejecting = await viem.deployContract("AscendingRejectingBidder", [mode.address]);
    await rejecting.write.setAcceptEth([true]);
    await owner.sendTransaction({ to: rejecting.address, value: RESERVE });
    await rejecting.write.setAcceptEth([false]);
    await rejecting.write.bidNative([TOKEN], { value: RESERVE });

    await increaseTime(publicClient, DURATION + 2n);
    await mode.write.settle([TOKEN], { account: stranger.account });

    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      rejecting.address.toLowerCase(),
    );
  });

  it("AuctionEnded after bidding closes; AuctionNotEnded before settle", async () => {
    await openDirect();
    await firstBid();
    await increaseTime(publicClient, DURATION + 2n);
    const raise = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n;
    await assert.rejects(
      mode.write.bid([TOKEN, raise], { account: bidder2.account, value: raise }),
      revertsWith("AuctionEnded"),
    );
    // settle still works
    await mode.write.settle([TOKEN], { account: stranger.account });
  });

  it("NotBinding / AuctionNotEnded / SettlementPending error sites", async () => {
    await openDirect();
    await assert.rejects(
      mode.write.settle([TOKEN], { account: stranger.account }),
      revertsWith("NotBinding"),
    );
    await firstBid();
    await assert.rejects(
      mode.write.settle([TOKEN], { account: stranger.account }),
      revertsWith("AuctionNotEnded"),
    );
    await settleAfterEnd();
    await assert.rejects(
      mode.write.bid([TOKEN, RESERVE * 2n], {
        account: bidder2.account,
        value: RESERVE * 2n,
      }),
      revertsWith("SettlementPending"),
    );
  });

  // ---- HELD + obligation answers ----

  it("obligation may: false for both intents while HELD; true after close", async () => {
    await openDirect();
    await firstBid();
    await settleAfterEnd();

    assert.equal(await mode.read.may([TOKEN, INTENT_LEAVE]), false);
    assert.equal(await mode.read.may([TOKEN, INTENT_OPEN]), false);
    assert.equal(await mode.read.hasUnresolvedSettlement([TOKEN]), true);

    await increaseTime(publicClient, PROTECTION + 2n);
    await mode.write.releaseFunds([TOKEN], { account: stranger.account });

    assert.equal(await mode.read.may([TOKEN, INTENT_LEAVE]), true);
    assert.equal(await mode.read.may([TOKEN, INTENT_OPEN]), true);
    assert.equal(await mode.read.hasUnresolvedSettlement([TOKEN]), false);
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 2); // Closed
  });

  it("confirmReceipt: buyer pays sellers immediately; NotHoldBuyer / NoHold", async () => {
    await openDirect();
    await firstBid();
    await settleAfterEnd();

    await assert.rejects(
      mode.write.confirmReceipt([TOKEN], { account: stranger.account }),
      revertsWith("NotHoldBuyer"),
    );

    const sellerBefore = await publicClient.getBalance({ address: owner.account.address });
    await mode.write.confirmReceipt([TOKEN], { account: buyer.account });
    const sellerAfter = await publicClient.getBalance({ address: owner.account.address });
    const platformFee = (RESERVE * PLATFORM_FEE_BPS) / 10_000n;
    assert.ok(sellerAfter >= sellerBefore + (RESERVE - platformFee) - parseEther("0.01"));

    await assert.rejects(
      mode.write.confirmReceipt([TOKEN], { account: buyer.account }),
      revertsWith("NoHold"),
    );
  });

  it("platformFeeBps snapshot: direct confirm uses open fee after live force", async () => {
    await deployMode({ harness: true });
    await openDirect();
    await firstBid();
    await mode.write.forceSetPlatformFeeBps([1000]);
    assert.equal(await mode.read.platformFeeBps(), 1000);
    await settleAfterEnd();
    const platformBefore = await publicClient.getBalance({ address: platform.account.address });
    await mode.write.confirmReceipt([TOKEN], { account: buyer.account });
    const platformAfter = await publicClient.getBalance({ address: platform.account.address });
    assert.equal(platformAfter - platformBefore, (RESERVE * PLATFORM_FEE_BPS) / 10_000n);
  });

  it("platformFeeBps snapshot: commission confirm uses open fee after live force", async () => {
    await deployMode({ harness: true });
    await activate(owner);
    await activate(agent);
    await mintAndApprove();
    const floor = parseEther("0.5");
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, floor, COMP_COMMISSION_500],
      { account: owner.account },
    );
    await mode.write.openAscendingFromMandate([TOKEN, RESERVE, DURATION, PROTECTION], {
      account: agent.account,
    });
    await firstBid();
    await mode.write.forceSetPlatformFeeBps([1000]);
    await settleAfterEnd();
    const platformBefore = await publicClient.getBalance({ address: platform.account.address });
    const agentBefore = await publicClient.getBalance({ address: agent.account.address });
    await mode.write.confirmReceipt([TOKEN], { account: buyer.account });
    const platformAfter = await publicClient.getBalance({ address: platform.account.address });
    const agentAfter = await publicClient.getBalance({ address: agent.account.address });
    const agentCut = (RESERVE * 500n) / 10_000n;
    assert.equal(platformAfter - platformBefore, (RESERVE * PLATFORM_FEE_BPS) / 10_000n);
    assert.equal(agentAfter - agentBefore, agentCut);
  });

  it("platformFeeBps snapshot: margin confirm uses open fee after live force", async () => {
    await deployMode({ harness: true });
    await activate(owner);
    await activate(agent);
    await mintAndApprove();
    const floor = parseEther("0.8");
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, floor, COMP_MARGIN],
      { account: owner.account },
    );
    await mode.write.openAscendingFromMandate([TOKEN, RESERVE, DURATION, PROTECTION], {
      account: agent.account,
    });
    await firstBid();
    await mode.write.forceSetPlatformFeeBps([1000]);
    await settleAfterEnd();
    const platformBefore = await publicClient.getBalance({ address: platform.account.address });
    const ownerBefore = await publicClient.getBalance({ address: owner.account.address });
    await mode.write.confirmReceipt([TOKEN], { account: buyer.account });
    const platformAfter = await publicClient.getBalance({ address: platform.account.address });
    const ownerAfter = await publicClient.getBalance({ address: owner.account.address });
    assert.equal(platformAfter - platformBefore, (RESERVE * PLATFORM_FEE_BPS) / 10_000n);
    assert.equal(ownerAfter - ownerBefore, floor);
  });

  it("releaseFunds: HoldNotReady before window; succeeds after", async () => {
    await openDirect();
    await firstBid();
    await settleAfterEnd();
    await assert.rejects(
      mode.write.releaseFunds([TOKEN], { account: stranger.account }),
      revertsWith("HoldNotReady"),
    );
    await increaseTime(publicClient, PROTECTION + 1n);
    await mode.write.releaseFunds([TOKEN], { account: stranger.account });
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 2);
  });

  // ---- Challenge outcomes + window resume ----

  it("CH4: withdrawn challenge resumes remaining protection (measured)", async () => {
    await deployMode({ minProtectionWindow: 1_000n, maxProtectionWindow: 10_000n, challengeWindow: 500n });
    await openDirect();
    await firstBid();
    await settleAfterEnd();

    const endsBefore = Number(await mode.read.holdProtectionEndsAt([TOKEN]));
    // Leave 400s on the window.
    const now1 = Number((await publicClient.getBlock()).timestamp);
    const remainingTarget = 400;
    await increaseTime(publicClient, BigInt(endsBefore - now1 - remainingTarget));

    const beforeOpen = Number((await publicClient.getBlock()).timestamp);
    const endsAtOpen = Number(await mode.read.holdProtectionEndsAt([TOKEN]));
    const remainingAtOpen = endsAtOpen - beforeOpen;
    assert.ok(remainingAtOpen >= 390 && remainingAtOpen <= 410, `remaining≈400 got ${remainingAtOpen}`);

    await mode.write.open([TOKEN], { account: buyer.account, value: BOND });
    const frozen = Number(await mode.read.holdFrozenRemaining([TOKEN]));
    assert.ok(frozen >= 390 && frozen <= 410, `frozen≈400 got ${frozen}`);

    await increaseTime(publicClient, 120n); // challenge open for 120s — must not consume protection
    await mode.write.withdraw([TOKEN], { account: buyer.account });

    const afterWithdraw = Number((await publicClient.getBlock()).timestamp);
    const endsAfter = Number(await mode.read.holdProtectionEndsAt([TOKEN]));
    const remainingAfter = endsAfter - afterWithdraw;
    assert.equal(Number(await mode.read.holdFrozenRemaining([TOKEN])), 0);
    assert.ok(
      Math.abs(remainingAfter - frozen) <= 2,
      `resume remaining ${remainingAfter} vs frozen ${frozen}`,
    );
    // Must not restart to full protection window.
    assert.ok(remainingAfter < Number(PROTECTION) / 2, "must not restart full window");
  });

  it("challenge: rejected pays seller; expired pays seller; upheld→abandon pays seller (CH5)", async () => {
    // Rejected
    await deployMode();
    await openDirect();
    await firstBid();
    await settleAfterEnd();
    await mode.write.open([TOKEN], { account: buyer.account, value: BOND });
    await activateJudge();
    await mode.write.judge([TOKEN, 1], { account: judge.account }); // Rejected = 1
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 2);
    assert.equal(await mode.read.hasUnresolvedSettlement([TOKEN]), false);

    // Expired
    await deployMode();
    await openDirect();
    await firstBid();
    await settleAfterEnd();
    await mode.write.open([TOKEN], { account: buyer.account, value: BOND });
    await increaseTime(publicClient, CHALLENGE_WINDOW + 2n);
    await mode.write.conclude([TOKEN], { account: stranger.account });
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 2);

    // Upheld → abandon (buyer disappears)
    await deployMode();
    await openDirect();
    await firstBid();
    await settleAfterEnd();
    await mode.write.open([TOKEN], { account: buyer.account, value: BOND });
    await activateJudge();
    await mode.write.judge([TOKEN, 0], { account: judge.account }); // Upheld
    assert.equal(await mode.read.holdReversalPending([TOKEN]), true);
    assert.equal(await mode.read.may([TOKEN, INTENT_LEAVE]), false);
    await assert.rejects(
      mode.write.abandonReversal([TOKEN], { account: stranger.account }),
      revertsWith("AbandonmentNotReady"),
    );
    await increaseTime(publicClient, ABANDONMENT + 2n);
    await mode.write.abandonReversal([TOKEN], { account: stranger.account });
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 2);
    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      buyer.account.address.toLowerCase(),
      "abandoned: passport stays with buyer; seller is paid",
    );
  });

  it("upheld → completeReversal: buyer returns passport and is paid; NotPassportHolder", async () => {
    await openDirect();
    await firstBid();
    await settleAfterEnd();
    await mode.write.open([TOKEN], { account: buyer.account, value: BOND });
    await activateJudge();
    await mode.write.judge([TOKEN, 0], { account: judge.account });

    // Move passport away so NotPassportHolder
    await passport.write.transferFrom([buyer.account.address, stranger.account.address, TOKEN], {
      account: buyer.account,
    });
    await assert.rejects(
      mode.write.completeReversal([TOKEN], { account: buyer.account }),
      revertsWith("NotPassportHolder"),
    );

    await passport.write.transferFrom([stranger.account.address, buyer.account.address, TOKEN], {
      account: stranger.account,
    });
    await passport.write.approve([mode.address, TOKEN], { account: buyer.account });

    const buyerBefore = await publicClient.getBalance({ address: buyer.account.address });
    await mode.write.completeReversal([TOKEN], { account: buyer.account });
    const buyerAfter = await publicClient.getBalance({ address: buyer.account.address });
    // Bond already returned on uphold; sale amount paid on complete. Gas makes exact hard — claim or balance.
    const claim = (await mode.read.pendingClaims([buyer.account.address, ZERO])) as bigint;
    assert.ok(
      buyerAfter + claim + parseEther("0.05") > buyerBefore + RESERVE - parseEther("0.05"),
      "buyer made whole on sale amount",
    );
    assert.equal(
      ((await passport.read.ownerOf([TOKEN])) as string).toLowerCase(),
      owner.account.address.toLowerCase(),
    );
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 3); // Returned
  });

  it("ProtectionElapsed / ReversalPending / NoReversalPending / NotEligible / exclusions / judge qualification", async () => {
    await openDirect();
    await firstBid();
    await settleAfterEnd();

    await increaseTime(publicClient, PROTECTION + 1n);
    await assert.rejects(
      mode.write.open([TOKEN], { account: buyer.account, value: BOND }),
      revertsWith("ProtectionElapsed"),
    );

    await deployMode();
    await openDirect();
    await firstBid();
    await settleAfterEnd();

    await assert.rejects(
      mode.write.open([TOKEN], { account: stranger.account, value: BOND }),
      revertsWith("NotEligibleChallenger"),
    );

    await mode.write.open([TOKEN], { account: buyer.account, value: BOND });
    await assert.rejects(
      mode.write.open([TOKEN], { account: buyer.account, value: BOND }),
      revertsWith("DisputeActive"),
    );

    // Distinguishable refusals: exclusion before qualification.
    // Party + inactive → still CannotResolveOwnDispute (order: exclusion first).
    await assert.rejects(
      mode.write.judge([TOKEN, 1], { account: buyer.account }),
      revertsWith("CannotResolveOwnDispute"),
    );
    // Party + active KarPro → still CannotResolveOwnDispute (joining does not fix party status).
    await activate(buyer);
    await assert.rejects(
      mode.write.judge([TOKEN, 1], { account: buyer.account }),
      revertsWith("CannotResolveOwnDispute"),
    );
    await activate(owner);
    await assert.rejects(
      mode.write.judge([TOKEN, 1], { account: owner.account }),
      revertsWith("CannotResolveOwnDispute"),
    );
    // Non-party + inactive → NotQualifiedJudge.
    await assert.rejects(
      mode.write.judge([TOKEN, 1], { account: judge.account }),
      revertsWith("NotQualifiedJudge"),
    );
    // Non-party + active KarPro → judge succeeds.
    await activateJudge();
    await mode.write.judge([TOKEN, 0], { account: judge.account });
    await assert.rejects(
      mode.write.open([TOKEN], { account: buyer.account, value: BOND }),
      revertsWith("ReversalPending"),
    );
    await assert.rejects(
      mode.write.confirmReceipt([TOKEN], { account: buyer.account }),
      revertsWith("ReversalPending"),
    );
    await assert.rejects(
      mode.write.completeReversal([TOKEN], { account: stranger.account }),
      revertsWith("NotHoldBuyer"),
    );

    // NoReversalPending when no upheld state
    await deployMode();
    await openDirect();
    await firstBid();
    await settleAfterEnd();
    await assert.rejects(
      mode.write.abandonReversal([TOKEN], { account: stranger.account }),
      revertsWith("NoReversalPending"),
    );
    await assert.rejects(
      mode.write.completeReversal([TOKEN], { account: buyer.account }),
      revertsWith("NoReversalPending"),
    );
  });

  it("WrongValue on bid / open bond; BadConfig on zero minIncrement set", async () => {
    await openDirect();
    await assert.rejects(
      mode.write.bid([TOKEN, RESERVE], { account: buyer.account, value: RESERVE / 2n }),
      revertsWith("WrongValue"),
    );
    await firstBid();
    await settleAfterEnd();
    await assert.rejects(
      mode.write.open([TOKEN], { account: buyer.account, value: 1n }),
      revertsWith("WrongValue"),
    );

    await assert.rejects(
      setAuctionRules({ minIncrementBps: 0n }),
      revertsWith("BadConfig"),
    );
  });

  it("H1 snapshot: protection frozen at settle from open terms; later lots use storage", async () => {
    await openDirect();
    await firstBid();
    assert.equal(Number(await mode.read.auctionProtectionWindow([TOKEN])), Number(PROTECTION));
    await settleAfterEnd();
    const ends = Number(await mode.read.holdProtectionEndsAt([TOKEN]));
    await setAuctionRules({ minProtectionWindow: 10n, maxProtectionWindow: 10n });
    assert.equal(Number(await mode.read.holdProtectionEndsAt([TOKEN])), ends);
    assert.equal(Number((await readAuctionRules()).minProtectionWindow), 10);
    assert.equal(Number((await readAuctionRules()).maxProtectionWindow), 10);

    await mode.write.confirmReceipt([TOKEN], { account: buyer.account });

    const tokenB = 2n;
    await activate(owner);
    await mintAndApprove(tokenB);
    await mode.write.openAscendingDirect([tokenB, ZERO, RESERVE, DURATION, 10n], {
      account: owner.account,
    });
    assert.equal(Number(await mode.read.auctionProtectionWindow([tokenB])), 10);
    await mode.write.bid([tokenB, RESERVE], { account: buyer.account, value: RESERVE });
    await increaseTime(publicClient, DURATION + 2n);
    const beforeSettle = await publicClient.getBlock();
    await mode.write.settle([tokenB], { account: stranger.account });
    const protectionEnds = Number(await mode.read.holdProtectionEndsAt([tokenB]));
    assert.ok(
      protectionEnds <= Number(beforeSettle.timestamp) + 12,
      `lot B protection ~10s from settle, got ${protectionEnds - Number(beforeSettle.timestamp)}`,
    );
  });

  it("snapshot: abandonmentWindow copied to Hold at settle; later upholds use storage", async () => {
    await openDirect();
    await firstBid();
    assert.equal(Number(await mode.read.auctionAbandonmentWindow([TOKEN])), Number(ABANDONMENT));
    await settleAfterEnd();
    assert.equal(Number(await mode.read.holdAbandonmentWindow([TOKEN])), Number(ABANDONMENT));

    await setAuctionRules({ abandonmentWindow: 50n });
    assert.equal(Number((await readAuctionRules()).abandonmentWindow), 50);
    assert.equal(Number(await mode.read.holdAbandonmentWindow([TOKEN])), Number(ABANDONMENT));

    await mode.write.open([TOKEN], { account: buyer.account, value: BOND });
    await activateJudge();
    const beforeUphold = await publicClient.getBlock();
    await mode.write.judge([TOKEN, 0], { account: judge.account }); // Upheld
    const deadlineA = Number(await mode.read.holdAbandonmentDeadline([TOKEN]));
    assert.ok(
      deadlineA >= Number(beforeUphold.timestamp) + Number(ABANDONMENT) - 2,
      "lot A uses snapshotted abandonment",
    );

    // Complete reversal so we can open token B (buyer returns NFT to seller).
    await passport.write.approve([mode.address, TOKEN], { account: buyer.account });
    await mode.write.completeReversal([TOKEN], { account: buyer.account });

    const tokenB = 2n;
    await activate(owner);
    await mintAndApprove(tokenB);
    await mode.write.openAscendingDirect([tokenB, ZERO, RESERVE, DURATION, PROTECTION], {
      account: owner.account,
    });
    assert.equal(Number(await mode.read.auctionAbandonmentWindow([tokenB])), 50);
    await mode.write.bid([tokenB, RESERVE], { account: buyer.account, value: RESERVE });
    await increaseTime(publicClient, DURATION + 2n);
    await mode.write.settle([tokenB], { account: stranger.account });
    assert.equal(Number(await mode.read.holdAbandonmentWindow([tokenB])), 50);
    await mode.write.open([tokenB], { account: buyer.account, value: BOND });
    await activateJudge();
    const beforeB = await publicClient.getBlock();
    await mode.write.judge([tokenB, 0], { account: judge.account });
    const deadlineB = Number(await mode.read.holdAbandonmentDeadline([tokenB]));
    assert.ok(
      deadlineB <= Number(beforeB.timestamp) + 55,
      `lot B abandonment ~50s, got ${deadlineB - Number(beforeB.timestamp)}`,
    );
  });

  it("money: agented commission split under escrowed bid (outcome)", async () => {
    await activate(owner);
    await activate(agent);
    await mintAndApprove();
    const floor = parseEther("0.5");
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, floor, COMP_COMMISSION_500],
      { account: owner.account },
    );
    await mode.write.openAscendingFromMandate([TOKEN, RESERVE, DURATION, PROTECTION], {
      account: agent.account,
    });
    await firstBid();
    await settleAfterEnd();

    const agentBefore = await publicClient.getBalance({ address: agent.account.address });
    const sellerBefore = await publicClient.getBalance({ address: owner.account.address });
    await mode.write.confirmReceipt([TOKEN], { account: buyer.account });
    const agentAfter = await publicClient.getBalance({ address: agent.account.address });
    const sellerAfter = await publicClient.getBalance({ address: owner.account.address });

    const platformFee = (RESERVE * PLATFORM_FEE_BPS) / 10_000n;
    // Commission: platform first; owner floored kept rate; agent residual (ether-scale = ⌊S·c/B⌋).
    const ownerAmt = (RESERVE * (10_000n - PLATFORM_FEE_BPS - 500n)) / 10_000n;
    const agentAmt = RESERVE - platformFee - ownerAmt;
    assert.equal(platformFee + ownerAmt + agentAmt, RESERVE);
    assert.ok(ownerAmt >= floor);
    assert.ok(agentAfter >= agentBefore + agentAmt - parseEther("0.01"));
    assert.ok(sellerAfter >= sellerBefore + ownerAmt - parseEther("0.01"));
  });

  // ---- PA1 outbid + refund reentrancy (commerce §15.2 step 4 carry-forward) ----

  it("PA1: outbid refund to reverting bidder credits claim; withdraw after accept", async () => {
    await openDirect();
    const reverting = await viem.deployContract("RevertingBidder", [mode.address]);
    await reverting.write.bidNative([TOKEN], { value: RESERVE });
    assert.equal(getAddress(await mode.read.auctionHighestBidder([TOKEN])), getAddress(reverting.address));

    const raise = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n;
    await mode.write.bid([TOKEN, raise], { account: bidder2.account, value: raise });

    assert.equal(getAddress(await mode.read.auctionHighestBidder([TOKEN])), getAddress(bidder2.account.address));
    assert.equal(await mode.read.pendingClaims([reverting.address, ZERO]), RESERVE);
    assert.equal(await mode.read.totalPendingNative(), RESERVE);

    await reverting.write.setAcceptEth([true]);
    await reverting.write.withdrawClaim([ZERO]);
    assert.equal(await mode.read.pendingClaims([reverting.address, ZERO]), 0n);
    assert.equal(await mode.read.totalPendingNative(), 0n);
  });

  it("reentrancy: reentrant bid during outbid refund fails; outer bid wins", async () => {
    await openDirect();
    const reentrant = await viem.deployContract("ReentrantBidder", [mode.address]);
    await reentrant.write.bidNative([TOKEN, RESERVE], { value: RESERVE });

    const raise = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n;
    // Fund the attacker so the receive-path reentry has value to spend — otherwise the
    // call fails on balance before nonReentrant is exercised.
    await owner.sendTransaction({ to: reentrant.address, value: raise });
    await reentrant.write.configure([TOKEN, raise]);
    await mode.write.bid([TOKEN, raise], { account: bidder2.account, value: raise });

    assert.equal(
      getAddress(await mode.read.auctionHighestBidder([TOKEN])),
      getAddress(bidder2.account.address),
    );
    assert.equal(await mode.read.auctionHighestBid([TOKEN]), raise);
    // nonReentrant aborts the nested bid → receive reverts → push fails → claim (PA1).
    assert.equal(await mode.read.pendingClaims([reentrant.address, ZERO]), RESERVE);
  });

  // ---- G3 pause + duration/bond setters + G4 UUPS ----

  it("G3: pause blocks openAscending* and bid; settle/challenge/claim still work", async () => {
    await openDirect();
    await firstBid();
    await mode.write.pause({ account: guardian.account });

    await assert.rejects(
      mode.write.bid([TOKEN, RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n], {
        account: bidder2.account,
        value: RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n,
      }),
      revertsWith("ContractPaused"),
    );

    const token2 = 2n;
    await activate(owner);
    await mintAndApprove(token2);
    await assert.rejects(
      mode.write.openAscendingDirect([token2, ZERO, RESERVE, DURATION, PROTECTION], {
        account: owner.account,
      }),
      revertsWith("ContractPaused"),
    );

    await settleAfterEnd();
    assert.equal(await mode.read.holdBuyer([TOKEN]), getAddress(buyer.account.address));

    await mode.write.open([TOKEN], { account: buyer.account, value: BOND });
    await activateJudge();
    await mode.write.judge([TOKEN, 1], { account: judge.account }); // Rejected
    assert.equal(await mode.read.holdBuyer([TOKEN]), ZERO);

    await mode.write.unpause({ account: owner.account });
    await mode.write.openAscendingDirect([token2, ZERO, RESERVE, DURATION, PROTECTION], {
      account: owner.account,
    });
  });

  it("setAuctionRules: inverted duration / zero bond revert; live duration + open challenge bond snapshotted", async () => {
    await openDirect();
    const durationAtOpen = (await mode.read.auctionDuration([TOKEN])) as bigint;
    await assert.rejects(
      setAuctionRules({ minDuration: MAX_DURATION + 1n }),
      revertsWith("BadConfig"),
    );
    await assert.rejects(
      setAuctionRules({ maxDuration: MIN_DURATION - 1n }),
      revertsWith("BadConfig"),
    );
    await assert.rejects(
      setAuctionRules({ challengeBond: 0n }),
      revertsWith("BadConfig"),
    );

    await setAuctionRules({
      minDuration: MIN_DURATION + 10n,
      maxDuration: MAX_DURATION - 10n,
    });
    assert.equal(await mode.read.auctionDuration([TOKEN]), durationAtOpen);

    await firstBid();
    await settleAfterEnd();
    await mode.write.open([TOKEN], { account: buyer.account, value: BOND });
    const frozenBond = (await mode.read.challengeBondAmount([TOKEN])) as bigint;
    assert.equal(frozenBond, BOND);
    const newBond = BOND * 2n;
    await setAuctionRules({ challengeBond: newBond });
    assert.equal((await readAuctionRules()).challengeBond, newBond);
    assert.equal(await mode.read.challengeBondAmount([TOKEN]), frozenBond);
  });

  it("G4: owner upgrade preserves auction + pendingClaims; non-owner cannot upgrade", async () => {
    await openDirect();
    await firstBid();
    const endsAt = (await mode.read.auctionEndsAt([TOKEN])) as bigint;
    const libraries = await deployAscendingLibraries(viem);
    const nextImpl = await viem.deployContract("AscendingConsignment", [], { libraries });
    await assert.rejects(
      mode.write.upgradeToAndCall([nextImpl.address, "0x"], { account: stranger.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );
    await mode.write.upgradeToAndCall([nextImpl.address, "0x"], { account: owner.account });
    assert.equal(await mode.read.VERSION(), "2.3.0-rc.1");
    assert.equal(await mode.read.auctionEndsAt([TOKEN]), endsAt);
    assert.equal(await mode.read.auctionHighestBid([TOKEN]), RESERVE);
  });

  // ---- Encumbrance registration gate + G3 revoke ----

  it("ModeNotEncumbranceSource: direct and mandate open refuse when unregistered", async () => {
    await passport.write.setEncumbranceSource([mode.address, false]);
    await activate(owner);
    await mintAndApprove();
    await assert.rejects(
      mode.write.openAscendingDirect([TOKEN, ZERO, RESERVE, DURATION, PROTECTION], {
        account: owner.account,
      }),
      revertsWith("ModeNotEncumbranceSource"),
    );
    await mode.write.grant(
      [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, parseEther("0.5"), COMP_MARGIN],
      { account: owner.account },
    );
    await activate(agent);
    await assert.rejects(
      mode.write.openAscendingFromMandate([TOKEN, RESERVE, DURATION, PROTECTION], {
        account: agent.account,
      }),
      revertsWith("ModeNotEncumbranceSource"),
    );
  });

  it("open succeeds once registered; refused again after source removed", async () => {
    await passport.write.setEncumbranceSource([mode.address, false]);
    await activate(owner);
    await mintAndApprove();
    await assert.rejects(
      mode.write.openAscendingDirect([TOKEN, ZERO, RESERVE, DURATION, PROTECTION], {
        account: owner.account,
      }),
      revertsWith("ModeNotEncumbranceSource"),
    );
    await passport.write.setEncumbranceSource([mode.address, true]);
    await mode.write.openAscendingDirect([TOKEN, ZERO, RESERVE, DURATION, PROTECTION], {
      account: owner.account,
    });
    assert.equal(await mode.read.consignmentPhase([TOKEN]), 1);
    await mode.write.ownerWithdraw([TOKEN], { account: owner.account });

    await passport.write.setEncumbranceSource([mode.address, false]);
    const token2 = TOKEN + 1n;
    await mintAndApprove(token2);
    await assert.rejects(
      mode.write.openAscendingDirect([token2, ZERO, RESERVE, DURATION, PROTECTION], {
        account: owner.account,
      }),
      revertsWith("ModeNotEncumbranceSource"),
    );
  });

  it("live consignment still settles after encumbrance source removed", async () => {
    await openDirect();
    await firstBid();
    await passport.write.setEncumbranceSource([mode.address, false]);
    await settleAfterEnd();
    assert.equal(await mode.read.hasUnresolvedSettlement([TOKEN]), true);
    await increaseTime(publicClient, PROTECTION + 2n);
    await mode.write.releaseFunds([TOKEN], { account: stranger.account });
    assert.equal(await mode.read.hasUnresolvedSettlement([TOKEN]), false);
  });

  it("G3 revoke: guardian can revoke, cannot approve; mid-sale bid+settle still works", async () => {
    const usdc = await viem.deployContract("MockERC20Decimals", ["USDC", "USDC", 6]);
    await mode.write.approvePaymentToken([usdc.address], { account: owner.account });

    await assert.rejects(
      mode.write.approvePaymentToken([usdc.address], { account: guardian.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );
    await assert.rejects(
      mode.write.revokePaymentToken([usdc.address], { account: stranger.account }),
      revertsWith("NotGuardianOrOwner"),
    );

    await activate(owner);
    await mintAndApprove();
    const reserve = 100n * 10n ** 6n;
    await mode.write.openAscendingDirect([TOKEN, usdc.address, reserve, DURATION, PROTECTION], {
      account: owner.account,
    });
    await mode.write.revokePaymentToken([usdc.address], { account: guardian.account });
    assert.equal(await mode.read.paymentTokenEnabled([usdc.address]), false);

    await usdc.write.mint([buyer.account.address, reserve * 2n]);
    await usdc.write.approve([mode.address, reserve * 2n], { account: buyer.account });
    await mode.write.bid([TOKEN, reserve], { account: buyer.account });
    await settleAfterEnd();
    assert.equal(await mode.read.hasUnresolvedSettlement([TOKEN]), true);

    // New open in revoked asset refused.
    const token2 = TOKEN + 1n;
    await mintAndApprove(token2);
    await assert.rejects(
      mode.write.openAscendingDirect([token2, usdc.address, reserve, DURATION, PROTECTION], {
        account: owner.account,
      }),
      revertsWith("PaymentTokenNotSupported"),
    );

    await mode.write.approvePaymentToken([usdc.address], { account: owner.account });
    await mode.write.revokePaymentToken([usdc.address], { account: owner.account });
    assert.equal(await mode.read.paymentTokenEnabled([usdc.address]), false);
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

    it("ConsignmentOpened + AscendingTermsSnapshotted match open snapshot", async () => {
      await openDirect();
      const opened = await lastEvent("ConsignmentOpened");
      const a = opened.args as {
        tokenId: bigint;
        seller: string;
        agent: string;
        price: bigint;
        platformFeeBps: number;
        openedAt: bigint;
      };
      assert.equal(a.tokenId, TOKEN);
      assert.equal(a.seller.toLowerCase(), owner.account.address.toLowerCase());
      assert.equal(a.agent, ZERO);
      assert.equal(a.price, RESERVE);
      assert.equal(BigInt(a.platformFeeBps), PLATFORM_FEE_BPS);
      assert.equal(a.openedAt, await mode.read.consignmentOpenedAt([TOKEN]));
      assert.equal(await mode.read.consignmentPriceOf([TOKEN]), a.price);

      const terms = await lastEvent("AscendingTermsSnapshotted");
      const t = terms.args as {
        tokenId: bigint;
        duration: number;
        extensionWindow: number;
        protectionWindow: number;
        abandonmentWindow: number;
        minIncrementBps: number;
        reserve: bigint;
      };
      assert.equal(t.tokenId, TOKEN);
      assert.equal(BigInt(t.duration), DURATION);
      assert.equal(BigInt(t.extensionWindow), EXTENSION);
      assert.equal(BigInt(t.protectionWindow), PROTECTION);
      assert.equal(BigInt(t.abandonmentWindow), ABANDONMENT);
      assert.equal(BigInt(t.minIncrementBps), MIN_INCREMENT_BPS);
      assert.equal(t.reserve, RESERVE);
      assert.equal(BigInt(await mode.read.auctionDuration([TOKEN])), BigInt(t.duration));
      assert.equal(BigInt(await mode.read.auctionExtensionWindow([TOKEN])), BigInt(t.extensionWindow));
    });

    it("BidRefunded matches prior bid; ChallengeOpened/Judged + ReversalStarted match hold", async () => {
      await openDirect();
      await firstBid();
      const minNext = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n;
      await mode.write.bid([TOKEN, minNext], { account: bidder2.account, value: minNext });
      const refunded = await lastEvent("BidRefunded");
      const r = refunded.args as {
        tokenId: bigint;
        bidder: string;
        asset: string;
        amount: bigint;
      };
      assert.equal(r.tokenId, TOKEN);
      assert.equal(r.bidder.toLowerCase(), buyer.account.address.toLowerCase());
      assert.equal(r.asset, ZERO);
      assert.equal(r.amount, RESERVE);

      await settleAfterEnd();
      // Hold buyer is bidder2 after outbid.
      await activateJudge();
      await mode.write.open([TOKEN], { account: bidder2.account, value: BOND });
      const chal = await lastEvent("ChallengeOpened");
      const c = chal.args as {
        subjectId: bigint;
        challenger: string;
        bondAmount: bigint;
        windowDuration: bigint;
        openedAt: bigint;
      };
      assert.equal(c.subjectId, TOKEN);
      assert.equal(c.challenger.toLowerCase(), bidder2.account.address.toLowerCase());
      assert.equal(c.bondAmount, BOND);
      assert.equal(c.bondAmount, await mode.read.challengeBondAmount([TOKEN]));
      assert.equal(c.openedAt, await mode.read.challengeOpenedAt([TOKEN]));
      assert.equal(c.windowDuration, await mode.read.challengeWindowDuration([TOKEN]));

      await mode.write.judge([TOKEN, 0], { account: judge.account }); // Upheld
      const judged = await lastEvent("ChallengeJudged");
      const j = judged.args as {
        subjectId: bigint;
        outcome: number;
        bondRecipient: string;
        judge: string;
      };
      assert.equal(j.subjectId, TOKEN);
      assert.equal(j.outcome, 0);
      assert.equal(j.judge.toLowerCase(), judge.account.address.toLowerCase());
      assert.equal(j.bondRecipient.toLowerCase(), bidder2.account.address.toLowerCase());

      const rev = await lastEvent("ReversalStarted");
      const rs = rev.args as {
        tokenId: bigint;
        buyer: string;
        abandonmentDeadline: bigint;
      };
      assert.equal(rs.tokenId, TOKEN);
      assert.equal(rs.buyer.toLowerCase(), bidder2.account.address.toLowerCase());
      assert.equal(rs.abandonmentDeadline, await mode.read.holdAbandonmentDeadline([TOKEN]));
      assert.equal(await mode.read.holdReversalPending([TOKEN]), true);
    });

    it("MandateGranted matches mandate views; ConsignmentSplitPaid matches Closed Sold path", async () => {
      await activate(owner);
      await activate(agent);
      await mintAndApprove();
      const floor = parseEther("0.5");
      await mode.write.grant(
        [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, floor, COMP_MARGIN],
        { account: owner.account },
      );
      const granted = await lastEvent("MandateGranted");
      const g = granted.args as {
        tokenId: bigint;
        agent: string;
        floor: bigint;
        asset: string;
      };
      assert.equal(g.tokenId, TOKEN);
      assert.equal(g.agent.toLowerCase(), agent.account.address.toLowerCase());
      assert.equal(g.floor, floor);
      assert.equal(g.floor, await mode.read.mandateFloor([TOKEN]));
      assert.equal(await mode.read.mandateActive([TOKEN]), true);

      await mode.write.openAscendingFromMandate([TOKEN, RESERVE, DURATION, PROTECTION], {
        account: agent.account,
      });
      await firstBid();
      await settleAfterEnd();
      await increaseTime(publicClient, BigInt(Number(PROTECTION) + 2));
      await mode.write.releaseFunds([TOKEN], { account: stranger.account });

      const split = await lastEvent("ConsignmentSplitPaid");
      const s = split.args as {
        tokenId: bigint;
        ownerAmount: bigint;
        agentAmount: bigint;
        platformAmount: bigint;
      };
      assert.equal(s.tokenId, TOKEN);
      const platform = (RESERVE * PLATFORM_FEE_BPS) / 10_000n;
      assert.equal(s.platformAmount, platform);
      assert.equal(s.ownerAmount, floor);
      assert.equal(s.agentAmount, RESERVE - platform - floor);

      const closed = await lastEvent("ConsignmentClosed");
      assert.equal((closed.args as { tokenId: bigint; reason: number }).tokenId, TOKEN);
      assert.equal((closed.args as { reason: number }).reason, 3); // HoldReleased
      assert.equal(await mode.read.consignmentPhase([TOKEN]), 2); // Closed
    });
  });

  it("gas sample: bid / outbid / settle / confirmReceipt (EIP-170 fit report)", async () => {
    await openDirect();
    const bidHash = await mode.write.bid([TOKEN, RESERVE], {
      account: buyer.account,
      value: RESERVE,
    });
    const bidReceipt = await publicClient.waitForTransactionReceipt({ hash: bidHash });
    const minNext = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n;
    const outHash = await mode.write.bid([TOKEN, minNext], {
      account: bidder2.account,
      value: minNext,
    });
    const outReceipt = await publicClient.waitForTransactionReceipt({ hash: outHash });
    await increaseTime(publicClient, BigInt(Number(DURATION) + 2));
    const settleHash = await mode.write.settle([TOKEN], { account: stranger.account });
    const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleHash });
    const confirmHash = await mode.write.confirmReceipt([TOKEN], { account: bidder2.account });
    const confirmReceipt = await publicClient.waitForTransactionReceipt({ hash: confirmHash });
    process.stdout.write("\n--- Ascending gas sample ---\n");
    process.stdout.write(`| bid (first) | ${bidReceipt.gasUsed} |\n`);
    process.stdout.write(`| bid (outbid) | ${outReceipt.gasUsed} |\n`);
    process.stdout.write(`| settle | ${settleReceipt.gasUsed} |\n`);
    process.stdout.write(`| confirmReceipt | ${confirmReceipt.gasUsed} |\n\n`);
  });

  async function ascendingTokenEnabled(token: `0x${string}`): Promise<boolean> {
    return Boolean(await mode.read.paymentTokenEnabled([token]));
  }

  it("TokenHasNoCode on approvePaymentToken; retry still refuses", async () => {
    const eoa = stranger.account.address;
    await assert.rejects(
      mode.write.approvePaymentToken([eoa], { account: owner.account }),
      revertsWith("TokenHasNoCode"),
    );
    assert.equal(await ascendingTokenEnabled(eoa), false);
    await assert.rejects(
      mode.write.approvePaymentToken([eoa], { account: owner.account }),
      revertsWith("TokenHasNoCode"),
    );
  });

  it("TokenDecimalsUnavailable on approvePaymentToken; retry still refuses", async () => {
    const bad = await viem.deployContract("NoDecimalsErc20", []);
    await assert.rejects(
      mode.write.approvePaymentToken([bad.address], { account: owner.account }),
      revertsWith("TokenDecimalsUnavailable"),
    );
    assert.equal(await ascendingTokenEnabled(bad.address), false);
    await assert.rejects(
      mode.write.approvePaymentToken([bad.address], { account: owner.account }),
      revertsWith("TokenDecimalsUnavailable"),
    );
  });

  describe("S36 ShortDelivery on ERC-20 bid", () => {
    it("fee-on-transfer token reverts ShortDelivery; no standing bid recorded", async () => {
      const feeToken = await viem.deployContract("MockFeeToken", [1000n]); // 10%
      await mode.write.approvePaymentToken([feeToken.address], { account: owner.account });

      await activate(owner);
      await mintAndApprove();
      const reserve = 1_000_000n;
      await mode.write.openAscendingDirect([TOKEN, feeToken.address, reserve, DURATION, PROTECTION], {
        account: owner.account,
      });

      await feeToken.write.mint([buyer.account.address, reserve]);
      await feeToken.write.approve([mode.address, reserve], { account: buyer.account });

      await assert.rejects(
        mode.write.bid([TOKEN, reserve], { account: buyer.account }),
        revertsWith("ShortDelivery"),
      );

      assert.equal(await mode.read.auctionHighestBid([TOKEN]), 0n);
      assert.equal(await feeToken.read.balanceOf([mode.address]), 0n);
      assert.equal(await mode.read.consignmentPhase([TOKEN]), 1);
    });

    it("zero-fee ERC-20 bid records the requested amount", async () => {
      const feeToken = await viem.deployContract("MockFeeToken", [0n]);
      await mode.write.approvePaymentToken([feeToken.address], { account: owner.account });

      await activate(owner);
      await mintAndApprove();
      const reserve = 1_000_000n;
      await mode.write.openAscendingDirect([TOKEN, feeToken.address, reserve, DURATION, PROTECTION], {
        account: owner.account,
      });

      await feeToken.write.mint([buyer.account.address, reserve]);
      await feeToken.write.approve([mode.address, reserve], { account: buyer.account });
      await mode.write.bid([TOKEN, reserve], { account: buyer.account });

      assert.equal(await mode.read.auctionHighestBid([TOKEN]), reserve);
      assert.equal(
        getAddress(await mode.read.auctionHighestBidder([TOKEN])),
        getAddress(buyer.account.address),
      );
      assert.equal(await feeToken.read.balanceOf([mode.address]), reserve);
    });
  });
});
