import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress, type Hash, type PublicClient } from "viem";

import {
  Category,
  DISPUTE_DEPOSIT,
  deployCommerceBaseStack,
  deployFixedPriceConsignment,
  deployPassportStack,
  deployVerifierStack,
  increaseTime,
  joinVerifier,
  mintPassport,
  MIN_STAKE,
  receiptLogs,
  ZERO,
} from "../scripts/lib/local-stack.js";

const TOKEN_ID_BASE = 31337n << 128n;
const UNBONDING_PERIOD = 14n * 24n * 60n * 60n;

const ZERO_ADDR = ZERO;

const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
/** Native-denominated open (kind 0 = asset). */
const DENOM_NATIVE = { kind: 0, currencyCode: BYTES32_ZERO } as const;

/**
 * Passport + FixedPriceConsignment mode, registered as an encumbrance source. Opening a
 * consignment requires the passport to be VERIFIED (§9 readiness), so `verifier` is joined
 * as an active KarPro verifier ready to call `verifyPassport`.
 */
async function deployListedFixedPriceStack(viem: Parameters<typeof deployCommerceBaseStack>[0]) {
  const base = await deployCommerceBaseStack(viem);
  const { mode } = await deployFixedPriceConsignment(viem, {
    passport: base.passport.address,
    platformRecipient: base.admin.account.address,
    feeBps: 250n,
    nativeUsdFeed: base.nativeFeed.address,
    nativeUsdStalenessTolerance: 3600,
    owner: getAddress(base.timelock.address),
    guardian: base.admin.account.address,
  });
  await base.passport.write.addEncumbranceSource([mode.address], { account: base.admin.account });
  await joinVerifier(base.staking, base.stranger);
  return { ...base, mode };
}

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    if (err.message.includes(errorName)) return true;
    if (errorName === "TransferFailed" && err.message.includes("0x90b8ec18")) return true;
    if (errorName === "NoClaim" && err.message.includes("0x9b0e91e1")) return true;
    if (errorName === "TokenHasNoCode" && err.message.includes("0x72a73200")) return true;
    if (errorName === "TokenNonConforming" && err.message.includes("0xda440b93")) return true;
    if (errorName === "AlreadyHoldsPass" && err.message.includes("0xda355792")) return true;
    return false;
  };
}

type NetworkConnection = Awaited<ReturnType<typeof hardhat.network.connect>>;

