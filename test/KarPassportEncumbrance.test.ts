import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress } from "viem";

import {
  DISPUTE_DEPOSIT,
  deployPassportStack,
  increaseTime,
  joinVerifier,
  mintPassport,
  ZERO,
  asReadTuple,
  asReadHex,
} from "../scripts/lib/local-stack.js";

const DISPUTE_WINDOW = 14n * 24n * 60n * 60n;
const INTENT_LEAVE = 0;
const INTENT_OPEN = 1;

function revertsWith(errorName: string) {
  return (err: unknown) => err instanceof Error && err.message.includes(errorName);
}

function revertsWithSourceUnanswerable(source: `0x${string}`) {
  const named = revertsWith("SourceUnanswerable");
  const needle = source.toLowerCase().slice(2);
  return (err: unknown) =>
    named(err) && err instanceof Error && err.message.toLowerCase().includes(needle);
}

/** Status-only “permission” — the second implementation E5 forbids. */
function permissionFromStatusAlone(status: number, intent: number): boolean {
  // Invented rule: both intents require VERIFIED (wrong for LeaveChain).
  if (status !== 1) return false;
  void intent;
  return true;
}

describe("KarPassport encumbrance + verification challenge", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  async function stackWithToken(
    viem: Awaited<ReturnType<typeof hardhat.network.connect>>["viem"],
  ) {
    const stack = await deployPassportStack(viem);
    const tokenId = await mintPassport(
      stack.passport,
      stack.owner,
      stack.owner.account.address,
      "ar://enc",
    );
    return { ...stack, tokenId };
  }

  async function verified(
    viem: Awaited<ReturnType<typeof hardhat.network.connect>>["viem"],
  ) {
    const stack = await stackWithToken(viem);
    await joinVerifier(stack.staking, stack.verifier);
    await stack.passport.write.verifyPassport([stack.tokenId], {
      account: stack.verifier.account,
    });
    return stack;
  }

  // ---- Permission table ----

  it("S30: challenge config windowDuration and forfeitRecipient match ctor", async () => {
    const { viem } = connection;
    const { passport, admin } = await deployPassportStack(viem);
    assert.equal(await passport.read.windowDuration(), DISPUTE_WINDOW);
    assert.equal(await passport.read.DISPUTE_WINDOW(), DISPUTE_WINDOW);
    assert.equal(
      getAddress(asReadHex(await passport.read.forfeitRecipient())),
      getAddress(admin.account.address),
    );
  });

  it("permission: UNVERIFIED idle — Open true, Leave true", async () => {
    const { viem } = connection;
    const { passport, tokenId } = await stackWithToken(viem);
    assert.equal(await passport.read.may([tokenId, INTENT_OPEN]), true);
    assert.equal(await passport.read.may([tokenId, INTENT_LEAVE]), true);
  });

  it("permission: VERIFIED idle — Open true, Leave true", async () => {
    const { viem } = connection;
    const { passport, tokenId } = await verified(viem);
    assert.equal(await passport.read.may([tokenId, INTENT_OPEN]), true);
    assert.equal(await passport.read.may([tokenId, INTENT_LEAVE]), true);
  });

  it("permission: challenged — Open false, Leave false", async () => {
    const { viem } = connection;
    const { passport, tokenId, owner } = await verified(viem);
    await passport.write.open([tokenId], { account: owner.account, value: DISPUTE_DEPOSIT });
    assert.equal(await passport.read.may([tokenId, INTENT_OPEN]), false);
    assert.equal(await passport.read.may([tokenId, INTENT_LEAVE]), false);
  });

  it("permission: VERIFIED + registered source forbids both", async () => {
    const { viem } = connection;
    const { passport, tokenId, admin } = await verified(viem);
    const source = await viem.deployContract("MockEncumbranceSource", []);
    await source.write.setAllow([false, false]);
    await passport.write.addEncumbranceSource([source.address], { account: admin.account });
    assert.equal(await passport.read.may([tokenId, INTENT_OPEN]), false);
    assert.equal(await passport.read.may([tokenId, INTENT_LEAVE]), false);
  });

  it("permission: VERIFIED + registered source allows both", async () => {
    const { viem } = connection;
    const { passport, tokenId, admin } = await verified(viem);
    const source = await viem.deployContract("MockEncumbranceSource", []);
    await source.write.setAllow([true, true]);
    await passport.write.addEncumbranceSource([source.address], { account: admin.account });
    assert.equal(await passport.read.may([tokenId, INTENT_OPEN]), true);
    assert.equal(await passport.read.may([tokenId, INTENT_LEAVE]), true);
  });

  it("E5-by-behaviour: status-alone diverges from may on Open×UNVERIFIED and Leave×UNVERIFIED", async () => {
    const { viem } = connection;
    const { passport, tokenId } = await stackWithToken(viem);
    const [status] = (await passport.read.getPassportStatus([tokenId])) as [number, string, bigint];
    assert.equal(status, 0);
    assert.equal(permissionFromStatusAlone(status, INTENT_OPEN), false);
    assert.equal(permissionFromStatusAlone(status, INTENT_LEAVE), false);
    assert.equal(await passport.read.may([tokenId, INTENT_OPEN]), true);
    assert.equal(await passport.read.may([tokenId, INTENT_LEAVE]), true);
  });

  // ---- Registry ----

  it("registry: owner add/remove; stranger cannot; unregistered opinion ignored", async () => {
    const { viem } = connection;
    const { passport, tokenId, admin, stranger } = await verified(viem);
    const source = await viem.deployContract("MockEncumbranceSource", []);
    await source.write.setAllow([false, false]);

    // Unregistered: forbidding opinion counts for nothing.
    assert.equal(await passport.read.may([tokenId, INTENT_OPEN]), true);

    await assert.rejects(
      passport.write.addEncumbranceSource([source.address], { account: stranger.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );

    await passport.write.addEncumbranceSource([source.address], { account: admin.account });
    assert.equal(await passport.read.isEncumbranceSource([source.address]), true);
    assert.equal(await passport.read.may([tokenId, INTENT_OPEN]), false);

    await assert.rejects(
      passport.write.removeEncumbranceSource([source.address], { account: stranger.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );

    await passport.write.removeEncumbranceSource([source.address], { account: admin.account });
    assert.equal(await passport.read.isEncumbranceSource([source.address]), false);
    assert.equal(await passport.read.may([tokenId, INTENT_OPEN]), true);
  });

  it("registry: duplicate add and unknown remove revert", async () => {
    const { viem } = connection;
    const { passport, admin } = await verified(viem);
    const source = await viem.deployContract("MockEncumbranceSource", []);
    await passport.write.addEncumbranceSource([source.address], { account: admin.account });
    await assert.rejects(
      passport.write.addEncumbranceSource([source.address], { account: admin.account }),
      revertsWith("SourceAlreadyRegistered"),
    );
    await assert.rejects(
      passport.write.removeEncumbranceSource([admin.account.address], { account: admin.account }),
      revertsWith("SourceNotRegistered"),
    );
  });

  it("registry: MAX_ENCUMBRANCE_SOURCES=8; ninth rejects; remove frees a slot", async () => {
    const { viem } = connection;
    const { passport, admin } = await verified(viem);
    const max = Number(await passport.read.MAX_ENCUMBRANCE_SOURCES());
    assert.equal(max, 8);
    const sources: `0x${string}`[] = [];
    for (let i = 0; i < max; i++) {
      const source = await viem.deployContract("MockEncumbranceSource", []);
      sources.push(source.address);
      await passport.write.addEncumbranceSource([source.address], { account: admin.account });
    }
    assert.equal(await passport.read.encumbranceSourceCount(), BigInt(max));
    const ninth = await viem.deployContract("MockEncumbranceSource", []);
    await assert.rejects(
      passport.write.addEncumbranceSource([ninth.address], { account: admin.account }),
      revertsWith("TooManyEncumbranceSources"),
    );
    await passport.write.removeEncumbranceSource([sources[0]!], { account: admin.account });
    await passport.write.addEncumbranceSource([ninth.address], { account: admin.account });
    assert.equal(await passport.read.encumbranceSourceCount(), BigInt(max));
    assert.equal(await passport.read.isEncumbranceSource([ninth.address]), true);
  });

  it("registry: remove while source would forbid — obligation stops counting", async () => {
    const { viem } = connection;
    const { passport, tokenId, admin } = await verified(viem);
    const source = await viem.deployContract("MockEncumbranceSource", []);
    await source.write.setAllow([false, false]);
    await passport.write.addEncumbranceSource([source.address], { account: admin.account });
    assert.equal(await passport.read.may([tokenId, INTENT_LEAVE]), false);
    await passport.write.removeEncumbranceSource([source.address], { account: admin.account });
    // Source still forbids if asked directly, but passport no longer consults it.
    assert.equal(await source.read.may([tokenId, INTENT_LEAVE]), false);
    assert.equal(await passport.read.may([tokenId, INTENT_LEAVE]), true);
  });

  // ---- E6: unanswerable source refuses by name ----

  it("E6: reverting source → SourceUnanswerable(source)", async () => {
    const { viem } = connection;
    const { passport, tokenId, admin } = await verified(viem);
    const broken = await viem.deployContract("RevertingEncumbranceSource", []);
    await passport.write.addEncumbranceSource([broken.address], { account: admin.account });
    await assert.rejects(
      passport.read.may([tokenId, INTENT_OPEN]),
      revertsWithSourceUnanswerable(broken.address),
    );
  });

  it("E6: empty returndata → SourceUnanswerable(source)", async () => {
    const { viem } = connection;
    const { passport, tokenId, admin } = await verified(viem);
    const broken = await viem.deployContract("EmptyReturnEncumbranceSource", []);
    await passport.write.addEncumbranceSource([broken.address], { account: admin.account });
    await assert.rejects(
      passport.read.may([tokenId, INTENT_LEAVE]),
      revertsWithSourceUnanswerable(broken.address),
    );
  });

  it("E6: unreadable returndata → SourceUnanswerable(source)", async () => {
    const { viem } = connection;
    const { passport, tokenId, admin } = await verified(viem);
    const broken = await viem.deployContract("UnreadableReturnEncumbranceSource", []);
    await passport.write.addEncumbranceSource([broken.address], { account: admin.account });
    await assert.rejects(
      passport.read.may([tokenId, INTENT_OPEN]),
      revertsWithSourceUnanswerable(broken.address),
    );
  });

  it("E6: gas exhaustion within SOURCE_MAY_GAS → SourceUnanswerable(source)", async () => {
    const { viem } = connection;
    const { passport, tokenId, admin } = await verified(viem);
    assert.equal(await passport.read.SOURCE_MAY_GAS(), 100_000n);
    const broken = await viem.deployContract("GasBurningEncumbranceSource", []);
    await passport.write.addEncumbranceSource([broken.address], { account: admin.account });
    await assert.rejects(
      passport.read.may([tokenId, INTENT_LEAVE]),
      revertsWithSourceUnanswerable(broken.address),
    );
  });

  it("E6: healthy source alongside broken does not rescue — one unanswerable refuses", async () => {
    const { viem } = connection;
    const { passport, tokenId, admin } = await verified(viem);
    const healthy = await viem.deployContract("MockEncumbranceSource", []);
    await healthy.write.setAllow([true, true]);
    const broken = await viem.deployContract("RevertingEncumbranceSource", []);
    await passport.write.addEncumbranceSource([healthy.address], { account: admin.account });
    await passport.write.addEncumbranceSource([broken.address], { account: admin.account });
    await assert.rejects(
      passport.read.may([tokenId, INTENT_OPEN]),
      revertsWithSourceUnanswerable(broken.address),
    );
  });

  it("E6: governed remove of unanswerable source restores service", async () => {
    const { viem } = connection;
    const { passport, tokenId, admin, stranger } = await verified(viem);
    const broken = await viem.deployContract("EmptyReturnEncumbranceSource", []);
    await passport.write.addEncumbranceSource([broken.address], { account: admin.account });
    await assert.rejects(
      passport.read.may([tokenId, INTENT_OPEN]),
      revertsWithSourceUnanswerable(broken.address),
    );
    await assert.rejects(
      passport.write.removeEncumbranceSource([broken.address], { account: stranger.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );
    await passport.write.removeEncumbranceSource([broken.address], { account: admin.account });
    assert.equal(await passport.read.may([tokenId, INTENT_OPEN]), true);
    assert.equal(await passport.read.may([tokenId, INTENT_LEAVE]), true);
  });

  // ---- Challenge domain + parity ----

  it("challenge: exact WrongValue; anyone opens; terminals lapse/stand", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const wallets = await viem.getWalletClients();
    const stack = await verified(viem);
    const { passport, tokenId, owner, stranger, staking, verifier } = stack;
    // Must not be platformRecipient (admin) — Reject routes bond there (CH2).
    const resolver = wallets[4]!;

    await assert.rejects(
      passport.write.open([tokenId], { account: owner.account, value: 1n }),
      revertsWith("WrongValue"),
    );

    // Anyone may open (stranger).
    await passport.write.open([tokenId], { account: stranger.account, value: DISPUTE_DEPOSIT });
    assert.equal(await passport.read.totalLockedBonds(), DISPUTE_DEPOSIT);
    assert.equal(getAddress(asReadHex(await passport.read.challengeChallenger([tokenId]))), getAddress(stranger.account.address));
    const [disputed] = asReadTuple(await passport.read.getPassportStatus([tokenId]));
    assert.equal(disputed, 2);

    // Exclusion: opener (even if KarPro) cannot judge.
    await joinVerifier(staking, stranger);
    await assert.rejects(
      passport.write.judge([tokenId, 1], { account: stranger.account }),
      revertsWith("CannotResolveOwnDispute"),
    );

    // Independent KarPro rejects → stand VERIFIED.
    await joinVerifier(staking, resolver);
    await passport.write.judge([tokenId, 1], { account: resolver.account });
    const [stood] = asReadTuple(await passport.read.getPassportStatus([tokenId]));
    assert.equal(stood, 1);
    assert.equal(await passport.read.totalLockedBonds(), 0n);

    // Upheld → lapse.
    await passport.write.open([tokenId], { account: stranger.account, value: DISPUTE_DEPOSIT });
    await passport.write.judge([tokenId, 0], { account: resolver.account });
    const [lapsed, recordedVerifier] = asReadTuple(await passport.read.getPassportStatus([tokenId]));
    assert.equal(lapsed, 0);
    assert.equal(recordedVerifier, ZERO);

    // Expire → lapse.
    await passport.write.verifyPassport([tokenId], { account: verifier.account });
    await passport.write.open([tokenId], { account: stranger.account, value: DISPUTE_DEPOSIT });
    await increaseTime(publicClient, DISPUTE_WINDOW + 1n);
    await passport.write.conclude([tokenId], { account: owner.account });
    const [expired] = asReadTuple(await passport.read.getPassportStatus([tokenId]));
    assert.equal(expired, 0);
  });

  it("challenge: withdraw restores VERIFIED; NotQualifiedJudge for inactive", async () => {
    const { viem } = connection;
    const { passport, tokenId, owner, stranger } = await verified(viem);
    await passport.write.open([tokenId], { account: owner.account, value: DISPUTE_DEPOSIT });
    await assert.rejects(
      passport.write.judge([tokenId, 1], { account: stranger.account }),
      revertsWith("NotQualifiedJudge"),
    );
    await passport.write.withdraw([tokenId], { account: owner.account });
    const [status] = asReadTuple(await passport.read.getPassportStatus([tokenId]));
    assert.equal(status, 1);
    assert.equal(await passport.read.totalLockedBonds(), 0n);
  });

  it("rescue: cannot reach active bond; free after terminal", async () => {
    const { viem } = connection;
    const { passport, tokenId, owner, admin, stranger, staking } = await verified(viem);
    await passport.write.open([tokenId], { account: owner.account, value: DISPUTE_DEPOSIT });
    await assert.rejects(
      passport.write.rescueExcessEth([admin.account.address, DISPUTE_DEPOSIT], {
        account: admin.account,
      }),
      revertsWith("NothingToRescue"),
    );
    await joinVerifier(staking, stranger);
    await passport.write.judge([tokenId, 1], { account: stranger.account });
    assert.equal(await passport.read.totalLockedBonds(), 0n);
    // No excess ETH left after bond routed to platform (admin) — still NothingToRescue if balance==0.
    const bal = await (await viem.getPublicClient()).getBalance({ address: passport.address });
    if (bal > 0n) {
      await passport.write.rescueExcessEth([admin.account.address, bal], { account: admin.account });
    }
  });

  it("VERSION is 1.11.0-rc.1", async () => {
    const { viem } = connection;
    const { passport } = await deployPassportStack(viem);
    assert.equal(await passport.read.VERSION(), "1.11.0-rc.1");
  });

  it("ChallengeOpened/Judged + VerificationLapsed match chain state (no Dispute* duplicates)", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { passport, tokenId, owner, stranger, staking } = await verified(viem);
    await passport.write.open([tokenId], { account: owner.account, value: DISPUTE_DEPOSIT });

    const openedLogs = await publicClient.getContractEvents({
      address: passport.address,
      abi: passport.abi,
      eventName: "ChallengeOpened",
      fromBlock: 0n,
      toBlock: "latest",
    });
    assert.equal(openedLogs.length, 1);
    const opened = openedLogs[0]!.args as {
      subjectId: bigint;
      challenger: string;
      bondAmount: bigint;
      openedAt: bigint;
      windowDuration: bigint;
    };
    assert.equal(opened.subjectId, tokenId);
    assert.equal(opened.challenger.toLowerCase(), owner.account.address.toLowerCase());
    assert.equal(opened.bondAmount, DISPUTE_DEPOSIT);
    assert.equal(opened.bondAmount, await passport.read.challengeBondAmount([tokenId]));
    assert.equal(opened.openedAt, await passport.read.challengeOpenedAt([tokenId]));
    assert.equal(opened.windowDuration, await passport.read.challengeWindowDuration([tokenId]));
    assert.equal(await passport.read.passportStatus([tokenId]), 2); // DISPUTED

    const disputed = await publicClient.getContractEvents({
      address: passport.address,
      abi: passport.abi,
      eventName: "PassportDisputed",
      fromBlock: 0n,
      toBlock: "latest",
    });
    assert.equal(disputed.length, 1);

    await joinVerifier(staking, stranger);
    await passport.write.judge([tokenId, 0], { account: stranger.account }); // Upheld → lapse

    const judged = await publicClient.getContractEvents({
      address: passport.address,
      abi: passport.abi,
      eventName: "ChallengeJudged",
      fromBlock: 0n,
      toBlock: "latest",
    });
    assert.equal(judged.length, 1);
    const j = judged[0]!.args as { outcome: number; judge: string; bondRecipient: string };
    assert.equal(j.outcome, 0);
    assert.equal(j.judge.toLowerCase(), stranger.account.address.toLowerCase());
    assert.equal(j.bondRecipient.toLowerCase(), owner.account.address.toLowerCase());

    const lapsed = await publicClient.getContractEvents({
      address: passport.address,
      abi: passport.abi,
      eventName: "VerificationLapsed",
      fromBlock: 0n,
      toBlock: "latest",
    });
    assert.equal(lapsed.length, 1);
    assert.equal(await passport.read.passportStatus([tokenId]), 0); // UNVERIFIED
    assert.equal(await passport.read.challengeOpenedAt([tokenId]), 0n);
  });
});
