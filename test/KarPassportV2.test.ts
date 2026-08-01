import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress, padHex, toHex } from "viem";

import {
  DISPUTE_DEPOSIT,
  deployPassportStack,
  increaseTime,
  joinVerifier,
  mintPassport,
  ZERO,
} from "../scripts/lib/local-stack.js";

const TOKEN_ID_BASE = 31337n << 128n;
const DISPUTE_WINDOW = 14n * 24n * 60n * 60n;

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

describe("KarPassport v2 — tokenId offset", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("nextTokenId starts at chainId << 128", async () => {
    const { viem } = connection;
    const { passport } = await deployPassportStack(viem);
    assert.equal(await passport.read.nextTokenId(), TOKEN_ID_BASE);
    assert.equal(await passport.read.chainIdOf([TOKEN_ID_BASE]), 31337n);
    assert.equal(await passport.read.localIdOf([TOKEN_ID_BASE]), 0n);
  });

  it("default disputeDeposit is constructor value", async () => {
    const { viem } = connection;
    const { passport } = await deployPassportStack(viem);
    assert.equal(await passport.read.disputeDeposit(), DISPUTE_DEPOSIT);
  });

  it("mintPassport guard: tokenIdSpaceExhausted boundary", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, passport } = await deployPassportStack(viem);
    const baseline = (await passport.read.nextTokenId()) as bigint;
    const maxLocal = (1n << 128n) - 1n;
    const penultimate = TOKEN_ID_BASE | (maxLocal - 1n);
    let slotFound = false;
    // BondedChallenge storage + __gap (was immutable) shifts KarPassport slots; scan wide.
    for (let slot = 0; slot < 256; slot++) {
      const slotHex = padHex(toHex(slot), { size: 32 });
      await publicClient.request({
        method: "hardhat_setStorageAt",
        params: [passport.address, slotHex, padHex(toHex(penultimate), { size: 32 })],
      });
      if (((await passport.read.nextTokenId()) as bigint) === penultimate) {
        slotFound = true;
        break;
      }
      await publicClient.request({
        method: "hardhat_setStorageAt",
        params: [passport.address, slotHex, padHex(toHex(baseline), { size: 32 })],
      });
    }
    assert.ok(slotFound, "_nextTokenId storage slot not found");
    await passport.write.mintPassport([owner.account.address, "ar://last"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.mintPassport([owner.account.address, "ar://overflow"], {
        account: owner.account,
      }),
      revertsWith("TokenIdSpaceExhausted"),
    );
  });
});

