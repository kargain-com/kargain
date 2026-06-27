import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress, type Hash, type PublicClient } from "viem";

import {
  Category,
  CURRENCY_USD,
  DISPUTE_DEPOSIT,
  deployEscrowStack,
  deployPassportStack,
  deployVerifierStack,
  joinVerifier,
  mintPassport,
  MIN_STAKE,
  receiptLogs,
  ZERO,
} from "../scripts/lib/local-stack.js";

const TOKEN_ID_BASE = 31337n << 128n;

const ZERO_ADDR = ZERO;

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    return err.message.includes(errorName);
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

  it("returns exact staked amount", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, staking } = await deployVerifierStack(viem);
    const extra = MIN_STAKE + 5_000_000_000_000_000n;
    await joinVerifier(staking, verifier, { value: extra });
    const stakingBefore = await publicClient.getBalance({ address: staking.address });
    await staking.write.leave([], { account: verifier.account });
    const stakingAfter = await publicClient.getBalance({ address: staking.address });
    assert.equal(stakingBefore - stakingAfter, extra);
  });

  it("burns KarProPass", async () => {
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

  it("reverts if not a verifier", async () => {
    const { viem } = connection;
    const { stranger, staking } = await deployVerifierStack(viem);
    await assert.rejects(
      staking.write.leave([], { account: stranger.account }),
      revertsWith("NotVerifier"),
    );
  });

  it("emits VerifierLeft", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    const hash = await staking.write.leave([], { account: verifier.account });
    const logs = await receiptLogs(publicClient, hash, staking.abi);
    const left = logs.find((l) => l.eventName === "VerifierLeft");
    assert.ok(left);
    assert.equal(left!.args.returned, MIN_STAKE);
  });

  it("can rejoin after leaving", async () => {
    const { viem } = connection;
    const { verifier, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier);
    await staking.write.leave([], { account: verifier.account });
    await joinVerifier(staking, verifier, { name: "Rejoined" });
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n);
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), true);
  });

  it("returns locked amount even after minStake changed", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, verifier, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier, { value: MIN_STAKE });
    const higherMin = 80_000_000_000_000_000n; // 0.08 ether
    await staking.write.setMinStakeNative([higherMin], { account: admin.account });
    const stakingBefore = await publicClient.getBalance({ address: staking.address });
    await staking.write.leave([], { account: verifier.account });
    const stakingAfter = await publicClient.getBalance({ address: staking.address });
    assert.equal(stakingBefore - stakingAfter, MIN_STAKE);
    assert.equal(await staking.read.minStakeNative(), higherMin);
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

  it("setStakeToken enables token staking", async () => {
    const { viem } = connection;
    const { admin, verifier, proPass, staking } = await deployVerifierStack(viem);
    const usdc = await viem.deployContract("MockUSDC", []);
    const tokenMin = 1_000_000n; // 1 USDC
    await staking.write.setStakeToken([usdc.address, tokenMin], { account: admin.account });
    await usdc.write.mint([verifier.account.address, tokenMin]);
    await usdc.write.approve([staking.address, tokenMin], { account: verifier.account });
    await staking.write.becomeVerifierToken(
      [Category.GARAGE, "Garage Pro", "ar://garage"],
      { account: verifier.account },
    );
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n);
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), true);
  });

  it("becomeVerifierToken reverts when token not set", async () => {
    const { viem } = connection;
    const { verifier, staking } = await deployVerifierStack(viem);
    await assert.rejects(
      staking.write.becomeVerifierToken([Category.INSPECTOR, "X", "ar://x"], {
        account: verifier.account,
      }),
      revertsWith("TokenNotEnabled"),
    );
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

  it("only owner can setStakeToken", async () => {
    const { viem } = connection;
    const { stranger, staking } = await deployVerifierStack(viem);
    const usdc = await viem.deployContract("MockUSDC", []);
    await assert.rejects(
      staking.write.setStakeToken([usdc.address, 1_000_000n], { account: stranger.account }),
    );
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
        assert.fail(`Unexpected drain-like function: ${item.name}`);
      }
    }

    await joinVerifier(staking, verifier, { value: MIN_STAKE });
    await joinVerifier(staking, stranger, { value: MIN_STAKE });
    const balanceAfterJoin = await publicClient.getBalance({ address: staking.address });
    assert.equal(balanceAfterJoin, MIN_STAKE * 2n);

    const usdc = await viem.deployContract("MockUSDC", []);
    await staking.write.setMinStakeNative([1_000_000_000_000_000_000n], { account: admin.account });
    await staking.write.setStakeToken([usdc.address, 1_000_000n], { account: admin.account });
    const balanceAfterOwnerOps = await publicClient.getBalance({ address: staking.address });
    assert.equal(balanceAfterOwnerOps, balanceAfterJoin);

    const verifierStakingBefore = await publicClient.getBalance({ address: staking.address });
    await staking.write.leave([], { account: verifier.account });
    const verifierStakingAfter = await publicClient.getBalance({ address: staking.address });
    assert.equal(verifierStakingBefore - verifierStakingAfter, MIN_STAKE);

    const strangerStakingBefore = await publicClient.getBalance({ address: staking.address });
    await staking.write.leave([], { account: stranger.account });
    const strangerStakingAfter = await publicClient.getBalance({ address: staking.address });
    assert.equal(strangerStakingBefore - strangerStakingAfter, MIN_STAKE);

    assert.equal(await publicClient.getBalance({ address: staking.address }), 0n);
  });

  it("becomeVerifierToken works after setStakeToken (mock ERC20)", async () => {
    const { viem } = connection;
    const { admin, verifier, proPass, staking } = await deployVerifierStack(viem);
    const usdc = await viem.deployContract("MockUSDC", []);
    const tokenMin = 500_000n;
    await staking.write.setStakeToken([usdc.address, tokenMin], { account: admin.account });
    await usdc.write.mint([verifier.account.address, tokenMin]);
    await usdc.write.approve([staking.address, tokenMin], { account: verifier.account });
    await staking.write.becomeVerifierToken(
      [Category.MECHANIC, "Mech Shop", "ar://mech"],
      { account: verifier.account },
    );
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n);
    const stake = await staking.read.stakes([verifier.account.address]);
    assert.equal(stake[0], 1); // TOKEN
    assert.equal(stake[1], tokenMin);
    void admin;
  });

  it("token leave returns exact token amount", async () => {
    const { viem } = connection;
    const { admin, verifier, proPass, staking } = await deployVerifierStack(viem);
    const usdc = await viem.deployContract("MockUSDC", []);
    const tokenMin = 750_000n;
    await staking.write.setStakeToken([usdc.address, tokenMin], { account: admin.account });
    await usdc.write.mint([verifier.account.address, tokenMin]);
    await usdc.write.approve([staking.address, tokenMin], { account: verifier.account });
    await staking.write.becomeVerifierToken(
      [Category.INSPECTOR, "Token Verifier", "ar://t"],
      { account: verifier.account },
    );
    const before = await usdc.read.balanceOf([verifier.account.address]);
    await staking.write.leave([], { account: verifier.account });
    const after = await usdc.read.balanceOf([verifier.account.address]);
    assert.equal(after - before, tokenMin);
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 0n);
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

  it("leave() succeeds and returns stake even if KarProPass staking address was changed", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, verifier, stranger, proPass, staking } = await deployVerifierStack(viem);
    await joinVerifier(staking, verifier, { value: MIN_STAKE });
    await proPass.write.setStaking([stranger.account.address], { account: admin.account });
    const stakingBefore = await publicClient.getBalance({ address: staking.address });
    await staking.write.leave([], { account: verifier.account });
    const stakingAfter = await publicClient.getBalance({ address: staking.address });
    assert.equal(stakingBefore - stakingAfter, MIN_STAKE);
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), false);
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n);
  });
});