describe("KarProPass", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("mint reverts if caller is not staking", async () => {
    const { viem } = connection;
    const { admin, owner, stranger, proPass } = await deployVerifierStack(viem);
    void admin;
    await assert.rejects(
      proPass.write.mint([owner.account.address, Category.INSPECTOR, "X", "ar://x"], {
        account: stranger.account,
      }),
      revertsWith("OnlyStaking"),
    );
  });

  it("burn reverts if caller is not staking", async () => {
    const { viem } = connection;
    const { owner, verifier, stranger, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    await assert.rejects(
      proPass.write.burn([owner.account.address], { account: stranger.account }),
      revertsWith("OnlyStaking"),
    );
  });

  it("approve reverts Soulbound", async () => {
    const { viem } = connection;
    const { verifier, stranger, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    const tokenId = BigInt(verifier.account.address);
    await assert.rejects(
      proPass.write.approve([stranger.account.address, tokenId], { account: verifier.account }),
      revertsWith("Soulbound"),
    );
  });

  it("setApprovalForAll reverts Soulbound", async () => {
    const { viem } = connection;
    const { verifier, stranger, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    await assert.rejects(
      proPass.write.setApprovalForAll([stranger.account.address, true], {
        account: verifier.account,
      }),
      revertsWith("Soulbound"),
    );
  });

  it("transfer between addresses reverts Soulbound", async () => {
    const { viem } = connection;
    const { verifier, stranger, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    const tokenId = BigInt(verifier.account.address);
    await assert.rejects(
      proPass.write.transferFrom(
        [verifier.account.address, stranger.account.address, tokenId],
        { account: verifier.account },
      ),
      revertsWith("Soulbound"),
    );
  });

  it("updateProfile changes category, name, metadataURI", async () => {
    const { viem } = connection;
    const { verifier, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier, {
      category: Category.INSPECTOR,
      name: "Old Name",
      metadataURI: "ar://old",
    });
    const tokenId = BigInt(verifier.account.address);
    await proPass.write.updateProfile([Category.DEALER, "New Name", "ar://new"], {
      account: verifier.account,
    });
    assert.equal(await proPass.read.holderCategory([tokenId]), Category.DEALER);
    assert.equal(await proPass.read.holderName([tokenId]), "New Name");
    assert.equal(await proPass.read.holderMetadataURI([tokenId]), "ar://new");
  });

  it("updateProfile reverts if caller has no pass", async () => {
    const { viem } = connection;
    const { stranger, proPass } = await deployVerifierStack(viem);
    await assert.rejects(
      proPass.write.updateProfile([Category.OTHER, "X", "ar://x"], {
        account: stranger.account,
      }),
      revertsWith("NotHolder"),
    );
  });

  it("setStaking(address(0)) reverts ZeroAddress", async () => {
    const { viem } = connection;
    const { admin, proPass } = await deployVerifierStack(viem);
    await assert.rejects(
      proPass.write.setStaking([ZERO], { account: admin.account }),
      revertsWith("ZeroAddress"),
    );
  });

  it("setStaking emits StakingSet", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, stranger, proPass } = await deployVerifierStack(viem);
    const hash = await proPass.write.setStaking([stranger.account.address], {
      account: admin.account,
    });
    const logs = await receiptLogs(publicClient, hash, proPass.abi);
    const ev = logs.find((l) => l.eventName === "StakingSet");
    assert.ok(ev);
    assert.equal(getAddress(ev!.args.staking as `0x${string}`), getAddress(stranger.account.address));
  });

  it("VERSION is 1.1.0-rc.1", async () => {
    const { viem } = connection;
    const { proPass } = await deployVerifierStack(viem);
    assert.equal(await proPass.read.VERSION(), "1.1.0-rc.1");
  });
});

// ─── KarProStaking — becomeVerifierNative ─────────────────────────────────────

describe("KarProStaking — becomeVerifierNative", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("stakes exactly minStakeNative, mints KarProPass", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, proPass, staking } = await deployVerifierStack(viem);
    const before = await publicClient.getBalance({ address: staking.address });
    await joinVerifier(staking, verifier, { value: MIN_STAKE });
    const after = await publicClient.getBalance({ address: staking.address });
    assert.equal(after - before, MIN_STAKE);
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n);
  });

  it("accepts more than minStakeNative", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, staking } = await deployVerifierStack(viem);
    const extra = MIN_STAKE + 10_000_000_000_000_000n;
    await joinVerifier(staking, verifier, { value: extra });
    const stake = await staking.read.stakes([verifier.account.address]);
    assert.equal(stake[1], extra);
    const balance = await publicClient.getBalance({ address: staking.address });
    assert.equal(balance, extra);
  });

  it("reverts below minStakeNative", async () => {
    const { viem } = connection;
    const { verifier, staking } = await deployVerifierStack(viem);
    await assert.rejects(
      staking.write.becomeVerifierNative([Category.INSPECTOR, "X", "ar://x"], {
        account: verifier.account,
        value: MIN_STAKE - 1n,
      }),
      revertsWith("BelowMinStake"),
    );
  });

  it("reverts if already a verifier", async () => {
    const { viem } = connection;
    const { verifier, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    await assert.rejects(
      staking.write.becomeVerifierNative([Category.INSPECTOR, "X", "ar://x"], {
        account: verifier.account,
        value: MIN_STAKE,
      }),
      revertsWith("AlreadyVerifier"),
    );
  });

  it("emits VerifierJoined", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, staking } = await deployVerifierStack(viem);
    const hash = await staking.write.becomeVerifierNative(
      [Category.INSPECTOR, "Verifier Co", "ar://v"],
      { account: verifier.account, value: MIN_STAKE },
    );
    const logs = await receiptLogs(publicClient, hash, staking.abi);
    const joined = logs.find((l) => l.eventName === "VerifierJoined");
    assert.ok(joined);
    assert.equal(getAddress(joined!.args.verifier as `0x${string}`), getAddress(verifier.account.address));
    assert.equal(joined!.args.amount, MIN_STAKE);
  });

  it("KarProPass minted with correct category and name", async () => {
    const { viem } = connection;
    const { verifier, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier, {
      category: Category.BROKER,
      name: "Broker Inc",
      metadataURI: "ar://broker",
    });
    const tokenId = BigInt(verifier.account.address);
    const [, category, name, metadataURI] = await proPass.read.getProPassData([tokenId]);
    assert.equal(category, Category.BROKER);
    assert.equal(name, "Broker Inc");
    assert.equal(metadataURI, "ar://broker");
  });

  it("isActiveVerifier returns true after join", async () => {
    const { viem } = connection;
    const { verifier, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), true);
  });
});

// ─── KarProStaking — leave ────────────────────────────────────────────────────

