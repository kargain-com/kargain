import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { encodeFunctionData, getAddress, parseEventLogs, type Hash, type PublicClient } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** $2000 per 1 native token, Chainlink-style 8 decimals. */
const NATIVE_USD_8D = 2000n * 10n ** 8n;

type NetworkConnection = Awaited<ReturnType<typeof hardhat.network.connect>>;
type ViemSuite = NetworkConnection["viem"];

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
    karProPass: `0x${string}`;
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
    params.karProPass,
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

async function deployEscrowStack(viem: ViemSuite) {
  const [admin, seller, buyer] = await viem.getWalletClients();
  const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
  const passport = await viem.deployContract("KarPassport", [proPass.address]);
  const usdc = await viem.deployContract("MockUSDC", []);
  const nativeFeed = await viem.deployContract("MockV3Aggregator", [8, NATIVE_USD_8D]);
  const timelock = await deployTimelock(viem, admin.account.address);
  const feeBps = 250n;
  const proFeeBps = 100n;
  const maxStale = 3600n;
  const { marketplace, implementation, proxy } = await deployMarketplaceViaProxy(viem, {
    karPassport: passport.address,
    usdc: usdc.address,
    nativeFeed: nativeFeed.address,
    eurFeed: ZERO,
    karProPass: proPass.address,
    platformRecipient: admin.account.address,
    feeBps,
    proFeeBps,
    maxStale,
    timelock: timelock.address,
  });
  return {
    admin,
    seller,
    buyer,
    passport,
    proPass,
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

async function mintProPass(
  proPass: Awaited<ReturnType<ViemSuite["deployContract"]>>,
  admin: NetworkConnection["viem"] extends infer V ? Awaited<ReturnType<V["getWalletClients"]>>[0] : never,
  holder: `0x${string}`,
  category = "inspector",
  name = "Test Verifier",
) {
  await proPass.write.ownerMint([holder, category, name], { account: admin.account });
}

async function deployPassportStack(viem: ViemSuite) {
  const [admin, owner, verifier, stranger] = await viem.getWalletClients();
  const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
  const passport = await viem.deployContract("KarPassport", [proPass.address]);
  return { admin, owner, verifier, stranger, proPass, passport };
}

async function receiptLogs(
  publicClient: PublicClient,
  hash: Hash,
  abi: readonly unknown[],
) {
  const receipt = await publicClient.getTransactionReceipt({ hash });
  return parseEventLogs({ abi, logs: receipt.logs });
}

describe("KarPassport — mintPassport", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("public mint succeeds, returns tokenId, emits PassportMinted", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, owner, passport } = await deployPassportStack(viem);
    void admin;

    const uri = "ipfs://mint-test";
    const hash = await passport.write.mintPassport([owner.account.address, uri], {
      account: owner.account,
    });
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    const minted = logs.find((l) => l.eventName === "PassportMinted");
    assert.ok(minted);
    assert.equal(minted.args.tokenId, 0n);
    assert.equal(getAddress(minted.args.to), getAddress(owner.account.address));
    assert.equal(minted.args.uri, uri);
    assert.equal(await passport.read.nextTokenId(), 1n);
  });

  it("status is UNVERIFIED after mint", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://s"], {
      account: owner.account,
    });
    const [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 0);
  });

  it("tokenURI is set correctly", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    const uri = "ipfs://uri-check";
    await passport.write.mintPassport([owner.account.address, uri], {
      account: owner.account,
    });
    assert.equal(await passport.read.tokenURI([0n]), uri);
  });
});

describe("KarPassport — setPassportURI", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("owner can update URI when UNVERIFIED", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://old"], {
      account: owner.account,
    });
    await passport.write.setPassportURI([0n, "ipfs://new"], { account: owner.account });
    assert.equal(await passport.read.tokenURI([0n]), "ipfs://new");
  });

  it("reverts when caller is not owner", async () => {
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

  it("reverts when status is VERIFIED", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await assert.rejects(
      passport.write.setPassportURI([0n, "ipfs://new"], { account: owner.account }),
      revertsWith("InvalidStatus"),
    );
  });

  it("reverts when status is DISPUTED", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://d"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await passport.write.disputePassport([0n, "bad vin"], { account: owner.account });
    await assert.rejects(
      passport.write.setPassportURI([0n, "ipfs://new"], { account: owner.account }),
      revertsWith("InvalidStatus"),
    );
  });
});

