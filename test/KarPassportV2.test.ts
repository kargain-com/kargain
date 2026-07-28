import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress, padHex, toHex } from "viem";

import {
  DISPUTE_DEPOSIT,
  deployPassportStack,
  joinVerifier,
  mintPassport,
  ZERO,
} from "../scripts/lib/local-stack.js";

const TOKEN_ID_BASE = 31337n << 128n;

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
    for (let slot = 0; slot < 64; slot++) {
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

describe("KarPassport v2 — dispute deposits", () => {
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

  it("disputePassport requires deposit", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await verified(viem);
    await assert.rejects(
      passport.write.disputePassport([tokenId, "issue"], { account: owner.account, value: 0n }),
      revertsWith("InsufficientDeposit"),
    );
  });

  it("dispute locks deposit in totalLockedDeposits", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await verified(viem);
    await passport.write.disputePassport([tokenId, "issue"], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    assert.equal(await passport.read.totalLockedDeposits(), DISPUTE_DEPOSIT);
    assert.equal(await passport.read.disputeDeposits([tokenId]), DISPUTE_DEPOSIT);
    assert.equal(getAddress(await passport.read.disputeOpenedBy([tokenId])), getAddress(owner.account.address));
  });

  it("withdrawDispute refunds opener and restores VERIFIED", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await verified(viem);
    await passport.write.disputePassport([tokenId, "issue"], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await passport.write.withdrawDispute([tokenId], { account: owner.account });
    const [status] = await passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 1);
    assert.equal(await passport.read.totalLockedDeposits(), 0n);
    assert.equal(await passport.read.disputeDeposits([tokenId]), 0n);
  });

  it("resolve ConfirmDispute pays opener and sets UNVERIFIED", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, verifier, passport, tokenId } = await verified(viem);
    await passport.write.disputePassport([tokenId, "issue"], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    const before = await publicClient.getBalance({ address: owner.account.address });
    await passport.write.resolveDispute([tokenId, 0], { account: verifier.account });
    const after = await publicClient.getBalance({ address: owner.account.address });
    assert.equal(after - before, DISPUTE_DEPOSIT);
    const [status, recordedVerifier] = await passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 0);
    assert.equal(recordedVerifier, ZERO);
  });

  it("resolve RejectDispute pays verifier and sets VERIFIED", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, tokenId } = await verified(viem);
    await passport.write.disputePassport([tokenId, "issue"], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await passport.write.resolveDispute([tokenId, 1], { account: verifier.account });
    const [status] = await passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 1);
    assert.equal(await passport.read.totalLockedDeposits(), 0n);
  });

  it("opener cannot resolve own dispute", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, tokenId } = await verified(viem);
    await passport.write.disputePassport([tokenId, "issue"], {
      account: verifier.account,
      value: DISPUTE_DEPOSIT,
    });
    await assert.rejects(
      passport.write.resolveDispute([tokenId, 1], { account: verifier.account }),
      revertsWith("CannotResolveSelfDispute"),
    );
    void owner;
  });

  it("rescueExcessEth cannot touch locked deposits", async () => {
    const { viem } = connection;
    const { admin, owner, passport, tokenId } = await verified(viem);
    await passport.write.disputePassport([tokenId, "issue"], {
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

  it("owner can rescue excess after dispute resolved", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, owner, verifier, passport, tokenId } = await verified(viem);
    const extra = 5_000_000_000_000_000n;
    await passport.write.disputePassport([tokenId, "issue"], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await passport.write.resolveDispute([tokenId, 1], { account: verifier.account });
    const bomber = await viem.deployContract("SelfDestructSender", []);
    await bomber.write.destroyAndSend([passport.address], {
      account: admin.account,
      value: extra,
    });
    const adminBefore = await publicClient.getBalance({ address: admin.account.address });
    await passport.write.rescueExcessEth([admin.account.address, extra], { account: admin.account });
    const adminAfter = await publicClient.getBalance({ address: admin.account.address });
    assert.ok(adminAfter - adminBefore >= extra - 50_000_000_000_000n);
  });

  it("re-dispute after withdrawDispute works with correct accounting", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, tokenId } = await verified(viem);
    await passport.write.disputePassport([tokenId, "issue"], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await passport.write.withdrawDispute([tokenId], { account: owner.account });
    let [status] = await passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 1);
    assert.equal(await passport.read.totalLockedDeposits(), 0n);
    await passport.write.disputePassport([tokenId, "again"], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    [status] = await passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 2);
    assert.equal(await passport.read.totalLockedDeposits(), DISPUTE_DEPOSIT);
    await passport.write.resolveDispute([tokenId, 1], { account: verifier.account });
    assert.equal(await passport.read.totalLockedDeposits(), 0n);
  });

  it("disputeDeposit == 0 allows zero-value dispute", async () => {
    const { viem } = connection;
    const { admin, owner, passport, tokenId } = await verified(viem);
    await passport.write.setDisputeDeposit([0n], { account: admin.account });
    await passport.write.disputePassport([tokenId, "free"], {
      account: owner.account,
      value: 0n,
    });
    const [status] = await passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 2);
    assert.equal(await passport.read.totalLockedDeposits(), 0n);
  });

  it("disputePassport with exactly disputeDeposit succeeds", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await verified(viem);
    await passport.write.disputePassport([tokenId, "exact"], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    const [status] = await passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 2);
    assert.equal(await passport.read.disputeDeposits([tokenId]), DISPUTE_DEPOSIT);
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
      ((await passport.read.totalLockedDeposits()) as bigint) +
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

  it("VERSION is 1.5.1-rc.1", async () => {
    const { viem } = connection;
    const { passport } = await deployPassportStack(viem);
    assert.equal(await passport.read.VERSION(), "1.5.1-rc.1");
  });
});