describe("KarProStaking — leave", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("leave ends role immediately; claimStake returns exact staked amount after unbonding", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, staking } = await deployVerifierStack(viem);
    const extra = MIN_STAKE + 5_000_000_000_000_000n;
    await joinVerifier(staking, verifier, { value: extra });
    const stakingBefore = await publicClient.getBalance({ address: staking.address });
    await staking.write.leave([], { account: verifier.account });
    assert.equal(await publicClient.getBalance({ address: staking.address }), stakingBefore);
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), false);
    await assert.rejects(
      staking.write.claimStake([], { account: verifier.account }),
      revertsWith("UnbondNotReady"),
    );
    await increaseTime(publicClient, UNBONDING_PERIOD);
    await staking.write.claimStake([], { account: verifier.account });
    const stakingAfter = await publicClient.getBalance({ address: staking.address });
    assert.equal(stakingBefore - stakingAfter, extra);
  });

  it("claimStake without leave reverts NoUnbond", async () => {
    const { viem } = connection;
    const { verifier, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    await assert.rejects(
      staking.write.claimStake([], { account: verifier.account }),
      revertsWith("NoUnbond"),
    );
  });

  it("burns KarProPass on leave", async () => {
    const { viem } = connection;
    const { verifier, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    await staking.write.leave([], { account: verifier.account });
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 0n);
  });

  it("isActiveVerifier returns false after leave", async () => {
    const { viem } = connection;
    const { verifier, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    await staking.write.leave([], { account: verifier.account });
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), false);
  });

  it("leave clears verificationFee (S34)", async () => {
    const { viem } = connection;
    const { verifier, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    const fee = 10n ** 16n;
    await staking.write.setVerificationFee([fee], { account: verifier.account });
    assert.equal(
      await staking.read.verificationFee([verifier.account.address]),
      fee,
    );
    await staking.write.leave([], { account: verifier.account });
    assert.equal(
      await staking.read.verificationFee([verifier.account.address]),
      0n,
    );
  });

  it("reverts if not a verifier", async () => {
    const { viem } = connection;
    const { stranger, staking } = await deployVerifierStack(viem);
    await assert.rejects(
      staking.write.leave([], { account: stranger.account }),
      revertsWith("NotVerifier"),
    );
  });

  it("emits VerifierLeft and UnbondStarted with identical amount and unlockAt", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    const hash = await staking.write.leave([], { account: verifier.account });
    const block = await publicClient.getBlock({ blockHash: (await publicClient.getTransactionReceipt({ hash })).blockHash });
    const logs = await receiptLogs(publicClient, hash, staking.abi);
    const left = logs.find((l) => l.eventName === "VerifierLeft");
    assert.ok(left);
    assert.equal(left!.args.amount, MIN_STAKE);
    const started = logs.find((l) => l.eventName === "UnbondStarted");
    assert.ok(started);
    assert.equal(started!.args.amount, MIN_STAKE);
    assert.equal(left!.args.unlockAt, started!.args.unlockAt);
    assert.equal(
      left!.args.unlockAt,
      BigInt(block.timestamp) + UNBONDING_PERIOD,
    );
  });

  it("successful claimStake emits StakeClaimed and not ClaimRecorded", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    await staking.write.leave([], { account: verifier.account });
    await increaseTime(publicClient, UNBONDING_PERIOD);
    const hash = await staking.write.claimStake([], { account: verifier.account });
    const logs = await receiptLogs(publicClient, hash, staking.abi);
    assert.ok(logs.some((l) => l.eventName === "StakeClaimed"));
    assert.equal(logs.some((l) => l.eventName === "ClaimRecorded"), false);
  });

  it("cannot rejoin while unbonding; can rejoin after claimStake", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    await staking.write.leave([], { account: verifier.account });
    await assert.rejects(
      joinVerifier(staking, verifier, { name: "Early" }),
      revertsWith("UnbondPending"),
    );
    await increaseTime(publicClient, UNBONDING_PERIOD);
    await staking.write.claimStake([], { account: verifier.account });
    await joinVerifier(staking, verifier, { name: "Rejoined" });
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n);
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), true);
  });

  it("claimStake returns locked amount even after minStake changed", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, verifier, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier, { value: MIN_STAKE });
    const higherMin = 80_000_000_000_000_000n; // 0.08 ether
    await staking.write.setMinStakeNative([higherMin], { account: admin.account });
    const stakingBefore = await publicClient.getBalance({ address: staking.address });
    await staking.write.leave([], { account: verifier.account });
    await increaseTime(publicClient, UNBONDING_PERIOD);
    await staking.write.claimStake([], { account: verifier.account });
    const stakingAfter = await publicClient.getBalance({ address: staking.address });
    assert.equal(stakingBefore - stakingAfter, MIN_STAKE);
    assert.equal(await staking.read.minStakeNative(), higherMin);
  });

  it("claimStake to RevertingRecipient credits claim; stake cleared", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { staking, proPass } = await deployVerifierStack(viem);
    const recipient = await viem.deployContract("RevertingRecipient", []);
    await recipient.write.joinNative([staking.address, 0, "Locked", "ar://locked"], {
      value: MIN_STAKE,
    });
    assert.equal(await staking.read.isActiveVerifier([recipient.address]), true);
    assert.equal(await proPass.read.balanceOf([recipient.address]), 1n);
    const stakingBefore = await publicClient.getBalance({ address: staking.address });
    await recipient.write.leaveStaking([staking.address]);
    assert.equal(await staking.read.isActiveVerifier([recipient.address]), false);
    await increaseTime(publicClient, UNBONDING_PERIOD);
    const claimHash = await recipient.write.claimStake([staking.address]);
    const claimLogs = await receiptLogs(publicClient, claimHash, staking.abi);
    assert.ok(claimLogs.some((l) => l.eventName === "StakeClaimed"));
    assert.ok(claimLogs.some((l) => l.eventName === "ClaimRecorded"));
    assert.equal(await staking.read.pendingClaims([recipient.address, ZERO]), MIN_STAKE);
    assert.equal(await publicClient.getBalance({ address: staking.address }), stakingBefore);
    await assert.rejects(
      recipient.write.withdrawClaim([staking.address, ZERO]),
      revertsWith("TransferFailed"),
    );
    await recipient.write.setAcceptEth([true]);
    await recipient.write.withdrawClaim([staking.address, ZERO]);
    assert.equal(await staking.read.pendingClaims([recipient.address, ZERO]), 0n);
  });

  it("claimStake to GasBurningRecipient credits claim; solvency holds", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { staking } = await deployVerifierStack(viem);
    const burner = await viem.deployContract("GasBurningRecipient", []);
    await burner.write.joinNative([staking.address, 0, "Burn", "ar://burn"], {
      value: MIN_STAKE,
    });
    await burner.write.leaveStaking([staking.address]);
    await increaseTime(publicClient, UNBONDING_PERIOD);
    await burner.write.claimStake([staking.address]);
    assert.equal(await staking.read.pendingClaims([burner.address, ZERO]), MIN_STAKE);
    const balance = await publicClient.getBalance({ address: staking.address });
    assert.ok(balance >= ((await staking.read.totalPendingNative()) as bigint));
    await burner.write.setAcceptEth([true]);
    await burner.write.withdrawClaim([staking.address, ZERO]);
    assert.equal(await staking.read.pendingClaims([burner.address, ZERO]), 0n);
  });

  it("ctor reverts ZeroAddress when proPass is zero", async () => {
    const { viem } = connection;
    const { admin } = await deployVerifierStack(viem);
    await assert.rejects(
      viem.deployContract("KarProStaking", [ZERO, admin.account.address]),
      revertsWith("ZeroAddress"),
    );
  });

  it("VERSION is 2.2.0-rc.1", async () => {
    const { viem } = connection;
    const { staking } = await deployVerifierStack(viem);
    assert.equal(await staking.read.VERSION(), "2.2.0-rc.1");
  });

  it("withdrawClaim with no balance reverts NoClaim", async () => {
    const { viem } = connection;
    const { stranger, staking } = await deployVerifierStack(viem);
    await assert.rejects(
      staking.write.withdrawClaim([ZERO], { account: stranger.account }),
      revertsWith("NoClaim"),
    );
  });
});