describe("KarPassport — verifyPassport", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("KarProPass holder (not token owner) can verify", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    const [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 1);
  });

  it("sets status to VERIFIED, records verifier and timestamp", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    const [status, verifierAddr, verifiedAt] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 1);
    assert.equal(getAddress(verifierAddr), getAddress(verifier.account.address));
    assert.ok(verifiedAt > 0n);
  });

  it("emits PassportVerified", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    const hash = await passport.write.verifyPassport([0n], { account: verifier.account });
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    assert.ok(logs.some((l) => l.eventName === "PassportVerified"));
  });

  it("reverts when caller has no KarProPass", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.verifyPassport([0n], { account: stranger.account }),
      revertsWith("NotKarProHolder"),
    );
  });

  it("reverts when caller is the token owner (self-verify)", async () => {
    const { viem } = connection;
    const { admin, owner, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, owner.account.address);
    await assert.rejects(
      passport.write.verifyPassport([0n], { account: owner.account }),
      revertsWith("CannotSelfVerify"),
    );
  });

  it("reverts when status is already VERIFIED", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://v"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await assert.rejects(
      passport.write.verifyPassport([0n], { account: verifier.account }),
      revertsWith("InvalidStatus"),
    );
  });
});

describe("KarPassport — disputePassport", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("anyone can dispute a VERIFIED passport", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, stranger, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://d"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await passport.write.disputePassport([0n, "odometer rollback"], {
      account: stranger.account,
    });
    const [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 2);
  });

  it("sets status to DISPUTED, appends discrepancy record", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://d"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    assert.equal(await passport.read.recordCount([0n]), 0n);
    await passport.write.disputePassport([0n, "vin mismatch"], { account: owner.account });
    assert.equal(await passport.read.recordCount([0n]), 1n);
  });

  it("emits PassportDisputed", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://d"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    const hash = await passport.write.disputePassport([0n, "issue"], { account: owner.account });
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    assert.ok(logs.some((l) => l.eventName === "PassportDisputed"));
  });

  it("reverts when status is UNVERIFIED", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://u"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.disputePassport([0n, "too early"], { account: owner.account }),
      revertsWith("InvalidStatus"),
    );
  });

  it("reverts when reason is empty", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://d"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await assert.rejects(
      passport.write.disputePassport([0n, ""], { account: owner.account }),
      revertsWith("EmptyField"),
    );
  });
});

describe("KarPassport — resolveDispute", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  async function setupDisputed(viem: ViemSuite) {
    const stack = await deployPassportStack(viem);
    await stack.passport.write.mintPassport([stack.owner.account.address, "ipfs://r"], {
      account: stack.owner.account,
    });
    await mintProPass(stack.proPass, stack.admin, stack.verifier.account.address);
    await stack.passport.write.verifyPassport([0n], { account: stack.verifier.account });
    await stack.passport.write.disputePassport([0n, "dispute"], {
      account: stack.owner.account,
    });
    return stack;
  }

  it("KarProPass holder can resolve with uphold=true → VERIFIED", async () => {
    const { viem } = connection;
    const { verifier, passport } = await setupDisputed(viem);
    await passport.write.resolveDispute([0n, true], { account: verifier.account });
    const [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 1);
  });

  it("KarProPass holder can resolve with uphold=false → UNVERIFIED, verifier cleared", async () => {
    const { viem } = connection;
    const { verifier, passport } = await setupDisputed(viem);
    await passport.write.resolveDispute([0n, false], { account: verifier.account });
    const [status, verifierAddr, verifiedAt] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 0);
    assert.equal(getAddress(verifierAddr), getAddress(ZERO));
    assert.equal(verifiedAt, 0n);
  });

  it("emits DisputeResolved with correct uphold value", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { verifier, passport } = await setupDisputed(viem);
    const hash = await passport.write.resolveDispute([0n, false], { account: verifier.account });
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    const resolved = logs.find((l) => l.eventName === "DisputeResolved");
    assert.ok(resolved);
    assert.equal(resolved.args.uphold, false);
  });

  it("reverts when caller has no KarProPass", async () => {
    const { viem } = connection;
    const { stranger, passport } = await setupDisputed(viem);
    await assert.rejects(
      passport.write.resolveDispute([0n, true], { account: stranger.account }),
      revertsWith("NotKarProHolder"),
    );
  });

  it("reverts when status is not DISPUTED", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://x"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await assert.rejects(
      passport.write.resolveDispute([0n, true], { account: verifier.account }),
      revertsWith("InvalidStatus"),
    );
  });
});