describe("KarPassport v2 — bonded challenge", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  async function verified(viem: Awaited<ReturnType<typeof hardhat.network.connect>>["viem"]) {
    const stack = await deployPassportStack(viem);
    const tokenId = await mintPassport(
      stack.passport,
      stack.owner,
      stack.owner.account.address,
      "ar://v",
    );
    await joinVerifier(stack.staking, stack.verifier);
    await stack.passport.write.verifyPassport([tokenId], { account: stack.verifier.account });
    return { ...stack, tokenId };
  }

  /** Independent judge ≠ owner, opener, or recorded passportVerifier. Prefer stranger. */
  async function joinIndependent(
    stack: Awaited<ReturnType<typeof verified>>,
  ) {
    await joinVerifier(stack.staking, stack.stranger);
    return stack.stranger;
  }

  it("open requires exact bond — WrongValue on zero", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await verified(viem);
    await assert.rejects(
      passport.write.open([tokenId], { account: owner.account, value: 0n }),
      revertsWith("WrongValue"),
    );
  });

  it("open locks bond and stamps challengeOpenedAt", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await verified(viem);
    await passport.write.open([tokenId], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    assert.equal(await passport.read.totalLockedBonds(), DISPUTE_DEPOSIT);
    assert.equal(await passport.read.challengeBondAmount([tokenId]), DISPUTE_DEPOSIT);
    assert.equal(
      getAddress(await passport.read.challengeChallenger([tokenId])),
      getAddress(owner.account.address),
    );
    assert.ok(((await passport.read.challengeOpenedAt([tokenId])) as bigint) > 0n);
  });

  it("withdraw refunds opener fully and restores VERIFIED before window", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, passport, tokenId } = await verified(viem);
    await passport.write.open([tokenId], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    const before = await publicClient.getBalance({ address: owner.account.address });
    const hash = await passport.write.withdraw([tokenId], { account: owner.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const after = await publicClient.getBalance({ address: owner.account.address });
    const gas = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
    assert.equal(after + gas - before, DISPUTE_DEPOSIT);
    const [status] = await passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 1);
    assert.equal(await passport.read.totalLockedBonds(), 0n);
    assert.equal(await passport.read.challengeBondAmount([tokenId]), 0n);
    assert.equal(await passport.read.challengeChallenger([tokenId]), ZERO);
    assert.equal(await passport.read.challengeOpenedAt([tokenId]), 0n);
  });

  it("judge Upheld pays opener and sets UNVERIFIED (independent judge)", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await verified(viem);
    const judge = await joinIndependent(stack);
    await stack.passport.write.open([stack.tokenId], {
      account: stack.owner.account,
      value: DISPUTE_DEPOSIT,
    });
    const before = await publicClient.getBalance({ address: stack.owner.account.address });
    await stack.passport.write.judge([stack.tokenId, 0], { account: judge.account });
    const after = await publicClient.getBalance({ address: stack.owner.account.address });
    assert.equal(after - before, DISPUTE_DEPOSIT);
    const [status, recordedVerifier] = await stack.passport.read.getPassportStatus([stack.tokenId]);
    assert.equal(status, 0);
    assert.equal(recordedVerifier, ZERO);
  });

  it("judge Rejected pays platformRecipient not judge", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await verified(viem);
    const judge = await joinIndependent(stack);
    const platform = getAddress(await stack.passport.read.platformRecipient());
    assert.equal(platform, getAddress(stack.admin.account.address));
    await stack.passport.write.open([stack.tokenId], {
      account: stack.owner.account,
      value: DISPUTE_DEPOSIT,
    });
    const platformBefore = await publicClient.getBalance({ address: platform });
    const judgeBefore = await publicClient.getBalance({ address: judge.account.address });
    const hash = await stack.passport.write.judge([stack.tokenId, 1], {
      account: judge.account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const gas = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
    const platformAfter = await publicClient.getBalance({ address: platform });
    const judgeAfter = await publicClient.getBalance({ address: judge.account.address });
    assert.equal(platformAfter - platformBefore, DISPUTE_DEPOSIT);
    assert.equal(judgeAfter + gas, judgeBefore);
    const [status] = await stack.passport.read.getPassportStatus([stack.tokenId]);
    assert.equal(status, 1);
    assert.equal(await stack.passport.read.totalLockedBonds(), 0n);
  });

  it("opener cannot judge — CannotResolveOwnDispute", async () => {
    const { viem } = connection;
    const stack = await verified(viem);
    await joinVerifier(stack.staking, stack.stranger);
    await stack.passport.write.open([stack.tokenId], {
      account: stack.stranger.account,
      value: DISPUTE_DEPOSIT,
    });
    await assert.rejects(
      stack.passport.write.judge([stack.tokenId, 1], {
        account: stack.stranger.account,
      }),
      revertsWith("CannotResolveOwnDispute"),
    );
  });

  it("owner cannot judge — CannotResolveOwnDispute", async () => {
    const { viem } = connection;
    const stack = await verified(viem);
    await joinVerifier(stack.staking, stack.owner);
    await stack.passport.write.open([stack.tokenId], {
      account: stack.stranger.account,
      value: DISPUTE_DEPOSIT,
    });
    await assert.rejects(
      stack.passport.write.judge([stack.tokenId, 1], { account: stack.owner.account }),
      revertsWith("CannotResolveOwnDispute"),
    );
  });

  it("challenged passportVerifier cannot judge — CannotResolveOwnDispute", async () => {
    const { viem } = connection;
    const stack = await verified(viem);
    await stack.passport.write.open([stack.tokenId], {
      account: stack.stranger.account,
      value: DISPUTE_DEPOSIT,
    });
    await assert.rejects(
      stack.passport.write.judge([stack.tokenId, 1], {
        account: stack.verifier.account,
      }),
      revertsWith("CannotResolveOwnDispute"),
    );
  });

  it("owner-hired independent verifier can judge Rejected", async () => {
    const { viem } = connection;
    const stack = await verified(viem);
    const hired = await joinIndependent(stack);
    await stack.passport.write.open([stack.tokenId], {
      account: stack.owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await stack.passport.write.judge([stack.tokenId, 1], { account: hired.account });
    const [status] = await stack.passport.read.getPassportStatus([stack.tokenId]);
    assert.equal(status, 1);
  });

  it("conclude before window reverts DisputeWindowActive", async () => {
    const { viem } = connection;
    const { owner, stranger, passport, tokenId } = await verified(viem);
    await passport.write.open([tokenId], {
      account: stranger.account,
      value: DISPUTE_DEPOSIT,
    });
    await assert.rejects(
      passport.write.conclude([tokenId], { account: owner.account }),
      revertsWith("DisputeWindowActive"),
    );
  });

  it("conclude after window → UNVERIFIED, bond to platform; owner gains nothing by silence", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await verified(viem);
    await stack.passport.write.open([stack.tokenId], {
      account: stack.stranger.account,
      value: DISPUTE_DEPOSIT,
    });
    await increaseTime(publicClient, DISPUTE_WINDOW);
    const platform = getAddress(await stack.passport.read.platformRecipient());
    const platformBefore = await publicClient.getBalance({ address: platform });
    await stack.passport.write.conclude([stack.tokenId], {
      account: stack.owner.account,
    });
    const platformAfter = await publicClient.getBalance({ address: platform });
    assert.equal(platformAfter - platformBefore, DISPUTE_DEPOSIT);
    const [status, recordedVerifier] = await stack.passport.read.getPassportStatus([
      stack.tokenId,
    ]);
    assert.equal(status, 0);
    assert.equal(recordedVerifier, ZERO);
    assert.equal(await stack.passport.read.totalLockedBonds(), 0n);
  });

  it("withdraw after window reverts DisputeWindowElapsed", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, passport, tokenId } = await verified(viem);
    await passport.write.open([tokenId], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await increaseTime(publicClient, DISPUTE_WINDOW);
    await assert.rejects(
      passport.write.withdraw([tokenId], { account: owner.account }),
      revertsWith("DisputeWindowElapsed"),
    );
  });

  it("judge after window reverts DisputeWindowElapsed (no race with conclude)", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await verified(viem);
    const judge = await joinIndependent(stack);
    await stack.passport.write.open([stack.tokenId], {
      account: stack.owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await increaseTime(publicClient, DISPUTE_WINDOW);
    await assert.rejects(
      stack.passport.write.judge([stack.tokenId, 1], { account: judge.account }),
      revertsWith("DisputeWindowElapsed"),
    );
    // Elapsed phase still has an actor: anyone may conclude.
    await stack.passport.write.conclude([stack.tokenId], {
      account: stack.stranger.account,
    });
    const [status] = await stack.passport.read.getPassportStatus([stack.tokenId]);
    assert.equal(status, 0);
  });

  it("judge during window succeeds for independent verifier", async () => {
    const { viem } = connection;
    const stack = await verified(viem);
    const judge = await joinIndependent(stack);
    await stack.passport.write.open([stack.tokenId], {
      account: stack.owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await stack.passport.write.judge([stack.tokenId, 1], { account: judge.account });
    const [status] = await stack.passport.read.getPassportStatus([stack.tokenId]);
    assert.equal(status, 1);
  });

  it("rescueExcessEth cannot touch locked bonds", async () => {
    const { viem } = connection;
    const { admin, owner, passport, tokenId } = await verified(viem);
    await passport.write.open([tokenId], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await assert.rejects(
      passport.write.rescueExcessEth([admin.account.address, DISPUTE_DEPOSIT], {
        account: admin.account,
      }),
      revertsWith("NothingToRescue"),
    );
  });

  it("owner can rescue excess after challenge judged", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await verified(viem);
    const judge = await joinIndependent(stack);
    const extra = 5_000_000_000_000_000n;
    await stack.passport.write.open([stack.tokenId], {
      account: stack.owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await stack.passport.write.judge([stack.tokenId, 1], { account: judge.account });
    const bomber = await viem.deployContract("SelfDestructSender", []);
    await bomber.write.destroyAndSend([stack.passport.address], {
      account: stack.admin.account,
      value: extra,
    });
    const adminBefore = await publicClient.getBalance({ address: stack.admin.account.address });
    await stack.passport.write.rescueExcessEth([stack.admin.account.address, extra], {
      account: stack.admin.account,
    });
    const adminAfter = await publicClient.getBalance({ address: stack.admin.account.address });
    assert.ok(adminAfter - adminBefore >= extra - 50_000_000_000_000n);
  });

  it("re-open after withdraw works with correct accounting", async () => {
    const { viem } = connection;
    const stack = await verified(viem);
    const judge = await joinIndependent(stack);
    await stack.passport.write.open([stack.tokenId], {
      account: stack.owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await stack.passport.write.withdraw([stack.tokenId], { account: stack.owner.account });
    let [status] = await stack.passport.read.getPassportStatus([stack.tokenId]);
    assert.equal(status, 1);
    assert.equal(await stack.passport.read.totalLockedBonds(), 0n);
    await stack.passport.write.open([stack.tokenId], {
      account: stack.owner.account,
      value: DISPUTE_DEPOSIT,
    });
    [status] = await stack.passport.read.getPassportStatus([stack.tokenId]);
    assert.equal(status, 2);
    assert.equal(await stack.passport.read.totalLockedBonds(), DISPUTE_DEPOSIT);
    await stack.passport.write.judge([stack.tokenId, 1], { account: judge.account });
    assert.equal(await stack.passport.read.totalLockedBonds(), 0n);
  });

  it("setDisputeDeposit(0) reverts ZeroDisputeDeposit", async () => {
    const { viem } = connection;
    const { admin, passport } = await verified(viem);
    await assert.rejects(
      passport.write.setDisputeDeposit([0n], { account: admin.account }),
      revertsWith("ZeroDisputeDeposit"),
    );
  });

  it("ctor rejects zero disputeDeposit", async () => {
    const { viem } = connection;
    const { admin, staking } = await deployPassportStack(viem);
    await assert.rejects(
      viem.deployContract("KarPassport", [
        staking.address,
        admin.account.address,
        0n,
        admin.account.address,
      ]),
      revertsWith("ZeroDisputeDeposit"),
    );
  });

  it("open with exactly disputeDeposit succeeds", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await verified(viem);
    await passport.write.open([tokenId], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    const [status] = await passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 2);
    assert.equal(await passport.read.challengeBondAmount([tokenId]), DISPUTE_DEPOSIT);
  });
});

describe("KarPassport v2 — setVerificationFee on staking", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("active verifier sets own fee", async () => {
    const { viem } = connection;
    const { verifier, staking } = await deployPassportStack(viem);
    await joinVerifier(staking, verifier);
    const fee = 123_000_000_000_000_000n;
    await staking.write.setVerificationFee([fee], { account: verifier.account });
    assert.equal(await staking.read.verificationFee([verifier.account.address]), fee);
  });

  it("non-verifier reverts NotVerifier", async () => {
    const { viem } = connection;
    const { stranger, staking } = await deployPassportStack(viem);
    await assert.rejects(
      staking.write.setVerificationFee([1n], { account: stranger.account }),
      revertsWith("NotVerifier"),
    );
  });
});

describe("KarPassport — claim payout coverage", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("rescueExcessEth to reverting recipient credits claim", async () => {
    const { viem } = connection;
    const { admin, passport } = await deployPassportStack(viem);
    const reverting = await viem.deployContract("RevertingRecipient", []);
    const funder = await viem.deployContract("SelfDestructSender", []);
    await funder.write.destroyAndSend([passport.address], { value: 10n ** 16n });
    const amount = 10n ** 15n;
    await passport.write.rescueExcessEth([reverting.address, amount], {
      account: admin.account,
    });
    assert.equal(await passport.read.pendingClaims([reverting.address, ZERO]), amount);
    assert.equal(await passport.read.totalPendingNative(), amount);
  });

  it("rescueExcessEth cannot drain pending claims", async () => {
    const { viem } = connection;
    const { admin, passport } = await deployPassportStack(viem);
    const reverting = await viem.deployContract("RevertingRecipient", []);
    const funder = await viem.deployContract("SelfDestructSender", []);
    await funder.write.destroyAndSend([passport.address], { value: 10n ** 16n });
    const amount = 10n ** 15n;
    await passport.write.rescueExcessEth([reverting.address, amount], {
      account: admin.account,
    });
    const publicClient = await viem.getPublicClient();
    const balance = await publicClient.getBalance({ address: passport.address });
    const locked =
      ((await passport.read.totalLockedBonds()) as bigint) +
      ((await passport.read.totalPendingNative()) as bigint);
    const free = balance - locked;
    await assert.rejects(
      passport.write.rescueExcessEth([admin.account.address, free + 1n], {
        account: admin.account,
      }),
      revertsWith("NothingToRescue"),
    );
  });

  it("withdrawClaim with no balance reverts NoClaim", async () => {
    const { viem } = connection;
    const { stranger, passport } = await deployPassportStack(viem);
    await assert.rejects(
      passport.write.withdrawClaim([ZERO], { account: stranger.account }),
      revertsWith("NoClaim"),
    );
  });

  it("withdrawClaim while recipient still rejects reverts TransferFailed", async () => {
    const { viem } = connection;
    const { admin, passport } = await deployPassportStack(viem);
    const reverting = await viem.deployContract("RevertingRecipient", []);
    const funder = await viem.deployContract("SelfDestructSender", []);
    await funder.write.destroyAndSend([passport.address], { value: 10n ** 16n });
    await passport.write.rescueExcessEth([reverting.address, 10n ** 15n], {
      account: admin.account,
    });
    await assert.rejects(
      reverting.write.withdrawClaim([passport.address, ZERO]),
      revertsWith("TransferFailed"),
    );
  });

  it("gas-burning rescue recipient credits claim; withdraw after accept", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, passport } = await deployPassportStack(viem);
    const burner = await viem.deployContract("GasBurningRecipient", []);
    const funder = await viem.deployContract("SelfDestructSender", []);
    await funder.write.destroyAndSend([passport.address], { value: 10n ** 16n });
    const amount = 10n ** 15n;
    await passport.write.rescueExcessEth([burner.address, amount], { account: admin.account });
    assert.equal(await passport.read.pendingClaims([burner.address, ZERO]), amount);
    const balance = await publicClient.getBalance({ address: passport.address });
    assert.ok(balance >= ((await passport.read.totalPendingNative()) as bigint));
    await burner.write.setAcceptEth([true]);
    await burner.write.withdrawClaim([passport.address, ZERO]);
    assert.equal(await passport.read.pendingClaims([burner.address, ZERO]), 0n);
    await assert.rejects(
      burner.write.withdrawClaim([passport.address, ZERO]),
      revertsWith("NoClaim"),
    );
  });

  it("VERSION is 1.9.0-rc.1", async () => {
    const { viem } = connection;
    const { passport } = await deployPassportStack(viem);
    assert.equal(await passport.read.VERSION(), "1.9.0-rc.1");
  });
});