// ─── KarProStaking — params ───────────────────────────────────────────────────

describe("KarProStaking — params", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("setMinStakeNative changes minimum for new verifiers", async () => {
    const { viem } = connection;
    const { admin, verifier, staking } = await deployVerifierStack(viem);
    const newMin = 100_000_000_000_000_000n;
    await staking.write.setMinStakeNative([newMin], { account: admin.account });
    await assert.rejects(
      staking.write.becomeVerifierNative([Category.INSPECTOR, "X", "ar://x"], {
        account: verifier.account,
        value: newMin - 1n,
      }),
      revertsWith("BelowMinStake"),
    );
    await staking.write.becomeVerifierNative([Category.INSPECTOR, "X", "ar://x"], {
      account: verifier.account,
      value: newMin,
    });
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), true);
  });

  it("existing stake unaffected by minStake change", async () => {
    const { viem } = connection;
    const { admin, verifier, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier, { value: MIN_STAKE });
    await staking.write.setMinStakeNative([100_000_000_000_000_000n], { account: admin.account });
    const stake = await staking.read.stakes([verifier.account.address]);
    assert.equal(stake[1], MIN_STAKE);
    assert.equal(stake[3], true);
  });

  it("only owner can setMinStakeNative", async () => {
    const { viem } = connection;
    const { stranger, staking } = await deployVerifierStack(viem);
    await assert.rejects(
      staking.write.setMinStakeNative([MIN_STAKE * 2n], { account: stranger.account }),
    );
  });

  it("setMinStakeNative below MIN_STAKE_FLOOR reverts BelowMinStakeFloor", async () => {
    const { viem } = connection;
    const { admin, staking } = await deployVerifierStack(viem);
    const floor = (await staking.read.MIN_STAKE_FLOOR()) as bigint;
    await assert.rejects(
      staking.write.setMinStakeNative([100_000_000_000_000n], { account: admin.account }),
      revertsWith("BelowMinStakeFloor"),
    );
    await staking.write.setMinStakeNative([floor], { account: admin.account });
    assert.equal(await staking.read.minStakeNative(), floor);
  });

});

// ─── KarProStaking — retarget trap blocks re-join ─────────────────────────────

describe("KarProStaking — retarget trap blocks re-join", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("retargeting pass staking strand leaves pass; fresh pair join/leave/claim works", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, verifier, proPass, staking: stakingA } = await deployVerifierStack(viem);
    await joinVerifier(stakingA, verifier, { value: MIN_STAKE });
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n);

    const stakingB = await viem.deployContract("KarProStaking", [
      proPass.address,
      admin.account.address,
    ]);
    await proPass.write.setStaking([stakingB.address], { account: admin.account });

    await stakingA.write.leave([], { account: verifier.account });
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n, "burn fails after retarget");
    assert.equal(await stakingA.read.isActiveVerifier([verifier.account.address]), false);

    await assert.rejects(
      stakingB.write.becomeVerifierNative([Category.INSPECTOR, "Retry", "ar://retry"], {
        account: verifier.account,
        value: MIN_STAKE,
      }),
      revertsWith("AlreadyHoldsPass"),
    );

    const freshPass = await viem.deployContract("KarProPass", [admin.account.address]);
    const freshStaking = await viem.deployContract("KarProStaking", [
      freshPass.address,
      admin.account.address,
    ]);
    await freshPass.write.setStaking([freshStaking.address], { account: admin.account });
    await joinVerifier(freshStaking, verifier, { value: MIN_STAKE });
    assert.equal(await freshStaking.read.isActiveVerifier([verifier.account.address]), true);
    await freshStaking.write.leave([], { account: verifier.account });
    await increaseTime(publicClient, UNBONDING_PERIOD);
    const before = await publicClient.getBalance({ address: freshStaking.address });
    await freshStaking.write.claimStake([], { account: verifier.account });
    const after = await publicClient.getBalance({ address: freshStaking.address });
    assert.equal(before - after, MIN_STAKE);
  });
});

// ─── KarProStaking — security ─────────────────────────────────────────────────