// ─── KarProStaking — fee-on-transfer protection ───────────────────────────────

describe("KarProStaking — fee-on-transfer protection", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("becomeVerifierToken records actual received amount with zero-fee token", async () => {
    const { viem } = connection;
    const { admin, verifier, staking } = await deployVerifierStack(viem);
    const feeToken = await viem.deployContract("MockFeeToken", [0n]);
    const tokenMin = 1_000_000n;
    await staking.write.setStakeToken([feeToken.address, tokenMin], { account: admin.account });
    await feeToken.write.mint([verifier.account.address, tokenMin]);
    await feeToken.write.approve([staking.address, tokenMin], { account: verifier.account });
    await staking.write.becomeVerifierToken(
      [Category.INSPECTOR, "Fee Test", "ar://fee"],
      { account: verifier.account },
    );
    const stake = await staking.read.stakes([verifier.account.address]);
    assert.equal(stake[1], tokenMin);
    assert.equal(await feeToken.read.balanceOf([staking.address]), tokenMin);
  });

  it("becomeVerifierToken reverts when fee token delivers less than minStakeToken", async () => {
    const { viem } = connection;
    const { admin, verifier, staking } = await deployVerifierStack(viem);
    const feeToken = await viem.deployContract("MockFeeToken", [1000n]);
    const tokenMin = 1_000_000n;
    await staking.write.setStakeToken([feeToken.address, tokenMin], { account: admin.account });
    await feeToken.write.mint([verifier.account.address, tokenMin]);
    await feeToken.write.approve([staking.address, tokenMin], { account: verifier.account });
    await assert.rejects(
      staking.write.becomeVerifierToken(
        [Category.INSPECTOR, "Fee Fail", "ar://fail"],
        { account: verifier.account },
      ),
      revertsWith("BelowMinStake"),
    );
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
    await passport.write.disputePassport([TOKEN_ID_BASE, "issue"], { account: owner.account, value: DISPUTE_DEPOSIT });
    await assert.rejects(
      passport.write.setPassportURI([TOKEN_ID_BASE, "ar://new"], { account: owner.account }),
      revertsWith("InvalidStatus"),
    );
  });

  it("reverts NotOwner when listed in escrow", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ar://listed"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([TOKEN_ID_BASE, 500n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    await assert.rejects(
      passport.write.setPassportURI([TOKEN_ID_BASE, "ar://new"], { account: seller.account }),
      revertsWith("NotOwner"),
    );
  });

  it("allows edit after resolve(false) from DISPUTED", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://d"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    await passport.write.disputePassport([TOKEN_ID_BASE, "issue"], { account: owner.account, value: DISPUTE_DEPOSIT });
    await passport.write.resolveDispute([TOKEN_ID_BASE, 0], { account: verifier.account });
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

  it("anyone disputes VERIFIED passport", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await setupVerified(viem);
    await passport.write.disputePassport([TOKEN_ID_BASE, "fraud"], { account: stranger.account, value: DISPUTE_DEPOSIT });
    const [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 2);
    void owner;
  });

  it("reverts dispute on UNVERIFIED", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://u"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.disputePassport([TOKEN_ID_BASE, "reason"], { account: owner.account, value: DISPUTE_DEPOSIT }),
      revertsWith("InvalidStatus"),
    );
  });

  it("reverts dispute empty reason", async () => {
    const { viem } = connection;
    const { owner, passport } = await setupVerified(viem);
    await assert.rejects(
      passport.write.disputePassport([TOKEN_ID_BASE, ""], { account: owner.account, value: DISPUTE_DEPOSIT }),
      revertsWith("EmptyField"),
    );
  });

  it("active verifier resolves uphold=true → VERIFIED", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await setupVerified(viem);
    await passport.write.disputePassport([TOKEN_ID_BASE, "issue"], { account: owner.account, value: DISPUTE_DEPOSIT });
    await passport.write.resolveDispute([TOKEN_ID_BASE, 1], { account: verifier.account });
    const [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 1);
  });

  it("resolve uphold=false → UNVERIFIED, verifier cleared", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await setupVerified(viem);
    await passport.write.disputePassport([TOKEN_ID_BASE, "issue"], { account: owner.account, value: DISPUTE_DEPOSIT });
    await passport.write.resolveDispute([TOKEN_ID_BASE, 0], { account: verifier.account });
    const [status, recordedVerifier, verifiedAt] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 0);
    assert.equal(recordedVerifier, ZERO);
    assert.equal(verifiedAt, 0n);
    void staking;
  });

  it("resolve reverts: not active verifier", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await setupVerified(viem);
    await passport.write.disputePassport([TOKEN_ID_BASE, "issue"], { account: owner.account, value: DISPUTE_DEPOSIT });
    await assert.rejects(
      passport.write.resolveDispute([TOKEN_ID_BASE, 1], { account: stranger.account }),
      revertsWith("NotActiveVerifier"),
    );
  });

  it("resolve reverts: not DISPUTED", async () => {
    const { viem } = connection;
    const { verifier, passport, staking } = await setupVerified(viem);
    await assert.rejects(
      passport.write.resolveDispute([TOKEN_ID_BASE, 1], { account: verifier.account }),
      revertsWith("InvalidStatus"),
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

  it("appendRecord reverts NotOwner when listed in escrow", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ar://listed-record"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([TOKEN_ID_BASE, 500n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
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
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ar://s"], {
      account: owner.account,
    });
    let [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 0);

    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 1);

    await passport.write.disputePassport([TOKEN_ID_BASE, "issue"], { account: owner.account, value: DISPUTE_DEPOSIT });
    [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 2);

    await passport.write.resolveDispute([TOKEN_ID_BASE, 0], { account: verifier.account });
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

// ─── MarketplaceEscrow ────────────────────────────────────────────────────────

describe("MarketplaceEscrow", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("platformFeeBps equals constructor value", async () => {
    const { viem } = connection;
    const { marketplace, feeBps } = await deployEscrowStack(viem);
    assert.equal(BigInt(await marketplace.read.platformFeeBps()), feeBps);
    assert.equal(feeBps, 250n);
  });

  it("list, delist", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ar://list"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([TOKEN_ID_BASE, 500n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    let listing = await marketplace.read.listings([TOKEN_ID_BASE]);
    assert.equal(listing[2], true);
    await marketplace.write.delist([TOKEN_ID_BASE], { account: seller.account });
    listing = await marketplace.read.listings([TOKEN_ID_BASE]);
    assert.equal(listing[2], false);
    assert.equal(
      getAddress(await passport.read.ownerOf([TOKEN_ID_BASE])),
      getAddress(seller.account.address),
    );
  });

  it("buyWithNative with fee distribution", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, seller, buyer, passport, marketplace, feeBps } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ar://buy"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    const usd1e8 = 1000n * 10n ** 8n;
    await marketplace.write.list([TOKEN_ID_BASE, usd1e8, CURRENCY_USD], { account: seller.account });
    const gross = await marketplace.read.quoteBuyWithNative([TOKEN_ID_BASE]);
    const adminBefore = await publicClient.getBalance({ address: admin.account.address });
    const sellerBefore = await publicClient.getBalance({ address: seller.account.address });
    await marketplace.write.buyWithNative([TOKEN_ID_BASE], { account: buyer.account, value: gross });
    const fee = (gross * feeBps) / 10_000n;
    const net = gross - fee;
    assert.equal(
      getAddress(await passport.read.ownerOf([TOKEN_ID_BASE])),
      getAddress(buyer.account.address),
    );
    const adminAfter = await publicClient.getBalance({ address: admin.account.address });
    const sellerAfter = await publicClient.getBalance({ address: seller.account.address });
    assert.equal(adminAfter - adminBefore, fee);
    assert.equal(sellerAfter - sellerBefore, net);
  });

  it("E5: buyer inherits passport status after buyWithNative", async () => {
    const { viem } = connection;
    const { seller, buyer, verifier, passport, marketplace, staking } =
      await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ar://e5"], {
      account: seller.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    const [statusBefore] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(statusBefore, 1);
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([TOKEN_ID_BASE, 500n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    const gross = await marketplace.read.quoteBuyWithNative([TOKEN_ID_BASE]);
    await marketplace.write.buyWithNative([TOKEN_ID_BASE], { account: buyer.account, value: gross });
    const [statusAfter] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(statusAfter, statusBefore);
    assert.equal(
      getAddress(await passport.read.ownerOf([TOKEN_ID_BASE])),
      getAddress(buyer.account.address),
    );
  });

  it("buyWithUsdc with fee distribution", async () => {
    const { viem } = connection;
    const { admin, seller, buyer, passport, usdc, marketplace, feeBps } =
      await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ar://u"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    const usd1e8 = 200n * 10n ** 8n;
    await marketplace.write.list([TOKEN_ID_BASE, usd1e8, CURRENCY_USD], { account: seller.account });
    const gross = await marketplace.read.quoteBuyWithToken([TOKEN_ID_BASE, usdc.address]);
    await usdc.write.mint([buyer.account.address, gross]);
    await usdc.write.approve([marketplace.address, gross], { account: buyer.account });
    const adminBefore = await usdc.read.balanceOf([admin.account.address]);
    const sellerBefore = await usdc.read.balanceOf([seller.account.address]);
    await marketplace.write.buyWithToken([TOKEN_ID_BASE, usdc.address], { account: buyer.account });
    const fee = (gross * feeBps) / 10_000n;
    const net = gross - fee;
    const adminAfter = await usdc.read.balanceOf([admin.account.address]);
    const sellerAfter = await usdc.read.balanceOf([seller.account.address]);
    assert.equal(adminAfter - adminBefore, fee);
    assert.equal(sellerAfter - sellerBefore, net);
  });

  it("pro seller (active verifier) pays proFeeBps", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, seller, buyer, passport, marketplace, feeBps, proFeeBps, staking } =
      await deployEscrowStack(viem);
    await joinVerifier(staking, seller, { category: Category.DEALER, name: "Pro Seller" });
    await passport.write.mintPassport([seller.account.address, "ar://pro"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    const usd1e8 = 1000n * 10n ** 8n;
    await marketplace.write.list([TOKEN_ID_BASE, usd1e8, CURRENCY_USD], { account: seller.account });
    const gross = await marketplace.read.quoteBuyWithNative([TOKEN_ID_BASE]);
    const adminBefore = await publicClient.getBalance({ address: admin.account.address });
    await marketplace.write.buyWithNative([TOKEN_ID_BASE], { account: buyer.account, value: gross });
    const proFee = (gross * proFeeBps) / 10_000n;
    const platformFee = (gross * feeBps) / 10_000n;
    assert.notEqual(proFee, platformFee);
    const adminAfter = await publicClient.getBalance({ address: admin.account.address });
    assert.equal(adminAfter - adminBefore, proFee);
  });

  it("seller who left loses pro-fee discount", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, seller, buyer, passport, marketplace, feeBps, proFeeBps, staking } =
      await deployEscrowStack(viem);
    await joinVerifier(staking, seller, { category: Category.DEALER, name: "Pro Seller" });
    await passport.write.mintPassport([seller.account.address, "ar://pro-left"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    const usd1e8 = 1000n * 10n ** 8n;
    await marketplace.write.list([TOKEN_ID_BASE, usd1e8, CURRENCY_USD], { account: seller.account });
    await marketplace.write.delist([TOKEN_ID_BASE], { account: seller.account });
    await staking.write.leave([], { account: seller.account });
    assert.equal(await staking.read.isActiveVerifier([seller.account.address]), false);
    await marketplace.write.list([TOKEN_ID_BASE, usd1e8, CURRENCY_USD], { account: seller.account });
    const gross = await marketplace.read.quoteBuyWithNative([TOKEN_ID_BASE]);
    const adminBefore = await publicClient.getBalance({ address: admin.account.address });
    await marketplace.write.buyWithNative([TOKEN_ID_BASE], { account: buyer.account, value: gross });
    const platformFee = (gross * feeBps) / 10_000n;
    const adminAfter = await publicClient.getBalance({ address: admin.account.address });
    assert.equal(adminAfter - adminBefore, platformFee);
    assert.notEqual(proFeeBps, feeBps);
  });

  it("DISPUTED passport can be listed and bought", async () => {
    const { viem } = connection;
    const { seller, buyer, verifier, passport, marketplace, staking } =
      await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ar://disputed"], {
      account: seller.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([TOKEN_ID_BASE], { account: verifier.account });
    await passport.write.disputePassport([TOKEN_ID_BASE, "issue"], { account: seller.account, value: DISPUTE_DEPOSIT });
    const [status] = await passport.read.getPassportStatus([TOKEN_ID_BASE]);
    assert.equal(status, 2);
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([TOKEN_ID_BASE, 400n * 10n ** 8n, CURRENCY_USD], { account: seller.account });
    const gross = await marketplace.read.quoteBuyWithNative([TOKEN_ID_BASE]);
    await marketplace.write.buyWithNative([TOKEN_ID_BASE], { account: buyer.account, value: gross });
    assert.equal(
      getAddress(await passport.read.ownerOf([TOKEN_ID_BASE])),
      getAddress(buyer.account.address),
    );
  });

  it("upgrade without timelock authority reverts", async () => {
    const { viem } = connection;
    const { seller, marketplace } = await deployEscrowStack(viem);
    const implementationV2 = await viem.deployContract("MarketplaceEscrow", [
      (await marketplace.read.karPassport([])) as `0x${string}`,
      (await marketplace.read.usdc([])) as `0x${string}`,
      (await marketplace.read.nativeUsdFeed([])) as `0x${string}`,
      (await marketplace.read.karProStaking([])) as `0x${string}`,
      (await marketplace.read.platformRecipient([])) as `0x${string}`,
      250n,
      100n,
      3600n,
    ]);
    await assert.rejects(
      marketplace.write.upgradeToAndCall([implementationV2.address, "0x"], {
        account: seller.account,
      }),
    );
  });
});