describe("KarPassport — appendRecord", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("owner can append a record", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    await passport.write.appendRecord([0n, "service", "oil change", "bafy1"], {
      account: owner.account,
    });
    assert.equal(await passport.read.recordCount([0n]), 1n);
  });

  it("recordCount increments", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    await passport.write.appendRecord([0n, "service", "first", ""], { account: owner.account });
    await passport.write.appendRecord([0n, "mileage", "second", ""], { account: owner.account });
    assert.equal(await passport.read.recordCount([0n]), 2n);
  });

  it("emits RecordAppended", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    const hash = await passport.write.appendRecord([0n, "service", "note", ""], {
      account: owner.account,
    });
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    assert.ok(logs.some((l) => l.eventName === "RecordAppended"));
  });

  it("reverts when caller is not owner", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.appendRecord([0n, "service", "x", ""], { account: stranger.account }),
      revertsWith("NotOwner"),
    );
  });

  it("reverts when recordType is empty", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.appendRecord([0n, "", "desc", ""], { account: owner.account }),
      revertsWith("EmptyField"),
    );
  });

  it("reverts when description is empty", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.appendRecord([0n, "service", "", ""], { account: owner.account }),
      revertsWith("EmptyField"),
    );
  });
});

describe("KarPassport — reportDiscrepancy", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("any address can report a discrepancy", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    await passport.write.reportDiscrepancy([0n, "scratches", "bafy2"], {
      account: stranger.account,
    });
    assert.equal(await passport.read.recordCount([0n]), 1n);
  });

  it("appended as recordType=discrepancy", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    const hash = await passport.write.reportDiscrepancy([0n, "issue", ""], {
      account: stranger.account,
    });
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    const appended = logs.find((l) => l.eventName === "RecordAppended");
    assert.ok(appended);
    assert.equal(appended.args.recordType, "discrepancy");
  });

  it("reverts when description is empty", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://r"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.reportDiscrepancy([0n, "", ""], { account: stranger.account }),
      revertsWith("EmptyField"),
    );
  });
});

describe("KarPassport — appendAttestation", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("KarProPass holder can append attestation", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://a"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.appendAttestation([0n, "inspected ok", "bafy3"], {
      account: verifier.account,
    });
    assert.equal(await passport.read.recordCount([0n]), 1n);
  });

  it("appended as recordType=attestation", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://a"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    const hash = await passport.write.appendAttestation([0n, "ok", ""], {
      account: verifier.account,
    });
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    const appended = logs.find((l) => l.eventName === "RecordAppended");
    assert.ok(appended);
    assert.equal(appended.args.recordType, "attestation");
  });

  it("reverts when caller has no KarProPass", async () => {
    const { viem } = connection;
    const { owner, stranger, passport } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://a"], {
      account: owner.account,
    });
    await assert.rejects(
      passport.write.appendAttestation([0n, "nope", ""], { account: stranger.account }),
      revertsWith("NotKarProHolder"),
    );
  });

  it("reverts when description is empty", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://a"], {
      account: owner.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await assert.rejects(
      passport.write.appendAttestation([0n, "", ""], { account: verifier.account }),
      revertsWith("EmptyField"),
    );
  });
});

describe("KarPassport — getPassportStatus", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("returns correct values after each state transition", async () => {
    const { viem } = connection;
    const { admin, owner, verifier, passport, proPass } = await deployPassportStack(viem);
    await passport.write.mintPassport([owner.account.address, "ipfs://s"], {
      account: owner.account,
    });

    let [status, verifierAddr, verifiedAt] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 0);
    assert.equal(getAddress(verifierAddr), getAddress(ZERO));
    assert.equal(verifiedAt, 0n);

    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    [status, verifierAddr, verifiedAt] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 1);
    assert.equal(getAddress(verifierAddr), getAddress(verifier.account.address));
    assert.ok(verifiedAt > 0n);

    await passport.write.disputePassport([0n, "vin mismatch"], { account: owner.account });
    [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 2);

    await passport.write.resolveDispute([0n, false], { account: verifier.account });
    [status, verifierAddr, verifiedAt] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 0);
    assert.equal(getAddress(verifierAddr), getAddress(ZERO));
    assert.equal(verifiedAt, 0n);
  });
});