describe("KarProStaking — security", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("no owner function can drain user stakes", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, verifier, stranger, staking } = await deployVerifierStack(viem);
    const forbidden = /withdraw|rescue|sweep|recover|drain/i;
    for (const item of staking.abi) {
      if (item.type === "function" && item.name && forbidden.test(item.name)) {
        // User claim withdraw is not an owner drain path.
        if (item.name === "withdrawClaim") continue;
        assert.fail(`Unexpected drain-like function: ${item.name}`);
      }
    }

    await joinVerifier(staking, verifier, { value: MIN_STAKE });
    await joinVerifier(staking, stranger, { value: MIN_STAKE });
    const balanceAfterJoin = await publicClient.getBalance({ address: staking.address });
    assert.equal(balanceAfterJoin, MIN_STAKE * 2n);

    await staking.write.setMinStakeNative([1_000_000_000_000_000_000n], { account: admin.account });
    const balanceAfterOwnerOps = await publicClient.getBalance({ address: staking.address });
    assert.equal(balanceAfterOwnerOps, balanceAfterJoin);

    const verifierStakingBefore = await publicClient.getBalance({ address: staking.address });
    await staking.write.leave([], { account: verifier.account });
    assert.equal(await publicClient.getBalance({ address: staking.address }), verifierStakingBefore);
    await increaseTime(publicClient, UNBONDING_PERIOD);
    await staking.write.claimStake([], { account: verifier.account });
    const verifierStakingAfter = await publicClient.getBalance({ address: staking.address });
    assert.equal(verifierStakingBefore - verifierStakingAfter, MIN_STAKE);

    const strangerStakingBefore = await publicClient.getBalance({ address: staking.address });
    await staking.write.leave([], { account: stranger.account });
    await increaseTime(publicClient, UNBONDING_PERIOD);
    await staking.write.claimStake([], { account: stranger.account });
    const strangerStakingAfter = await publicClient.getBalance({ address: staking.address });
    assert.equal(strangerStakingBefore - strangerStakingAfter, MIN_STAKE);

    assert.equal(await publicClient.getBalance({ address: staking.address }), 0n);
  });

});

// ─── KarProStaking — leave resilience ─────────────────────────────────────────

describe("KarProStaking — leave resilience", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("leave() succeeds and claimStake returns stake even if KarProPass staking address was changed", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, verifier, stranger, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier, { value: MIN_STAKE });
    await proPass.write.setStaking([stranger.account.address], { account: admin.account });
    const stakingBefore = await publicClient.getBalance({ address: staking.address });
    await staking.write.leave([], { account: verifier.account });
    assert.equal(await publicClient.getBalance({ address: staking.address }), stakingBefore);
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), false);
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n);
    await increaseTime(publicClient, UNBONDING_PERIOD);
    await staking.write.claimStake([], { account: verifier.account });
    const stakingAfter = await publicClient.getBalance({ address: staking.address });
    assert.equal(stakingBefore - stakingAfter, MIN_STAKE);
  });
});

// ─── KarPassport — mintPassport ───────────────────────────────────────────────

describe("KarPassport — mintPassport", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("public mint, status UNVERIFIED, correct URI", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    const uri = "ar://passport-1";
    const tokenId = await mintPassport(passport, owner, owner.account.address, uri);
    assert.equal(tokenId, TOKEN_ID_BASE);
    const [status] = await passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 0);
    assert.equal(await passport.read.tokenURI([tokenId]), uri);
  });

  it("tokenId increments with chain offset", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    assert.equal(await passport.read.nextTokenId(), TOKEN_ID_BASE);
    const first = await mintPassport(passport, owner, owner.account.address, "ar://0");
    assert.equal(first, TOKEN_ID_BASE);
    assert.equal(await passport.read.nextTokenId(), TOKEN_ID_BASE + 1n);
    const second = await mintPassport(passport, owner, owner.account.address, "ar://1");
    assert.equal(second, TOKEN_ID_BASE + 1n);
    assert.equal(await passport.read.nextTokenId(), TOKEN_ID_BASE + 2n);
  });
});

// ─── KarPassport — setPassportURI ─────────────────────────────────────────────

