import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress, type Hash } from "viem";

import {
  DISPUTE_DEPOSIT,
  deployPassportStack,
  joinVerifier,
  mintPassport,
  receiptLogs,
  ZERO,
} from "../scripts/lib/local-stack.js";
import { DECLARED_PASSPORT_URI_CEILING_BYTES } from "../lib/web3/declared-uri-ceiling.js";

const TOKEN_ID_BASE = 31337n << 128n;
const FOREIGN_TOKEN_ID = (84532n << 128n) | 1n;

function ceilingUri(): string {
  return "a".repeat(DECLARED_PASSPORT_URI_CEILING_BYTES);
}

function overUri(): string {
  return "a".repeat(DECLARED_PASSPORT_URI_CEILING_BYTES + 1);
}

/** Custom-error selectors — used when the call goes through MockBridgeGateway (no passport errors on mock ABI). */
const ERROR_SELECTORS: Record<string, string> = {
  NotForeignToken: "0xa86e5896",
  NotHomeToken: "0xae825e88",
  TokenExists: "0x55c7e8ba",
  NotBridgeGateway: "0x17d13862",
  PassportBridgedAway: "0x97953a64",
  GatewayAlreadySet: "0x3c3a86d5",
  UriTooLong: "0xa99e90bb",
  EmptyField: "0x", // name-only match; EmptyField has a string arg
};

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    if (err.message.includes(errorName)) return true;
    const selector = ERROR_SELECTORS[errorName];
    return selector != null && selector !== "0x" && err.message.includes(selector);
  };
}

type NetworkConnection = Awaited<ReturnType<typeof hardhat.network.connect>>;
type ViemSuite = NetworkConnection["viem"];

async function deployWithGateway(viem: ViemSuite) {
  const stack = await deployPassportStack(viem);
  const gateway = await viem.deployContract("MockBridgeGateway", [stack.passport.address]);
  await stack.passport.write.setBridgeGateway([gateway.address], {
    account: stack.admin.account,
  });
  return { ...stack, gateway };
}

async function lockedHomeToken(
  viem: ViemSuite,
  opts: { verified?: boolean; disputed?: boolean } = {},
) {
  const stack = await deployWithGateway(viem);
  const tokenId = await mintPassport(
    stack.passport,
    stack.owner,
    stack.owner.account.address,
    "ar://home",
  );
  if (opts.verified || opts.disputed) {
    await joinVerifier(stack.staking, stack.verifier);
    await stack.passport.write.verifyPassport([tokenId], {
      account: stack.verifier.account,
    });
  }
  if (opts.disputed) {
    await stack.passport.write.open([tokenId], {
      account: stack.owner.account,
      value: DISPUTE_DEPOSIT,
    });
  }
  await stack.gateway.write.setCustodyLock([tokenId, true], {
    account: stack.admin.account,
  });
  return { ...stack, tokenId };
}

describe("KarPassport v1.3 — bridge gateway authority", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("Authority: setBridgeGateway binds once", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployPassportStack(viem);
    const gateway = await viem.deployContract("MockBridgeGateway", [stack.passport.address]);
    assert.equal(await stack.passport.read.bridgeGateway(), ZERO);
    const hash = await stack.passport.write.setBridgeGateway([gateway.address], {
      account: stack.admin.account,
    });
    const logs = await receiptLogs(publicClient, hash, stack.passport.abi);
    const ev = logs.find((l) => l.eventName === "BridgeGatewaySet");
    assert.ok(ev);
    assert.equal(getAddress(ev!.args.gateway as `0x${string}`), getAddress(gateway.address));
    assert.equal(
      getAddress(await stack.passport.read.bridgeGateway()),
      getAddress(gateway.address),
    );
  });

  it("ctor reverts ZeroAddress when karProStaking is zero", async () => {
    const { viem } = connection;
    const { admin } = await deployPassportStack(viem);
    await assert.rejects(
      viem.deployContract("KarPassport", [
        ZERO,
        admin.account.address,
        DISPUTE_DEPOSIT,
        admin.account.address,
      ]),
      revertsWith("ZeroAddress"),
    );
  });

  it("Authority: setBridgeGateway reverts ZeroAddress on zero", async () => {
    const { viem } = connection;
    const { admin, passport } = await deployPassportStack(viem);
    await assert.rejects(
      passport.write.setBridgeGateway([ZERO], { account: admin.account }),
      revertsWith("ZeroAddress"),
    );
  });

  it("Authority: setBridgeGateway second call reverts GatewayAlreadySet", async () => {
    const { viem } = connection;
    const stack = await deployWithGateway(viem);
    const other = await viem.deployContract("MockBridgeGateway", [stack.passport.address]);
    await assert.rejects(
      stack.passport.write.setBridgeGateway([other.address], {
        account: stack.admin.account,
      }),
      revertsWith("GatewayAlreadySet"),
    );
  });

  it("Authority: setBridgeGateway reverts for non-owner", async () => {
    const { viem } = connection;
    const stack = await deployPassportStack(viem);
    const gateway = await viem.deployContract("MockBridgeGateway", [stack.passport.address]);
    await assert.rejects(
      stack.passport.write.setBridgeGateway([gateway.address], {
        account: stack.owner.account,
      }),
      revertsWith("OwnableUnauthorizedAccount"),
    );
  });

  it("VERSION is 1.11.0-rc.1", async () => {
    const { viem } = connection;
    const { passport } = await deployPassportStack(viem);
    assert.equal(await passport.read.VERSION(), "1.11.0-rc.1");
  });
});