describe("KarProPass — ownerMint", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("owner can mint to an address", async () => {
    const { viem } = connection;
    const [admin, holder] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.ownerMint([holder.account.address, "dealer", "Acme"], {
      account: admin.account,
    });
    assert.equal(await proPass.read.balanceOf([holder.account.address]), 1n);
  });

  it("stores category, name, issuedAt correctly", async () => {
    const { viem } = connection;
    const [admin, holder] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.ownerMint([holder.account.address, "inspector", "SafeCheck"], {
      account: admin.account,
    });
    const tokenId = BigInt(holder.account.address);
    assert.equal(await proPass.read.holderCategory([tokenId]), "inspector");
    assert.equal(await proPass.read.holderName([tokenId]), "SafeCheck");
    assert.ok((await proPass.read.issuedAt([tokenId])) > 0n);
  });

  it("tokenId equals uint256(uint160(holder))", async () => {
    const { viem } = connection;
    const [admin, holder] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.ownerMint([holder.account.address, "broker", "Co"], {
      account: admin.account,
    });
    const tokenId = BigInt(holder.account.address);
    assert.equal(getAddress(await proPass.read.ownerOf([tokenId])), getAddress(holder.account.address));
  });

  it("reverts when address already holds a pass", async () => {
    const { viem } = connection;
    const [admin, holder] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.ownerMint([holder.account.address, "a", "A"], { account: admin.account });
    await assert.rejects(
      proPass.write.ownerMint([holder.account.address, "b", "B"], { account: admin.account }),
      revertsWith("AlreadyHoldsPass"),
    );
  });
});

describe("KarProPass — ownerBurn", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("owner can burn a pass", async () => {
    const { viem } = connection;
    const [admin, holder] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.ownerMint([holder.account.address, "dealer", "Acme"], {
      account: admin.account,
    });
    await proPass.write.ownerBurn([holder.account.address], { account: admin.account });
    assert.equal(await proPass.read.balanceOf([holder.account.address]), 0n);
  });

  it("clears category, name, issuedAt", async () => {
    const { viem } = connection;
    const [admin, holder] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.ownerMint([holder.account.address, "dealer", "Acme"], {
      account: admin.account,
    });
    const tokenId = BigInt(holder.account.address);
    await proPass.write.ownerBurn([holder.account.address], { account: admin.account });
    assert.equal(await proPass.read.holderCategory([tokenId]), "");
    assert.equal(await proPass.read.holderName([tokenId]), "");
    assert.equal(await proPass.read.issuedAt([tokenId]), 0n);
  });

  it("reverts when address does not hold a pass", async () => {
    const { viem } = connection;
    const [admin, holder] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await assert.rejects(
      proPass.write.ownerBurn([holder.account.address], { account: admin.account }),
      revertsWith("DoesNotHoldPass"),
    );
  });
});

describe("KarProPass — soulbound enforcement", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("transfer between two non-zero addresses reverts", async () => {
    const { viem } = connection;
    const [admin, holder, other] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.ownerMint([holder.account.address, "broker", "Co"], {
      account: admin.account,
    });
    const tokenId = BigInt(holder.account.address);
    await assert.rejects(
      proPass.write.transferFrom([holder.account.address, other.account.address, tokenId], {
        account: holder.account,
      }),
      revertsWith("Soulbound"),
    );
  });

  it("approve reverts", async () => {
    const { viem } = connection;
    const [admin, holder, other] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.ownerMint([holder.account.address, "other", "Misc"], {
      account: admin.account,
    });
    const tokenId = BigInt(holder.account.address);
    await assert.rejects(
      proPass.write.approve([other.account.address, tokenId], { account: holder.account }),
      revertsWith("Soulbound"),
    );
  });

  it("setApprovalForAll reverts", async () => {
    const { viem } = connection;
    const [admin, holder, other] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.ownerMint([holder.account.address, "other", "Misc"], {
      account: admin.account,
    });
    await assert.rejects(
      proPass.write.setApprovalForAll([other.account.address, true], { account: holder.account }),
      revertsWith("Soulbound"),
    );
  });
});