describe("KarPassport — setPassportURI", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("owner updates when UNVERIFIED", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://old"], {
      account: owner.account,
    });
    await passport.write.setPassportURI([TOKEN_ID_BASE, "ar://new"], { account: owner.account });
    assert.equal(await passport.read.tokenURI([TOKEN_ID_BASE]), "ar://new");
  });

  it("reverts not owner", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://x"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.setPassportURI([TOKEN_ID_BASE, "ar://hack"], { account: stranger.account }),
      revertsWith("NotOwner"),
    );
  });

  it("updates when VERIFIED and resets verification", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    await passport.write.setPassportURI([TOKEN_ID_BASE, "ar://new"], { account: owner.account });
    assert.equal(await passport.read.tokenURI([TOKEN_ID_BASE]), "ar://new");
    const [status, recordedVerifier, verifiedAt] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 0);
    assert.equal(getAddress(recordedVerifier), getAddress("0x0000000000000000000000000000000000000000"));
    assert.equal(verifiedAt, 0n);
  });

  it("reverts SameURI when VERIFIED and keeps verification", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    await assert.rejects(
      passport.write.setPassportURI([TOKEN_ID_BASE, "ar://v"], { account: owner.account }),
      revertsWith("SameURI"),
    );
    const [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 1);
  });

  it("reverts SameURI when UNVERIFIED", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://old"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.setPassportURI([TOKEN_ID_BASE, "ar://old"], { account: owner.account }),
      revertsWith("SameURI"),
    );
  });

  it("reverts empty URI", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://old"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.setPassportURI([TOKEN_ID_BASE, ""], { account: owner.account }),
      revertsWith("EmptyField"),
    );
  });

  it("reverts when DISPUTED", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://d"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    await passport.write.open([TOKEN_ID_BASE], { account: owner.account, value: DISPUTE_DEPOSIT });
    await assert.rejects(
      passport.write.setPassportURI([TOKEN_ID_BASE, "ar://new"], { account: owner.account }),
      revertsWith("InvalidStatus"),
    );
  });

  it("reverts NotOwner when listed via FixedPriceConsignment", async () => {
    const { viem } = connection;
    const { seller, stranger, passport, mode } = await deployListedFixedPriceStack(viem);
    await passport.write.mintPassport([seller.account.address, "ar://listed"], {
      account: seller.account,
    });
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: stranger.account });
    await passport.write.setApprovalForAll([mode.address, true], {
      account: seller.account,
    });
    await mode.write.openDirect([TOKEN_ID_BASE, DENOM_NATIVE, ZERO, 500n * 10n ** 8n], {
      account: seller.account,
    });
    await assert.rejects(
      passport.write.setPassportURI([TOKEN_ID_BASE, "ar://new"], { account: seller.account }),
      revertsWith("NotOwner"),
    );
  });

  it("allows edit after judge(Upheld) from DISPUTED", async () => {
    const { viem } = connection;
    const { owner, verifier, stranger, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://d"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    await joinVerifier(staking, stranger);
    await passport.write.open([TOKEN_ID_BASE], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await passport.write.judge([TOKEN_ID_BASE, 0], { account: stranger.account });
    await passport.write.setPassportURI([TOKEN_ID_BASE, "ar://fixed"], { account: owner.account });
    assert.equal(await passport.read.tokenURI([TOKEN_ID_BASE]), "ar://fixed");
    const [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 0);
  });

  it("UNVERIFIED update does not emit VerificationReset", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://old"], {
      account: owner.account,
    });
    const hash = await passport.write.setPassportURI([TOKEN_ID_BASE, "ar://new"], { account: owner.account });
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    assert.equal(logs.some((l) => l.eventName === "VerificationReset"), false);
    assert.equal(logs.some((l) => l.eventName === "PassportURIUpdated"), true);
  });

  it("emits VerificationReset when editing VERIFIED passport", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    const hash = await passport.write.setPassportURI([TOKEN_ID_BASE, "ar://new"], { account: owner.account });
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    const reset = logs.find((l) => l.eventName === "VerificationReset");
    assert.ok(reset);
    assert.equal(reset!.args.tokenId, TOKEN_ID_BASE);
    assert.equal(getAddress(reset!.args.author), getAddress(owner.account.address));
  });
});

// ─── KarPassport — verifyPassport ─────────────────────────────────────────────

describe("KarPassport — verifyPassport", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("active verifier (not owner) verifies", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    const [status, recordedVerifier] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 1);
    assert.equal(getAddress(recordedVerifier), getAddress(verifier.account.address));
  });

  it("reverts: not active verifier", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://v"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.verifyPassport([TOKEN_ID_BASE], { account: stranger.account }),
      revertsWith("NotActiveVerifier"),
    );
  });

  it("reverts: self-verify", async () => {
    const { viem } = connection;
    const { owner, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, owner);
    await assert.rejects(
      passport.write.verifyPassport([TOKEN_ID_BASE], { account: owner.account }),
      revertsWith("CannotSelfVerify"),
    );
  });

  it("reverts: already VERIFIED", async () => {
    const { viem } = connection;
    const { owner, verifier, stranger, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    await joinVerifier(staking, stranger);
    await assert.rejects(
      passport.write.verifyPassport([TOKEN_ID_BASE], { account: stranger.account }),
      revertsWith("InvalidStatus"),
    );
  });

  it("verifier who left with pass still held cannot verify", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, stranger, passport, proPass, staking } =
      await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await proPass.write.setStaking([stranger.account.address], { account: admin.account });
    await staking.write.leave([], { account: verifier.account });
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), false);
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n);
    await assert.rejects(
      passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account }),
      revertsWith("NotActiveVerifier"),
    );
  });

  it("verifier who left (pass burned) can no longer verify", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await staking.write.leave([], { account: verifier.account });
    await assert.rejects(
      passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account }),
      revertsWith("NotActiveVerifier"),
    );
  });

  it("passport stays VERIFIED after its verifier leaves", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    await staking.write.leave([], { account: verifier.account });
    const [status, recordedVerifier, verifiedAt] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 1);
    assert.equal(getAddress(recordedVerifier), getAddress(verifier.account.address));
    assert.ok(verifiedAt > 0n);
  });
});

// ─── KarPassport — dispute and resolve ────────────────────────────────────────