describe("KarPassport v1.3 — G6/G8 bridgeMint and bridgeBurn guards", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("G6: bridgeMint reverts NotForeignToken on local-origin id", async () => {
    const { viem } = connection;
    const { owner, gateway } = await deployWithGateway(viem);
    await assert.rejects(
      gateway.write.bridgeMint([owner.account.address, TOKEN_ID_BASE, "ar://x"], {
        account: owner.account,
      }),
      revertsWith("NotForeignToken"),
    );
  });

  it("G6: bridgeMint reverts TokenExists on existing id", async () => {
    const { viem } = connection;
    const { owner, gateway } = await deployWithGateway(viem);
    await gateway.write.bridgeMint([owner.account.address, FOREIGN_TOKEN_ID, "ar://a"], {
      account: owner.account,
    });
    await assert.rejects(
      gateway.write.bridgeMint([owner.account.address, FOREIGN_TOKEN_ID, "ar://b"], {
        account: owner.account,
      }),
      revertsWith("TokenExists"),
    );
  });

  it("G8: bridgeBurn reverts NotForeignToken on local-origin id", async () => {
    const { viem } = connection;
    const { owner, passport, gateway } = await deployWithGateway(viem);
    const tokenId = await mintPassport(passport, owner, owner.account.address, "ar://local");
    await assert.rejects(
      gateway.write.bridgeBurn([tokenId], { account: owner.account }),
      revertsWith("NotForeignToken"),
    );
  });

  it("G6/G8: bridgeMint and bridgeBurn revert NotBridgeGateway for non-gateway caller", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployWithGateway(viem);
    await assert.rejects(
      passport.write.bridgeMint([owner.account.address, FOREIGN_TOKEN_ID, "ar://x"], {
        account: owner.account,
      }),
      revertsWith("NotBridgeGateway"),
    );
    await assert.rejects(
      passport.write.bridgeBurn([FOREIGN_TOKEN_ID], { account: owner.account }),
      revertsWith("NotBridgeGateway"),
    );
  });

  it("G6: bridgeMint succeeds for foreign id and leaves nextTokenId unchanged", async () => {
    const { viem } = connection;
    const { owner, passport, gateway } = await deployWithGateway(viem);
    const before = (await passport.read.nextTokenId()) as bigint;
    await gateway.write.bridgeMint([owner.account.address, FOREIGN_TOKEN_ID, "ar://rep"], {
      account: owner.account,
    });
    assert.equal(await passport.read.nextTokenId(), before);
    assert.equal(
      getAddress(await passport.read.ownerOf([FOREIGN_TOKEN_ID])),
      getAddress(owner.account.address),
    );
    const [status] = await passport.read.getPassportStatus([FOREIGN_TOKEN_ID]);
    assert.equal(status, 0);
    assert.equal(await passport.read.tokenURI([FOREIGN_TOKEN_ID]), "ar://rep");
  });

  it("URI ceiling: bridgeMint accepts at ceiling and refuses one byte over", async () => {
    const { viem } = connection;
    const { owner, passport, gateway } = await deployWithGateway(viem);
    const at = ceilingUri();
    assert.equal(at.length, DECLARED_PASSPORT_URI_CEILING_BYTES);
    await gateway.write.bridgeMint([owner.account.address, FOREIGN_TOKEN_ID, at], {
      account: owner.account,
    });
    assert.equal(await passport.read.tokenURI([FOREIGN_TOKEN_ID]), at);

    const otherForeign = FOREIGN_TOKEN_ID + 1n;
    await assert.rejects(
      gateway.write.bridgeMint([owner.account.address, otherForeign, overUri()], {
        account: owner.account,
      }),
      revertsWith("UriTooLong"),
    );
  });

  it("G8: bridgeBurn burns foreign representation and clears trust fields", async () => {
    const { viem } = connection;
    const { owner, passport, gateway } = await deployWithGateway(viem);
    await gateway.write.bridgeMint([owner.account.address, FOREIGN_TOKEN_ID, "ar://rep"], {
      account: owner.account,
    });
    await gateway.write.bridgeBurn([FOREIGN_TOKEN_ID], { account: owner.account });
    await assert.rejects(
      passport.read.ownerOf([FOREIGN_TOKEN_ID]),
      revertsWith("ERC721NonexistentToken"),
    );
  });
});