describe("KarProPass — staking path", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("staking contract can mint via mint()", async () => {
    const { viem } = connection;
    const [admin, holder, stakingAccount] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.setStaking([stakingAccount.account.address], { account: admin.account });
    await proPass.write.mint([holder.account.address, "staking", "Auto"], {
      account: stakingAccount.account,
    });
    assert.equal(await proPass.read.balanceOf([holder.account.address]), 1n);
  });

  it("staking contract can burn via burn()", async () => {
    const { viem } = connection;
    const [admin, holder, stakingAccount] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.setStaking([stakingAccount.account.address], { account: admin.account });
    await proPass.write.mint([holder.account.address, "staking", "Auto"], {
      account: stakingAccount.account,
    });
    await proPass.write.burn([holder.account.address], { account: stakingAccount.account });
    assert.equal(await proPass.read.balanceOf([holder.account.address]), 0n);
  });

  it("non-staking address cannot call mint()", async () => {
    const { viem } = connection;
    const [admin, holder, stranger] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.setStaking([admin.account.address], { account: admin.account });
    await assert.rejects(
      proPass.write.mint([holder.account.address, "x", "X"], { account: stranger.account }),
      revertsWith("OnlyStaking"),
    );
  });

  it("non-staking address cannot call burn()", async () => {
    const { viem } = connection;
    const [admin, holder, stranger, stakingAccount] = await viem.getWalletClients();
    const proPass = await viem.deployContract("KarProPass", [admin.account.address]);
    await proPass.write.setStaking([stakingAccount.account.address], { account: admin.account });
    await proPass.write.mint([holder.account.address, "x", "X"], { account: stakingAccount.account });
    await assert.rejects(
      proPass.write.burn([holder.account.address], { account: stranger.account }),
      revertsWith("OnlyStaking"),
    );
  });
});

describe("MarketplaceEscrow — feeBps fix", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("platformFeeBps equals the value passed to constructor", async () => {
    const { viem } = connection;
    const { marketplace, feeBps } = await deployEscrowStack(viem);
    assert.equal(BigInt(await marketplace.read.platformFeeBps()), feeBps);
    assert.equal(BigInt(await marketplace.read.platformFeeBps()), 250n);
  });
});

describe("MarketplaceEscrow — list and delist", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("passport owner can list with USD price", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://list"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    const usd1e8 = 1000n * 10n ** 8n;
    await marketplace.write.list([0n, usd1e8, 0], { account: seller.account });
    const listing = await marketplace.read.listings([0n]);
    assert.equal(listing[3], true);
  });

  it("emits Listed event", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://list"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    const hash = await marketplace.write.list([0n, 500n * 10n ** 8n, 0], { account: seller.account });
    const logs = await receiptLogs(publicClient, hash, marketplace.abi);
    assert.ok(logs.some((l) => l.eventName === "Listed"));
  });

  it("seller can delist and recover NFT", async () => {
    const { viem } = connection;
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://x"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([0n, 200n * 10n ** 8n, 0], { account: seller.account });
    await marketplace.write.delist([0n], { account: seller.account });
    assert.equal(
      getAddress(await passport.read.ownerOf([0n])),
      getAddress(seller.account.address),
    );
  });

  it("emits Delisted event", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { seller, passport, marketplace } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://x"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([0n, 200n * 10n ** 8n, 0], { account: seller.account });
    const hash = await marketplace.write.delist([0n], { account: seller.account });
    const logs = await receiptLogs(publicClient, hash, marketplace.abi);
    assert.ok(logs.some((l) => l.eventName === "Delisted"));
  });
});