describe("KarPassport — dispute and resolve", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  async function setupVerified(viem: ViemSuite) {
    const stack = await deployPassportStack(viem);
    await stack.passport.write.mintPassport([stack.owner.account.address, "ar://d"], {
      account: stack.owner.account,
    });
    await joinVerifier(stack.staking, stack.verifier);
    await stack.passport.write.verifyPassport([TOKEN_ID_BASE], { account: stack.verifier.account });
    return stack;
  }

  it("anyone opens challenge on VERIFIED passport", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await setupVerified(viem);
    await passport.write.open([TOKEN_ID_BASE], { account: stranger.account, value: DISPUTE_DEPOSIT });
    const [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 2);
    void owner;
  });

  it("reverts open on UNVERIFIED", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://u"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.open([TOKEN_ID_BASE], { account: owner.account, value: DISPUTE_DEPOSIT }),
      revertsWith("InvalidStatus"),
    );
  });

  it("active verifier judges Rejected → VERIFIED", async () => {
    const { viem } = connection;
    const { owner, stranger, passport, staking } = await setupVerified(viem);
    await joinVerifier(staking, stranger);
    await passport.write.open([TOKEN_ID_BASE], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await passport.write.judge([TOKEN_ID_BASE, 1], { account: stranger.account });
    const [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 1);
  });

  it("judge Upheld → UNVERIFIED, verifier cleared", async () => {
    const { viem } = connection;
    const { owner, stranger, passport, staking } = await setupVerified(viem);
    await joinVerifier(staking, stranger);
    await passport.write.open([TOKEN_ID_BASE], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await passport.write.judge([TOKEN_ID_BASE, 0], { account: stranger.account });
    const [status, recordedVerifier, verifiedAt] = await passport.read.getPassportStatus([
      TOKEN_ID_BASE,
    ]);
    assert.equal(status, 0);
    assert.equal(recordedVerifier, ZERO);
    assert.equal(verifiedAt, 0n);
  });

  it("judge reverts: not qualified judge", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await setupVerified(viem);
    await passport.write.open([TOKEN_ID_BASE], { account: owner.account, value: DISPUTE_DEPOSIT });
    await assert.rejects(
      passport.write.judge([TOKEN_ID_BASE, 1], { account: stranger.account }),
      revertsWith("NotQualifiedJudge"),
    );
  });

  it("judge reverts: not DISPUTED", async () => {
    const { viem } = connection;
    const { verifier, passport, staking } = await setupVerified(viem);
    await assert.rejects(
      passport.write.judge([TOKEN_ID_BASE, 1], { account: verifier.account }),
      revertsWith("NoActiveDispute"),
    );
    void staking;
  });
});

// ─── KarPassport — records ────────────────────────────────────────────────────

describe("KarPassport — records", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("owner appendRecord", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://r"], {
      account: owner.account,
    });
    await passport.write.appendRecord([TOKEN_ID_BASE, "service", "Oil change", "cid-1"], {
      account: owner.account,
    });
    assert.equal(await passport.read.recordCount([TOKEN_ID_BASE]), 1n);
  });

  it("reportDiscrepancy permissionless", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://r"], {
      account: owner.account,
    });
    await passport.write.reportDiscrepancy([TOKEN_ID_BASE, "scratch found", "cid-2"], {
      account: stranger.account,
    });
    assert.equal(await passport.read.recordCount([TOKEN_ID_BASE]), 1n);
  });

  it("appendAttestation requires active verifier", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://a"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.appendAttestation([TOKEN_ID_BASE, "looks good", "cid-3"], {
        account: stranger.account,
      }),
      revertsWith("NotActiveVerifier"),
    );
  });

  it("recordCount increments", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://r"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.appendRecord([TOKEN_ID_BASE, "note", "first", ""], { account: owner.account });
    await passport.write.appendAttestation([TOKEN_ID_BASE, "attest", "cid"], { account: verifier.account });
    assert.equal(await passport.read.recordCount([TOKEN_ID_BASE]), 2n);
  });

  it("T10: appendRecord on VERIFIED leaves status unchanged", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://t10"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    let [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 1);
    await passport.write.appendRecord([TOKEN_ID_BASE, "service", "Oil change", "cid-t10"], {
      account: owner.account,
    });
    [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 1);
    assert.equal(await passport.read.recordCount([TOKEN_ID_BASE]), 1n);
  });

  it("appendRecord reverts NotOwner when listed via FixedPriceConsignment", async () => {
    const { viem } = connection;
    const { seller, stranger, passport, mode } = await deployListedFixedPriceStack(viem);
    await passport.write.mintPassport([seller.account.address, "ar://listed-record"], {
      account: seller.account,
    });
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: stranger.account });
    await passport.write.setApprovalForAll([mode.address, true], {
      account: seller.account,
    });
    await mode.write.openDirect([TOKEN_ID_BASE, DENOM_NATIVE, ZERO, 500n * 10n ** 8n], {
      account: seller.account,
    });
    await assert.rejects(
      passport.write.appendRecord([TOKEN_ID_BASE, "service", "while listed", ""], {
        account: seller.account,
      }),
      revertsWith("NotOwner"),
    );
  });
});

// ─── KarPassport — getPassportStatus ──────────────────────────────────────────

describe("KarPassport — getPassportStatus", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("correct through full lifecycle", async () => {
    const { viem } = connection;
    const { owner, verifier, stranger, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://s"], {
      account: owner.account,
    });
    let [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 0);

    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 1);

    await passport.write.open([TOKEN_ID_BASE], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 2);

    await joinVerifier(staking, stranger);
    await passport.write.judge([TOKEN_ID_BASE, 0], { account: stranger.account });
    [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 0);
  });
});