describe("KarPassport v1.3 — G3 custody-lock freeze", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("G3: verifyPassport reverts PassportBridgedAway when custodyLocked", async () => {
    const { viem } = connection;
    const { verifier, staking, passport, tokenId } = await lockedHomeToken(viem);
    await joinVerifier(staking, verifier);
    await assert.rejects(
      passport.write.verifyPassport([tokenId], { account: verifier.account }),
      revertsWith("PassportBridgedAway"),
    );
  });

  it("G3: open reverts PassportBridgedAway when custodyLocked", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await lockedHomeToken(viem, { verified: true });
    await assert.rejects(
      passport.write.open([tokenId], {
        account: owner.account,
        value: DISPUTE_DEPOSIT,
      }),
      revertsWith("PassportBridgedAway"),
    );
  });

  it("G3: withdraw reverts PassportBridgedAway when custodyLocked", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await lockedHomeToken(viem, { disputed: true });
    await assert.rejects(
      passport.write.withdraw([tokenId], { account: owner.account }),
      revertsWith("PassportBridgedAway"),
    );
  });

  it("G3: judge reverts PassportBridgedAway when custodyLocked", async () => {
    const { viem } = connection;
    const { verifier, passport, tokenId } = await lockedHomeToken(viem, { disputed: true });
    await assert.rejects(
      passport.write.judge([tokenId, 1], { account: verifier.account }),
      revertsWith("PassportBridgedAway"),
    );
  });

  it("G3: reportDiscrepancy reverts PassportBridgedAway when custodyLocked", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await lockedHomeToken(viem);
    await assert.rejects(
      passport.write.reportDiscrepancy([tokenId, "note", ""], {
        account: owner.account,
      }),
      revertsWith("PassportBridgedAway"),
    );
  });

  it("G3: appendAttestation reverts PassportBridgedAway when custodyLocked", async () => {
    const { viem } = connection;
    const { verifier, staking, passport, tokenId } = await lockedHomeToken(viem);
    await joinVerifier(staking, verifier);
    await assert.rejects(
      passport.write.appendAttestation([tokenId, "ok", ""], {
        account: verifier.account,
      }),
      revertsWith("PassportBridgedAway"),
    );
  });

  it("G3: appendRecord reverts PassportBridgedAway when custodyLocked", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await lockedHomeToken(viem);
    await assert.rejects(
      passport.write.appendRecord([tokenId, "service", "oil", ""], {
        account: owner.account,
      }),
      revertsWith("PassportBridgedAway"),
    );
  });

  it("G3: setPassportURI reverts PassportBridgedAway when custodyLocked", async () => {
    const { viem } = connection;
    const { owner, passport, tokenId } = await lockedHomeToken(viem);
    await assert.rejects(
      passport.write.setPassportURI([tokenId, "ar://new"], {
        account: owner.account,
      }),
      revertsWith("PassportBridgedAway"),
    );
  });
});