describe("MarketplaceEscrow — buyWithNative", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("buyer pays exact quote, NFT transfers, fee distributed", async () => {
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

  it("reverts when msg.value does not match quote", async () => {
    const { viem } = connection;
    const { seller, buyer, passport, marketplace } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://x"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([0n, 500n * 10n ** 8n, 0], { account: seller.account });
    const gross = await marketplace.read.quoteNativeWei([0n]);
    await assert.rejects(
      marketplace.write.buyWithNative([0n], { account: buyer.account, value: gross - 1n }),
      revertsWith("BadPrice"),
    );
  });

  it("reverts when listing is not active", async () => {
    const { viem } = connection;
    const { seller, buyer, passport, marketplace } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://x"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([0n, 100n * 10n ** 8n, 0], { account: seller.account });
    const gross = await marketplace.read.quoteNativeWei([0n]);
    await marketplace.write.delist([0n], { account: seller.account });
    await assert.rejects(
      marketplace.write.buyWithNative([0n], { account: buyer.account, value: gross }),
      revertsWith("NotActive"),
    );
  });
});

describe("MarketplaceEscrow — buyWithUsdc", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("buyWithUsdc pulls exact USDC quote", async () => {
    const { viem } = connection;
    const { seller, buyer, passport, usdc, marketplace } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://u"], {
      account: seller.account,
    });
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    const usd1e8 = 99n * 10n ** 8n;
    await marketplace.write.list([0n, usd1e8, 0], { account: seller.account });
    const need = await marketplace.read.quoteUsdcAmount([0n]);
    await usdc.write.mint([buyer.account.address, need * 2n]);
    await usdc.write.approve([marketplace.address, need], { account: buyer.account });
    await marketplace.write.buyWithUsdc([0n], { account: buyer.account });
    assert.equal(
      getAddress(await passport.read.ownerOf([0n])),
      getAddress(buyer.account.address),
    );
  });

  it("NFT transfers, fee distributed", async () => {
    const { viem } = connection;
    const { admin, seller, buyer, passport, usdc, marketplace, feeBps } = await deployEscrowStack(viem);
    await passport.write.mintPassport([seller.account.address, "ipfs://u2"], {
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
});

describe("MarketplaceEscrow — pro seller discount", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("seller holding KarProPass pays proFeeBps not platformFeeBps", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { admin, seller, buyer, passport, proPass, marketplace, feeBps, proFeeBps } =
      await deployEscrowStack(viem);
    await mintProPass(proPass, admin, seller.account.address, "dealer", "Pro Seller");
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
});

describe("MarketplaceEscrow — DISPUTED passport listing", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("a passport with DISPUTED status can still be listed", async () => {
    const { viem } = connection;
    const { admin, seller, passport, proPass, marketplace } = await deployEscrowStack(viem);
    const [, , , verifier] = await viem.getWalletClients();
    await passport.write.mintPassport([seller.account.address, "ipfs://disputed"], {
      account: seller.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await passport.write.disputePassport([0n, "issue"], { account: seller.account });
    const [status] = await passport.read.getPassportStatus([0n]);
    assert.equal(status, 2);
    await passport.write.setApprovalForAll([marketplace.address, true], {
      account: seller.account,
    });
    await marketplace.write.list([0n, 300n * 10n ** 8n, 0], { account: seller.account });
    const listing = await marketplace.read.listings([0n]);
    assert.equal(listing[3], true);
  });

  it("a DISPUTED listing can still be bought", async () => {
    const { viem } = connection;
    const { admin, seller, buyer, passport, proPass, marketplace } = await deployEscrowStack(viem);
    const [, , , verifier] = await viem.getWalletClients();
    await passport.write.mintPassport([seller.account.address, "ipfs://disputed-buy"], {
      account: seller.account,
    });
    await mintProPass(proPass, admin, verifier.account.address);
    await passport.write.verifyPassport([0n], { account: verifier.account });
    await passport.write.disputePassport([0n, "issue"], { account: seller.account });
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
});

describe("MarketplaceEscrow — upgrade authorization", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("upgrade attempt without timelock authority reverts", async () => {
    const { viem } = connection;
    const { seller, marketplace } = await deployEscrowStack(viem);
    const implementationV2 = await viem.deployContract("MarketplaceEscrow", [
      (await marketplace.read.karPassport([])) as `0x${string}`,
      (await marketplace.read.usdc([])) as `0x${string}`,
      (await marketplace.read.nativeUsdFeed([])) as `0x${string}`,
      ZERO,
      (await marketplace.read.karProPass([])) as `0x${string}`,
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
