import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { encodeFunctionData, getAddress, parseEventLogs, type Hash, type PublicClient } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const MIN_STAKE = 50_000_000_000_000_000n; // 0.05 ether

/** $2000 per 1 native token, Chainlink-style 8 decimals. */
const NATIVE_USD_8D = 2000n * 10n ** 8n;

const Category = {
  MECHANIC: 0,
  GARAGE: 1,
  INSPECTOR: 2,
  BROKER: 3,
  DEALER: 4,
  OTHER: 5,
} as const;

type NetworkConnection = Awaited<ReturnType<typeof hardhat.network.connect>>;
type ViemSuite = NetworkConnection["viem"];
type WalletClient = Awaited<ReturnType<ViemSuite["getWalletClients"]>>[number];
type DeployedContract = Awaited<ReturnType<ViemSuite["deployContract"]>>;

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    return err.message.includes(errorName);
  };
}

async function deployTimelock(viem: ViemSuite, admin: `0x${string}`) {
  return viem.deployContract("TimelockController", [
    48n * 3600n,
    [admin],
    [admin],
    admin,
  ]);
}

async function deployMarketplaceViaProxy(
  viem: ViemSuite,
  params: {
    karPassport: `0x${string}`;
    usdc: `0x${string}`;
    nativeFeed: `0x${string}`;
    eurFeed: `0x${string}`;
    karProStaking: `0x${string}`;
    platformRecipient: `0x${string}`;
    feeBps: bigint;
    proFeeBps: bigint;
    maxStale: bigint;
    timelock: `0x${string}`;
  },
) {
  const implementation = await viem.deployContract("MarketplaceEscrow", [
    params.karPassport,
    params.usdc,
    params.nativeFeed,
    params.eurFeed,
    params.karProStaking,
    params.platformRecipient,
    params.feeBps,
    params.proFeeBps,
    params.maxStale,
  ]);

  const initData = encodeFunctionData({
    abi: implementation.abi,
    functionName: "initialize",
    args: [params.timelock],
  });

  const proxy = await viem.deployContract("ERC1967Proxy", [implementation.address, initData]);
  const marketplace = await viem.getContractAt("MarketplaceEscrow", proxy.address);
  return { implementation, proxy, marketplace };
}

async function deployVerifierStack(viem: ViemSuite) {
  const [admin, owner, verifier, stranger] = await viem.getWalletClients();
  const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
  const staking = await viem.deployContract("KarProStaking", [
    proPass.address,
    admin.account.address,
  ]);
  await proPass.write.setStaking([staking.address], { account: admin.account });
  return { admin, owner, verifier, stranger, proPass, staking };
}

async function deployPassportStack(viem: ViemSuite) {
  const base = await deployVerifierStack(viem);
  const passport = await viem.deployContract("KarPassport", [base.staking.address]);
  return { ...base, passport };
}

async function deployEscrowStack(viem: ViemSuite) {
  const base = await deployPassportStack(viem);
  const usdc = await viem.deployContract("MockUSDC", []);
  const nativeFeed = await viem.deployContract("MockV3Aggregator", [8, NATIVE_USD_8D]);
  const timelock = await deployTimelock(viem, base.admin.account.address);
  const feeBps = 250n;
  const proFeeBps = 100n;
  const maxStale = 3600n;
  const { marketplace, implementation, proxy } = await deployMarketplaceViaProxy(viem, {
    karPassport: base.passport.address,
    usdc: usdc.address,
    nativeFeed: nativeFeed.address,
    eurFeed: ZERO,
    karProStaking: base.staking.address,
    platformRecipient: base.admin.account.address,
    feeBps,
    proFeeBps,
    maxStale,
    timelock: timelock.address,
  });
  return {
    ...base,
    seller: base.owner,
    buyer: base.verifier,
    usdc,
    nativeFeed,
    marketplace,
    implementation,
    proxy,
    timelock,
    feeBps,
    proFeeBps,
  };
}

async function joinVerifier(
  staking: DeployedContract,
  account: WalletClient,
  opts: {
    category?: number;
    name?: string;
    metadataURI?: string;
    value?: bigint;
  } = {},
) {
  const category = opts.category ?? Category.INSPECTOR;
  const name = opts.name ?? "Test Verifier";
  const metadataURI = opts.metadataURI ?? "ipfs://profile";
  const value = opts.value ?? MIN_STAKE;
  await staking.write.becomeVerifierNative([category, name, metadataURI], {
    account: account.account,
    value,
  });
}