describe("KarPassport v1.3 — G4/G5 bridgeResetOnUnlock", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("G4/G5: bridgeResetOnUnlock sets UNVERIFIED, clears verifier, updates URI, emits VerificationReset", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployWithGateway(viem);
    const tokenId = await mintPassport(
      stack.passport,
      stack.owner,
      stack.owner.account.address,
      "ar://home",
    );
    await joinVerifier(stack.staking, stack.verifier);
    await stack.passport.write.verifyPassport([tokenId], {
      account: stack.verifier.account,
    });
    let [status, verifier, verifiedAt] = await stack.passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 1);
    assert.notEqual(verifier, ZERO);
    assert.ok(verifiedAt > 0n);

    const hash = (await stack.gateway.write.bridgeResetOnUnlock([tokenId, "ar://returned"], {
      account: stack.admin.account,
    })) as Hash;
    const logs = await receiptLogs(publicClient, hash, stack.passport.abi);
    const reset = logs.find((l) => l.eventName === "VerificationReset");
    const uriUpdated = logs.find((l) => l.eventName === "PassportURIUpdated");
    assert.ok(reset);
    assert.equal(reset.args.tokenId, tokenId);
    assert.equal(getAddress(reset.args.author as string), getAddress(stack.gateway.address));
    assert.ok(uriUpdated);
    assert.equal(uriUpdated.args.newURI, "ar://returned");

    [status, verifier, verifiedAt] = await stack.passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 0);
    assert.equal(verifier, ZERO);
    assert.equal(verifiedAt, 0n);
    assert.equal(await stack.passport.read.tokenURI([tokenId]), "ar://returned");
  });

  it("URI ceiling: bridgeResetOnUnlock adopts at ceiling and refuses over", async () => {
    const { viem } = connection;
    const stack = await lockedHomeToken(viem, { verified: true });
    const at = ceilingUri();
    await stack.gateway.write.bridgeResetOnUnlock([stack.tokenId, at], {
      account: stack.admin.account,
    });
    assert.equal(await stack.passport.read.tokenURI([stack.tokenId]), at);

    const again = await lockedHomeToken(viem, { verified: true });
    await assert.rejects(
      again.gateway.write.bridgeResetOnUnlock([again.tokenId, overUri()], {
        account: again.admin.account,
      }),
      revertsWith("UriTooLong"),
    );
  });

  it("G5: bridgeResetOnUnlock with empty uri resets trust without PassportURIUpdated", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployWithGateway(viem);
    const tokenId = await mintPassport(
      stack.passport,
      stack.owner,
      stack.owner.account.address,
      "ar://home",
    );
    await joinVerifier(stack.staking, stack.verifier);
    await stack.passport.write.verifyPassport([tokenId], {
      account: stack.verifier.account,
    });

    const hash = (await stack.gateway.write.bridgeResetOnUnlock([tokenId, ""], {
      account: stack.admin.account,
    })) as Hash;
    const logs = await receiptLogs(publicClient, hash, stack.passport.abi);
    assert.ok(logs.some((l) => l.eventName === "VerificationReset"));
    assert.ok(!logs.some((l) => l.eventName === "PassportURIUpdated"));
    assert.equal(await stack.passport.read.tokenURI([tokenId]), "ar://home");
  });

  it("G5: bridgeResetOnUnlock with same uri emits VerificationReset only", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployWithGateway(viem);
    const tokenId = await mintPassport(
      stack.passport,
      stack.owner,
      stack.owner.account.address,
      "ar://home",
    );
    await joinVerifier(stack.staking, stack.verifier);
    await stack.passport.write.verifyPassport([tokenId], {
      account: stack.verifier.account,
    });

    const hash = (await stack.gateway.write.bridgeResetOnUnlock([tokenId, "ar://home"], {
      account: stack.admin.account,
    })) as Hash;
    const logs = await receiptLogs(publicClient, hash, stack.passport.abi);
    assert.ok(logs.some((l) => l.eventName === "VerificationReset"));
    assert.ok(!logs.some((l) => l.eventName === "PassportURIUpdated"));
  });

  it("Nuclear #4: unlock from UNVERIFIED does not emit VerificationReset", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployWithGateway(viem);
    const tokenId = await mintPassport(
      stack.passport,
      stack.owner,
      stack.owner.account.address,
      "ar://home",
    );
    assert.equal(await stack.passport.read.passportStatus([tokenId]), 0);

    const hash = (await stack.gateway.write.bridgeResetOnUnlock([tokenId, "ar://returned"], {
      account: stack.admin.account,
    })) as Hash;
    const logs = await receiptLogs(publicClient, hash, stack.passport.abi);
    assert.ok(!logs.some((l) => l.eventName === "VerificationReset"));
    assert.ok(logs.some((l) => l.eventName === "PassportURIUpdated"));
    assert.equal(await stack.passport.read.passportStatus([tokenId]), 0);
    assert.equal(await stack.passport.read.tokenURI([tokenId]), "ar://returned");
  });

  it("Authority: bridgeResetOnUnlock / setCustodyLock revert NotBridgeGateway for non-gateway", async () => {
    const { viem } = connection;
    const { owner, passport } = await deployWithGateway(viem);
    const tokenId = await mintPassport(passport, owner, owner.account.address, "ar://h");
    await assert.rejects(
      passport.write.bridgeResetOnUnlock([tokenId, "ar://x"], { account: owner.account }),
      revertsWith("NotBridgeGateway"),
    );
    await assert.rejects(
      passport.write.setCustodyLock([tokenId, true], { account: owner.account }),
      revertsWith("NotBridgeGateway"),
    );
  });

  it("NotHomeToken: setCustodyLock reverts on foreign-origin id", async () => {
    const { viem } = connection;
    const { owner, gateway } = await deployWithGateway(viem);
    await gateway.write.bridgeMint([owner.account.address, FOREIGN_TOKEN_ID, "ar://rep"], {
      account: owner.account,
    });
    await assert.rejects(
      gateway.write.setCustodyLock([FOREIGN_TOKEN_ID, true], { account: owner.account }),
      revertsWith("NotHomeToken"),
    );
  });

  it("NotHomeToken: bridgeResetOnUnlock reverts on foreign-origin id", async () => {
    const { viem } = connection;
    const { owner, gateway } = await deployWithGateway(viem);
    await gateway.write.bridgeMint([owner.account.address, FOREIGN_TOKEN_ID, "ar://rep"], {
      account: owner.account,
    });
    await assert.rejects(
      gateway.write.bridgeResetOnUnlock([FOREIGN_TOKEN_ID, "ar://x"], {
        account: owner.account,
      }),
      revertsWith("NotHomeToken"),
    );
  });

  it("bridgeResetOnUnlock clears custodyLocked and emits CustodyLockSet false", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const { passport, gateway, tokenId, admin } = await lockedHomeToken(viem, {
      verified: true,
    });
    assert.equal(await passport.read.custodyLocked([tokenId]), true);

    const hash = (await gateway.write.bridgeResetOnUnlock([tokenId, "ar://back"], {
      account: admin.account,
    })) as Hash;
    assert.equal(await passport.read.custodyLocked([tokenId]), false);
    const logs = await receiptLogs(publicClient, hash, passport.abi);
    assert.ok(
      logs.some(
        (l) =>
          l.eventName === "CustodyLockSet" &&
          l.args.tokenId === tokenId &&
          l.args.locked === false,
      ),
    );
    const [status] = await passport.read.getPassportStatus([tokenId]);
    assert.equal(status, 0);
  });
});