// ─── Event completeness (G1/G2/G3) ───────────────────────────────────────────

describe("Event completeness (G1/G2/G3)", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("ProPassMinted emits metadataURI", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, proPass, staking } = await deployVerifierStack(viem);
    const metadataURI = "ar://mint-meta";
    const hash = await staking.write.becomeVerifierNative(
      [Category.BROKER, "Broker Inc", metadataURI],
      { account: verifier.account, value: MIN_STAKE },
    );
    const logs = await receiptLogs(publicClient, hash, proPass.abi);
    const minted = logs.find((l) => l.eventName === "ProPassMinted");
    assert.ok(minted);
    assert.equal(minted!.args.metadataURI, metadataURI);
  });

  it("ProfileUpdated emits metadataURI", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier, { metadataURI: "ar://old" });
    const newURI = "ar://updated-profile";
    const hash = await proPass.write.updateProfile([Category.DEALER, "New Name", newURI], {
      account: verifier.account,
    });
    const logs = await receiptLogs(publicClient, hash, proPass.abi);
    const updated = logs.find((l) => l.eventName === "ProfileUpdated");
    assert.ok(updated);
    assert.equal(updated!.args.metadataURI, newURI);
  });

  it("RecordAppended emits description and evidenceCID via appendRecord", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://r"], {
      account: owner.account,
    });
    const hash = await passport.write.appendRecord(
      [TOKEN_ID_BASE, "service", "Oil change", "cid-service"],
      { account: owner.account },
    );
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    const appended = logs.find((l) => l.eventName === "RecordAppended");
    assert.ok(appended);
    assert.equal(appended!.args.recordType, "service");
    assert.equal(appended!.args.description, "Oil change");
    assert.equal(appended!.args.evidenceCID, "cid-service");
  });

  it("RecordAppended emits description and evidenceCID via reportDiscrepancy", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://r"], {
      account: owner.account,
    });
    const hash = await passport.write.reportDiscrepancy(
      [TOKEN_ID_BASE, "scratch found", "cid-disc"],
      { account: stranger.account },
    );
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    const appended = logs.find((l) => l.eventName === "RecordAppended");
    assert.ok(appended);
    assert.equal(appended!.args.recordType, "discrepancy");
    assert.equal(appended!.args.description, "scratch found");
    assert.equal(appended!.args.evidenceCID, "cid-disc");
  });

  it("RecordAppended emits description and evidenceCID via appendAttestation", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://a"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    const hash = await passport.write.appendAttestation(
      [TOKEN_ID_BASE, "looks good", "cid-attest"],
      { account: verifier.account },
    );
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    const appended = logs.find((l) => l.eventName === "RecordAppended");
    assert.ok(appended);
    assert.equal(appended!.args.recordType, "attestation");
    assert.equal(appended!.args.description, "looks good");
    assert.equal(appended!.args.evidenceCID, "cid-attest");
  });
});

describe("KarPassport — error coverage matrix", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("withdraw when not DISPUTED reverts NoActiveDispute", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://cov"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.withdraw([TOKEN_ID_BASE], { account: owner.account }),
      revertsWith("NoActiveDispute"),
    );
  });

  it("withdraw by non-opener reverts NotDisputeOpener", async () => {
    const { viem } = connection;
    const { owner, stranger, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://cov"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    await passport.write.open([TOKEN_ID_BASE], {
      account: owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await assert.rejects(
      passport.write.withdraw([TOKEN_ID_BASE], { account: stranger.account }),
      revertsWith("NotDisputeOpener"),
    );
  });

  it("setPassportURI on unknown token reverts NonexistentToken", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    const missing = TOKEN_ID_BASE + 99n;
    await assert.rejects(
      passport.write.setPassportURI([missing, "ar://x"], { account: owner.account }),
      revertsWith("NonexistentToken"),
    );
  });
});

describe("KarProPass — error coverage matrix", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("second mint to same holder reverts AlreadyHoldsPass", async () => {
    const { viem } = connection;
    const { admin, owner, proPass } = await deployVerifierStack(viem);
    await proPass.write.setStaking([admin.account.address], { account: admin.account });
    await proPass.write.mint(
      [owner.account.address, Category.INSPECTOR, "A", "ar://a"],
      { account: admin.account },
    );
    await assert.rejects(
      proPass.write.mint(
        [owner.account.address, Category.DEALER, "B", "ar://b"],
        { account: admin.account },
      ),
      revertsWith("AlreadyHoldsPass"),
    );
  });

  it("burn when holder has no pass reverts DoesNotHoldPass", async () => {
    const { viem } = connection;
    const { admin, stranger, proPass } = await deployVerifierStack(viem);
    await proPass.write.setStaking([admin.account.address], { account: admin.account });
    await assert.rejects(
      proPass.write.burn([stranger.account.address], { account: admin.account }),
      revertsWith("DoesNotHoldPass"),
    );
  });

  it("mint with out-of-range category reverts InvalidCategory", async () => {
    const { viem } = connection;
    const { admin, owner, proPass } = await deployVerifierStack(viem);
    await proPass.write.setStaking([admin.account.address], { account: admin.account });
    await assert.rejects(
      proPass.write.mint([owner.account.address, 6, "X", "ar://x"], { account: admin.account }),
      revertsWith("InvalidCategory"),
    );
  });
});