async function receiptLogs(
  publicClient: PublicClient,
  hash: Hash,
  abi: readonly unknown[],
) {
  const receipt = await publicClient.getTransactionReceipt({ hash });
  return parseEventLogs({ abi, logs: receipt.logs });
}

// ─── KarProPass ───────────────────────────────────────────────────────────────

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
      proPass.write.mint([owner.account.address, Category.INSPECTOR, "X", "ipfs://x"], {
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
      metadataURI: "ipfs://old",
    });
    const tokenId = BigInt(verifier.account.address);
    await proPass.write.updateProfile([Category.DEALER, "New Name", "ipfs://new"], {
      account: verifier.account,
    });
    assert.equal(await proPass.read.holderCategory([tokenId]), Category.DEALER);
    assert.equal(await proPass.read.holderName([tokenId]), "New Name");
    assert.equal(await proPass.read.holderMetadataURI([tokenId]), "ipfs://new");
  });

  it("updateProfile reverts if caller has no pass", async () => {
    const { viem } = connection;
    const { stranger, proPass } = await deployVerifierStack(viem);
    await assert.rejects(
      proPass.write.updateProfile([Category.OTHER, "X", "ipfs://x"], {
        account: stranger.account,
      }),
      revertsWith("NotHolder"),
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
      staking.write.becomeVerifierNative([Category.INSPECTOR, "X", "ipfs://x"], {
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
      staking.write.becomeVerifierNative([Category.INSPECTOR, "X", "ipfs://x"], {
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
      [Category.INSPECTOR, "Verifier Co", "ipfs://v"],
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
      metadataURI: "ipfs://broker",
    });
    const tokenId = BigInt(verifier.account.address);
    const [, category, name, metadataURI] = await proPass.read.getProPassData([tokenId]);
    assert.equal(category, Category.BROKER);
    assert.equal(name, "Broker Inc");
    assert.equal(metadataURI, "ipfs://broker");
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
      staking.write.becomeVerifierNative([Category.INSPECTOR, "X", "ipfs://x"], {
        account: verifier.account,
        value: newMin - 1n,
      }),
      revertsWith("BelowMinStake"),
    );
    await staking.write.becomeVerifierNative([Category.INSPECTOR, "X", "ipfs://x"], {
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
      [Category.GARAGE, "Garage Pro", "ipfs://garage"],
      { account: verifier.account },
    );
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n);
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), true);
  });

  it("becomeVerifierToken reverts when token not set", async () => {
    const { viem } = connection;
    const { verifier, staking } = await deployVerifierStack(viem);
    await assert.rejects(
      staking.write.becomeVerifierToken([Category.INSPECTOR, "X", "ipfs://x"], {
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
      [Category.MECHANIC, "Mech Shop", "ipfs://mech"],
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
      [Category.INSPECTOR, "Token Verifier", "ipfs://t"],
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
      [Category.INSPECTOR, "Fee Test", "ipfs://fee"],
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
        [Category.INSPECTOR, "Fee Fail", "ipfs://fail"],
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
    const uri = "ipfs://passport-1";
    await passport.write.mintPassport([owner.account.address, uri], {
      account: owner.account,
    });
    const [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 0);
    assert.equal(await passport.read.tokenURI([0n]), uri);
  });

  it("tokenId increments", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    assert.equal(await passport.read.nextTokenId(), 0n);
    await passport.write.mintPassport([owner.account.address, "ipfs://0"], {
      account: owner.account,
    });
    assert.equal(await passport.read.nextTokenId(), 1n);
    await passport.write.mintPassport([owner.account.address, "ipfs://1"], {
      account: owner.account,
    });
    assert.equal(await passport.read.nextTokenId(), 2n);
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
    await passport.write.mintPassport([owner.account.address, "ipfs://old"], {
      account: owner.account,
    });
    await passport.write.setPassportURI([0n, "ipfs://new"], { account: owner.account });
    assert.equal(await passport.read.tokenURI([0n]), "ipfs://new");
  });

  it("reverts not owner", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://x"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.setPassportURI([0n, "ipfs://hack"], { account: stranger.account }),
      revertsWith("NotOwner"),
    );
  });

  it("updates when VERIFIED and resets verification", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await passport.write.setPassportURI([0n, "ipfs://new"], { account: owner.account });
    assert.equal(await passport.read.tokenURI([0n]), "ipfs://new");
    const [status, recordedVerifier, verifiedAt] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 0);
    assert.equal(getAddress(recordedVerifier), getAddress("0x0000000000000000000000000000000000000000"));
    assert.equal(verifiedAt, 0n);
  });

  it("reverts SameURI when VERIFIED and keeps verification", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await assert.rejects(
      passport.write.setPassportURI([0n, "ipfs://v"], { account: owner.account }),
      revertsWith("SameURI"),
    );
    const [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 1);
  });

  it("reverts SameURI when UNVERIFIED", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://old"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.setPassportURI([0n, "ipfs://old"], { account: owner.account }),
      revertsWith("SameURI"),
    );
  });

  it("reverts empty URI", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://old"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.setPassportURI([0n, ""], { account: owner.account }),
      revertsWith("EmptyField"),
    );
  });

  it("reverts when DISPUTED", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://d"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await passport.write.disputePassport([0n, "issue"], { account: owner.account });
    await assert.rejects(
      passport.write.setPassportURI([0n, "ipfs://new"], { account: owner.account }),
      revertsWith("InvalidStatus"),
    );
  });

  it("reverts NotOwner when listed in escrow", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://listed"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([0n, 500n * 10n ** 8n, 0], { account: seller.account });
    await assert.rejects(
      passport.write.setPassportURI([0n, "ipfs://new"], { account: seller.account }),
      revertsWith("NotOwner"),
    );
  });

  it("allows edit after resolve(false) from DISPUTED", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://d"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await passport.write.disputePassport([0n, "issue"], { account: owner.account });
    await passport.write.resolveDispute([0n, false], { account: verifier.account });
    await passport.write.setPassportURI([0n, "ipfs://fixed"], { account: owner.account });
    assert.equal(await passport.read.tokenURI([0n]), "ipfs://fixed");
    const [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 0);
  });

  it("UNVERIFIED update does not emit VerificationReset", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://old"], {
      account: owner.account,
    });
    const hash = await passport.write.setPassportURI([0n, "ipfs://new"], { account: owner.account });
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    assert.equal(logs.some((l) => l.eventName === "VerificationReset"), false);
    assert.equal(logs.some((l) => l.eventName === "PassportURIUpdated"), true);
  });

  it("emits VerificationReset when editing VERIFIED passport", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    const hash = await passport.write.setPassportURI([0n, "ipfs://new"], { account: owner.account });
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    const reset = logs.find((l) => l.eventName === "VerificationReset");
    assert.ok(reset);
    assert.equal(reset!.args.tokenId, 0n);
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
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    const [status, recordedVerifier] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 1);
    assert.equal(getAddress(recordedVerifier), getAddress(verifier.account.address));
  });

  it("reverts: not active verifier", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.verifyPassport([0n], { account: stranger.account }),
      revertsWith("NotActiveVerifier"),
    );
  });

  it("reverts: self-verify", async () => {
    const { viem } = connection;
    const { owner, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, owner);
    await assert.rejects(
      passport.write.verifyPassport([0n], { account: owner.account }),
      revertsWith("CannotSelfVerify"),
    );
  });

  it("reverts: already VERIFIED", async () => {
    const { viem } = connection;
    const { owner, verifier, stranger, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await joinVerifier(staking, stranger);
    await assert.rejects(
      passport.write.verifyPassport([0n], { account: stranger.account }),
      revertsWith("InvalidStatus"),
    );
  });

  it("verifier who left with pass still held cannot verify", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, stranger, passport, proPass, staking } =
      await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await proPass.write.setStaking([stranger.account.address], { account: admin.account });
    await staking.write.leave([], { account: verifier.account });
    assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), false);
    assert.equal(await proPass.read.balanceOf([verifier.account.address]), 1n);
    await assert.rejects(
      passport.write.verifyPassport([0n], { account: verifier.account }),
      revertsWith("NotActiveVerifier"),
    );
  });

  it("verifier who left (pass burned) can no longer verify", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await staking.write.leave([], { account: verifier.account });
    await assert.rejects(
      passport.write.verifyPassport([0n], { account: verifier.account }),
      revertsWith("NotActiveVerifier"),
    );
  });

  it("passport stays VERIFIED after its verifier leaves", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await staking.write.leave([], { account: verifier.account });
    const [status, recordedVerifier, verifiedAt] = await passport.read.getPassportStatus([0n]);
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
    await stack.passport.write.mintPassport([stack.owner.account.address, "ipfs://d"], {
      account: stack.owner.account,
    });
    await joinVerifier(stack.staking, stack.verifier);
    await stack.passport.write.verifyPassport([0n], { account: stack.verifier.account });
    return stack;
  }

  it("anyone disputes VERIFIED passport", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await setupVerified(viem);
    await passport.write.disputePassport([0n, "fraud"], { account: stranger.account });
    const [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 2);
    void owner;
  });

  it("reverts dispute on UNVERIFIED", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://u"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.disputePassport([0n, "reason"], { account: owner.account }),
      revertsWith("InvalidStatus"),
    );
  });

  it("reverts dispute empty reason", async () => {
    const { viem } = connection;
    const { owner, passport } = await setupVerified(viem);
    await assert.rejects(
      passport.write.disputePassport([0n, ""], { account: owner.account }),
      revertsWith("EmptyField"),
    );
  });

  it("active verifier resolves uphold=true → VERIFIED", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await setupVerified(viem);
    await passport.write.disputePassport([0n, "issue"], { account: owner.account });
    await passport.write.resolveDispute([0n, true], { account: verifier.account });
    const [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 1);
  });

  it("resolve uphold=false → UNVERIFIED, verifier cleared", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await setupVerified(viem);
    await passport.write.disputePassport([0n, "issue"], { account: owner.account });
    await passport.write.resolveDispute([0n, false], { account: verifier.account });
    const [status, recordedVerifier, verifiedAt] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 0);
    assert.equal(recordedVerifier, ZERO);
    assert.equal(verifiedAt, 0n);
    void staking;
  });

  it("resolve reverts: not active verifier", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await setupVerified(viem);
    await passport.write.disputePassport([0n, "issue"], { account: owner.account });
    await assert.rejects(
      passport.write.resolveDispute([0n, true], { account: stranger.account }),
      revertsWith("NotActiveVerifier"),
    );
  });

  it("resolve reverts: not DISPUTED", async () => {
    const { viem } = connection;
    const { verifier, passport, staking } = await setupVerified(viem);
    await assert.rejects(
      passport.write.resolveDispute([0n, true], { account: verifier.account }),
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
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    await passport.write.appendRecord([0n, "service", "Oil change", "cid-1"], {
      account: owner.account,
    });
    assert.equal(await passport.read.recordCount([0n]), 1n);
  });

  it("reportDiscrepancy permissionless", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    await passport.write.reportDiscrepancy([0n, "scratch found", "cid-2"], {
      account: stranger.account,
    });
    assert.equal(await passport.read.recordCount([0n]), 1n);
  });

  it("appendAttestation requires active verifier", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://a"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.appendAttestation([0n, "looks good", "cid-3"], {
        account: stranger.account,
      }),
      revertsWith("NotActiveVerifier"),
    );
  });

  it("recordCount increments", async () => {
    const { viem } = connection;
    const { owner, verifier, passport, staking } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.appendRecord([0n, "note", "first", ""], { account: owner.account });
    await passport.write.appendAttestation([0n, "attest", "cid"], { account: verifier.account });
    assert.equal(await passport.read.recordCount([0n]), 2n);
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
    await passport.write.mintPassport([owner.account.address, "ipfs://s"], {
      account: owner.account,
    });
    let [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 0);

    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 1);

    await passport.write.disputePassport([0n, "issue"], { account: owner.account });
    [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 2);

    await passport.write.resolveDispute([0n, false], { account: verifier.account });
    [status] = await passport.read.getPassportStatus([0n]);
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
    const metadataURI = "ipfs://mint-meta";
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
    await joinVerifier(staking, verifier, { metadataURI: "ipfs://old" });
    const newURI = "ipfs://updated-profile";
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
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    const hash = await passport.write.appendRecord(
      [0n, "service", "Oil change", "cid-service"],
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
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    const hash = await passport.write.reportDiscrepancy(
      [0n, "scratch found", "cid-disc"],
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
    await passport.write.mintPassport([owner.account.address, "ipfs://a"], {
      account: owner.account,
    });
    await joinVerifier(staking, verifier);
    const hash = await passport.write.appendAttestation(
      [0n, "looks good", "cid-attest"],
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
    await passport.write.mintPassport([seller.account.address, "ipfs://list"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([0n, 500n * 10n ** 8n, 0], { account: seller.account });
    let listing = await marketplace.read.listings([0n]);
    assert.equal(listing[3], true);
    await marketplace.write.delist([0n], { account: seller.account });
    listing = await marketplace.read.listings([0n]);
    assert.equal(listing[3], false);
    assert.equal(
      getAddress(await passport.read.ownerOf([0n])),
      getAddress(seller.account.address),
    );
  });

  it("buyWithNative with fee distribution", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, seller, buyer, passport, marketplace, feeBps } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://buy"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    const usd1e8 = 1000n * 10n ** 8n;
    await marketplace.write.list([0n, usd1e8, 0], { account: seller.account });
    const gross = await marketplace.read.quoteNativeWei([0n]);
    const adminBefore = await publicClient.getBalance({ address: admin.account.address });
    const sellerBefore = await publicClient.getBalance({ address: seller.account.address });
    await marketplace.write.buyWithNative([0n], { account: buyer.account, value: gross });
    const fee = (gross * feeBps) / 10_000n;
    const net = gross - fee;
    assert.equal(
      getAddress(await passport.read.ownerOf([0n])),
      getAddress(buyer.account.address),
    );
    const adminAfter = await publicClient.getBalance({ address: admin.account.address });
    const sellerAfter = await publicClient.getBalance({ address: seller.account.address });
    assert.equal(adminAfter - adminBefore, fee);
    assert.equal(sellerAfter - sellerBefore, net);
  });

  it("buyWithUsdc with fee distribution", async () => {
    const { viem } = connection;
    const { admin, seller, buyer, passport, usdc, marketplace, feeBps } =
      await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://u"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    const usd1e8 = 200n * 10n ** 8n;
    await marketplace.write.list([0n, usd1e8, 0], { account: seller.account });
    const gross = await marketplace.read.quoteUsdcAmount([0n]);
    await usdc.write.mint([buyer.account.address, gross]);
    await usdc.write.approve([marketplace.address, gross], { account: buyer.account });
    const adminBefore = await usdc.read.balanceOf([admin.account.address]);
    const sellerBefore = await usdc.read.balanceOf([seller.account.address]);
    await marketplace.write.buyWithUsdc([0n], { account: buyer.account });
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
    await passport.write.mintPassport([seller.account.address, "ipfs://pro"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    const usd1e8 = 1000n * 10n ** 8n;
    await marketplace.write.list([0n, usd1e8, 0], { account: seller.account });
    const gross = await marketplace.read.quoteNativeWei([0n]);
    const adminBefore = await publicClient.getBalance({ address: admin.account.address });
    await marketplace.write.buyWithNative([0n], { account: buyer.account, value: gross });
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
    await passport.write.mintPassport([seller.account.address, "ipfs://pro-left"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    const usd1e8 = 1000n * 10n ** 8n;
    await marketplace.write.list([0n, usd1e8, 0], { account: seller.account });
    await marketplace.write.delist([0n], { account: seller.account });
    await staking.write.leave([], { account: seller.account });
    assert.equal(await staking.read.isActiveVerifier([seller.account.address]), false);
    await marketplace.write.list([0n, usd1e8, 0], { account: seller.account });
    const gross = await marketplace.read.quoteNativeWei([0n]);
    const adminBefore = await publicClient.getBalance({ address: admin.account.address });
    await marketplace.write.buyWithNative([0n], { account: buyer.account, value: gross });
    const platformFee = (gross * feeBps) / 10_000n;
    const adminAfter = await publicClient.getBalance({ address: admin.account.address });
    assert.equal(adminAfter - adminBefore, platformFee);
    assert.notEqual(proFeeBps, feeBps);
  });

  it("DISPUTED passport can be listed and bought", async () => {
    const { viem } = connection;
    const { seller, buyer, verifier, passport, marketplace, staking } =
      await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://disputed"], {
      account: seller.account,
    });
    await joinVerifier(staking, verifier);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await passport.write.disputePassport([0n, "issue"], { account: seller.account });
    const [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 2);
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([0n, 400n * 10n ** 8n, 0], { account: seller.account });
    const gross = await marketplace.read.quoteNativeWei([0n]);
    await marketplace.write.buyWithNative([0n], { account: buyer.account, value: gross });
    assert.equal(
      getAddress(await passport.read.ownerOf([0n])),
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
      ZERO,
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