describe("KarPassport v1.3 — regression", () => {
  let connection: NetworkConnection;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("Regression: foreign bridgeMint does not perturb nextTokenId; native mint still works", async () => {
    const { viem } = connection;
    const { owner, passport, gateway } = await deployWithGateway(viem);
    const before = (await passport.read.nextTokenId()) as bigint;
    await gateway.write.bridgeMint([owner.account.address, FOREIGN_TOKEN_ID, "ar://f"], {
      account: owner.account,
    });
    assert.equal(await passport.read.nextTokenId(), before);
    const nativeId = await mintPassport(passport, owner, owner.account.address, "ar://n");
    assert.equal(nativeId, before);
    assert.equal(await passport.read.nextTokenId(), before + 1n);
    assert.equal(await passport.read.chainIdOf([nativeId]), 31337n);
  });

  it("Regression: mintPassport unaffected by custodyLocked of a different id", async () => {
    const { viem } = connection;
    const { owner, passport, gateway, tokenId: lockedId } = await lockedHomeToken(viem);
    assert.equal(await passport.read.custodyLocked([lockedId]), true);
    const next = await mintPassport(passport, owner, owner.account.address, "ar://other");
    assert.notEqual(next, lockedId);
    assert.equal(await passport.read.custodyLocked([next]), false);
    await passport.write.reportDiscrepancy([next, "ok", ""], { account: owner.account });
    assert.equal(await passport.read.recordCount([next]), 1n);
    void gateway;
  });

  it("setCustodyLock toggles custodyLocked and emits CustodyLockSet", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const stack = await deployWithGateway(viem);
    const tokenId = await mintPassport(
      stack.passport,
      stack.owner,
      stack.owner.account.address,
      "ar://h",
    );
    const lockHash = (await stack.gateway.write.setCustodyLock([tokenId, true], {
      account: stack.admin.account,
    })) as Hash;
    assert.equal(await stack.passport.read.custodyLocked([tokenId]), true);
    const lockLogs = await receiptLogs(publicClient, lockHash, stack.passport.abi);
    assert.ok(lockLogs.some((l) => l.eventName === "CustodyLockSet" && l.args.locked === true));

    await stack.gateway.write.setCustodyLock([tokenId, false], {
      account: stack.admin.account,
    });
    assert.equal(await stack.passport.read.custodyLocked([tokenId]), false);
  });
});
