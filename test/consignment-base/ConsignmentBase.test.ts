import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { fileURLToPath } from "node:url";
import { parseEther } from "viem";

import hardhat from "hardhat";
import { increaseTime, ZERO } from "../../scripts/lib/local-stack.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Connection = Awaited<ReturnType<typeof hardhat.network.connect>>;
type ViemSuite = Connection["viem"];
type WalletClient = Awaited<ReturnType<ViemSuite["getWalletClients"]>>[number];
type DeployedContract = Awaited<ReturnType<ViemSuite["deployContract"]>>;
type PublicClient = Awaited<ReturnType<ViemSuite["getPublicClient"]>>;

const EIP170_MAX = 24_576;
const PLATFORM_FEE_BPS = 250n; // 2.5%

function deployedBytecodeBytes(artifactPath: string, name: string): number {
  const abs = path.join(repoRoot, artifactPath);
  if (!existsSync(abs)) {
    assert.fail(`Missing artifact for ${name} at ${artifactPath}. Run "pnpm hardhat compile" first.`);
  }
  const artifact = JSON.parse(readFileSync(abs, "utf8")) as { deployedBytecode?: string };
  const hex = artifact.deployedBytecode;
  if (typeof hex !== "string" || !hex.startsWith("0x")) {
    assert.fail(`${name}: artifact missing deployedBytecode hex string`);
  }
  return (hex.length - 2) / 2;
}

{
  const harnessBytes = deployedBytecodeBytes(
    "artifacts/contracts/test/ConsignmentBaseHarness.sol/ConsignmentBaseHarness.json",
    "ConsignmentBaseHarness",
  );
  const abstractBase = deployedBytecodeBytes(
    "artifacts/contracts/lib/ConsignmentBase.sol/ConsignmentBase.json",
    "ConsignmentBase",
  );
  const headroom = EIP170_MAX - harnessBytes;

  process.stdout.write("\n--- ConsignmentBase assembled weight (Mandate+Recall+ClaimablePayouts; no BondedChallenge) ---\n");
  process.stdout.write("| Contract | bytes |\n| --- | --- |\n");
  process.stdout.write(`| ConsignmentBase (abstract) | ${abstractBase} |\n`);
  process.stdout.write(`| ConsignmentBaseHarness | ${harnessBytes} |\n`);
  process.stdout.write(`| EIP-170 limit | ${EIP170_MAX} |\n`);
  process.stdout.write(`| Headroom for a mode | ${headroom} |\n\n`);
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
const DENOM_FIAT_USD = {
  kind: 1,
  currencyCode: "0x5553440000000000000000000000000000000000000000000000000000000000",
} as const;
const COMP_MARGIN = { form: 0, commissionBps: 0 } as const;
const COMP_COMMISSION_500 = { form: 1, commissionBps: 500 } as const;

const FLOOR = 1_000_000n;
const PRICE = 2_000_000n;
const TOKEN = 1n;
const TOKEN_DIRECT = 2n;

describe("ConsignmentBase (N0–N4, O1, C1–C7, M1–M3, RC1)", () => {
  let connection: Connection;
  let viem: ViemSuite;
  let publicClient: PublicClient;

  let harness: DeployedContract;
  let owner: WalletClient;
  let agent: WalletClient;
  let platform: WalletClient;
  let stranger: WalletClient;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
    viem = connection.viem;
    publicClient = await viem.getPublicClient();
    const wallets = await viem.getWalletClients();
    [owner, agent, platform, stranger] = wallets;

    harness = await viem.deployContract("ConsignmentBaseHarness", []);
    await harness.write.initialize([
      platform.account.address,
      PLATFORM_FEE_BPS,
      owner.account.address,
      owner.account.address,
    ]);
    for (const id of [TOKEN, TOKEN_DIRECT]) {
      await harness.write.setPassportOwner([id, owner.account.address]);
      await harness.write.setEscrowApproved([id, true]);
      await harness.write.setMayOpen([id, true]);
    }
  });

  afterEach(async () => {
    await connection.close();
  });

  async function grantCommission(floor: bigint = FLOOR, expiry: bigint = 0n) {
    await harness.write.grant(
      [TOKEN, agent.account.address, expiry, ZERO, DENOM_ASSET, floor, COMP_COMMISSION_500],
      { account: owner.account },
    );
  }

  async function grantMargin(floor: bigint = FLOOR) {
    await harness.write.grant(
      [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, floor, COMP_MARGIN],
      { account: owner.account },
    );
  }

  async function openMandate(price: bigint = PRICE) {
    await harness.write.openFromMandate([TOKEN, DENOM_ASSET, price], { account: agent.account });
  }

  async function openDirect(price: bigint = PRICE) {
    await harness.write.openDirect([TOKEN_DIRECT, DENOM_ASSET, ZERO, price], {
      account: owner.account,
    });
  }

  it("declared ConsignmentBase errors are reachable", async () => {
    const badZeroRecipient = await viem.deployContract("ConsignmentBaseHarness", []);
    await assert.rejects(
      badZeroRecipient.write.initialize([
        ZERO,
        PLATFORM_FEE_BPS,
        owner.account.address,
        owner.account.address,
      ]),
      revertsWith("ZeroAddress"),
    );
    const badZeroGuardian = await viem.deployContract("ConsignmentBaseHarness", []);
    await assert.rejects(
      badZeroGuardian.write.initialize([
        platform.account.address,
        PLATFORM_FEE_BPS,
        owner.account.address,
        ZERO,
      ]),
      revertsWith("ZeroAddress"),
    );
    const badFee = await viem.deployContract("ConsignmentBaseHarness", []);
    await assert.rejects(
      badFee.write.initialize([
        platform.account.address,
        10_001n,
        owner.account.address,
        owner.account.address,
      ]),
      revertsWith("FeeTooHigh"),
    );

    await assert.rejects(
      harness.write.pause({ account: stranger.account }),
      revertsWith("NotGuardian"),
    );
    await assert.rejects(
      harness.write.requireGuardianOrOwner({ account: stranger.account }),
      revertsWith("NotGuardianOrOwner"),
    );
    await harness.write.pause({ account: owner.account }); // owner is also guardian in harness ctor
    await assert.rejects(openDirect(), revertsWith("ContractPaused"));
    await harness.write.unpause({ account: owner.account });

    await harness.write.setSelfEncumbranceRegistered([false]);
    await assert.rejects(openDirect(), revertsWith("ModeNotEncumbranceSource"));
    await harness.write.setSelfEncumbranceRegistered([true]);

    await harness.write.setMayOpen([TOKEN_DIRECT, false]);
    await assert.rejects(openDirect(), revertsWith("OpenConsignmentRefused"));
    await harness.write.setMayOpen([TOKEN_DIRECT, true]);

    await openDirect();
    await assert.rejects(
      harness.write.ownerWithdraw([TOKEN_DIRECT], { account: stranger.account }),
      revertsWith("NotConsignmentSeller"),
    );
    await harness.write.ownerWithdraw([TOKEN_DIRECT], { account: owner.account });

    await grantMargin();
    await openMandate();
    await assert.rejects(
      harness.write.ownerWithdraw([TOKEN], { account: owner.account }),
      revertsWith("NotDirectConsignment"),
    );
    await assert.rejects(
      harness.write.agentWithdraw([TOKEN], { account: stranger.account }),
      revertsWith("NotConsignmentAgent"),
    );
    await assert.rejects(
      harness.write.setPrice([TOKEN, PRICE + 1n], { account: stranger.account }),
      revertsWith("NotConsignmentRunner"),
    );
    await harness.write.enterCommittedNotOffered([TOKEN]);
    await assert.rejects(
      harness.write.requestRecall([TOKEN], { account: owner.account }),
      revertsWith("NotOfferedAgented"),
    );
    await assert.rejects(
      harness.write.setPrice([TOKEN, PRICE + 1n], { account: agent.account }),
      revertsWith("NotOffered"),
    );

    // BelowFloor via split (commission owner share < floor)
    await harness.write.setPassportOwner([3n, owner.account.address]);
    await harness.write.setEscrowApproved([3n, true]);
    await harness.write.setMayOpen([3n, true]);
    await harness.write.grant(
      [3n, agent.account.address, 0n, ZERO, DENOM_ASSET, FLOOR, COMP_COMMISSION_500],
      { account: owner.account },
    );
    // price that passes C6 at open: need ownerShare >= floor
    // S=2_000_000, P=2.5%=50_000, agent=5%=100_000, owner=1_850_000 >= 1_000_000 OK
    await harness.write.openFromMandate([3n, DENOM_ASSET, PRICE], { account: agent.account });
    await assert.rejects(
      harness.read.computeSplitPublic([1_050_000n, 3n]),
      revertsWith("BelowFloor"),
    );
  });

  // ---- Split matrix ----

  it("split: direct — platform share then owner remainder; floor slot inert", async () => {
    await openDirect();
    const settled = 1_000_000n;
    const expectedPlatform = (settled * PLATFORM_FEE_BPS) / 10_000n;
    const [p0, o0, a0] = (await harness.read.computeSplitPublic([
      settled,
      TOKEN_DIRECT,
    ])) as [bigint, bigint, bigint];
    assert.equal(p0, expectedPlatform);
    assert.equal(o0, settled - expectedPlatform);
    assert.equal(a0, 0n);

    // Poison unused floor storage to a value that would change / BelowFloor an agented margin split.
    const poison = settled;
    await harness.write.forceSetConsignmentFloor([TOKEN_DIRECT, poison]);
    assert.equal(await harness.read.consignmentFloorOf([TOKEN_DIRECT]), poison);

    const [p1, o1, a1] = (await harness.read.computeSplitPublic([
      settled,
      TOKEN_DIRECT,
    ])) as [bigint, bigint, bigint];
    assert.equal(p1, p0);
    assert.equal(o1, o0);
    assert.equal(a1, a0);
  });

  it("split: snapshotted platformFeeBps after live force (direct)", async () => {
    await openDirect();
    await harness.write.forceSetPlatformFeeBps([1000]);
    assert.equal(await harness.read.platformFeeBps(), 1000);
    const settled = 1_000_000n;
    const [platformCut, ownerCut, agentCut] = (await harness.read.computeSplitPublic([
      settled,
      TOKEN_DIRECT,
    ])) as [bigint, bigint, bigint];
    assert.equal(platformCut, 25_000n); // open fee 250 bps, not live 1000
    assert.equal(ownerCut, 975_000n);
    assert.equal(agentCut, 0n);
  });

  it("split: snapshotted platformFeeBps after live force (commission)", async () => {
    await grantCommission();
    await openMandate(PRICE);
    await harness.write.forceSetPlatformFeeBps([1000]);
    const settled = PRICE; // 2_000_000 — same as open (owner share must clear floor)
    const [platformCut, ownerCut, agentCut] = (await harness.read.computeSplitPublic([
      settled,
      TOKEN,
    ])) as [bigint, bigint, bigint];
    // open 250 bps snapshotted: platform ⌊S·250/B⌋; owner ⌊S·9250/B⌋; agent residual
    assert.equal(platformCut, 50_000n);
    assert.equal(agentCut, 100_000n);
    assert.equal(ownerCut, 1_850_000n);
  });

  it("split: snapshotted platformFeeBps after live force (margin)", async () => {
    await grantMargin(FLOOR);
    await openMandate(PRICE);
    await harness.write.forceSetPlatformFeeBps([1000]);
    const settled = PRICE;
    const [platformCut, ownerCut, agentCut] = (await harness.read.computeSplitPublic([
      settled,
      TOKEN,
    ])) as [bigint, bigint, bigint];
    assert.equal(platformCut, 50_000n);
    assert.equal(ownerCut, FLOOR);
    assert.equal(agentCut, settled - 50_000n - FLOOR);
  });

  it("direct setPrice does not apply floor / BelowFloor", async () => {
    await openDirect(PRICE);
    await harness.write.setPrice([TOKEN_DIRECT, 1n], { account: owner.account });
    assert.equal(await harness.read.consignmentPriceOf([TOKEN_DIRECT]), 1n);
  });

  it("open asks Intent.OpenConsignment via setMay (not a per-intent virtual)", async () => {
    // Intent.OpenConsignment = 1
    await harness.write.setMay([TOKEN_DIRECT, 1, false]);
    await assert.rejects(openDirect(), revertsWith("OpenConsignmentRefused"));
    await harness.write.setMay([TOKEN_DIRECT, 1, true]);
    await openDirect();
    assert.equal(await harness.read.consignmentPhase([TOKEN_DIRECT]), 1);
  });

  it("split: margin — floor is payout line; agent earns remainder", async () => {
    await grantMargin(FLOOR);
    await openMandate(PRICE);
    const settled = PRICE;
    const [platformAmt, ownerAmt, agentAmt] = (await harness.read.computeSplitPublic([
      settled,
      TOKEN,
    ])) as [bigint, bigint, bigint];
    const expectedPlatform = (settled * PLATFORM_FEE_BPS) / 10_000n;
    assert.equal(platformAmt, expectedPlatform);
    assert.equal(ownerAmt, FLOOR);
    assert.equal(agentAmt, settled - expectedPlatform - FLOOR);
    assert.ok(agentAmt > 0n);
  });

  it("split: margin boundary — agent earns nothing when remainder is zero", async () => {
    // afterPlatform == floor → agent 0
    // settled - platform = floor ⇒ settled = floor / (1 - fee) ; use settled such that afterPlatform == floor
    // platform = settled * 250 / 10000; settled - platform = floor
    // settled * (1 - 0.025) = floor ⇒ settled = floor * 10000 / 9750
    const floor = 975_000n;
    await grantMargin(floor);
    const settled = 1_000_000n; // platform=25000, after=975000 == floor
    await harness.write.openFromMandate([TOKEN, DENOM_ASSET, settled], { account: agent.account });
    const [platformAmt, ownerAmt, agentAmt] = (await harness.read.computeSplitPublic([
      settled,
      TOKEN,
    ])) as [bigint, bigint, bigint];
    assert.equal(platformAmt, 25_000n);
    assert.equal(ownerAmt, floor);
    assert.equal(agentAmt, 0n);
  });

  it("split: margin BelowFloor when after-platform < floor", async () => {
    await grantMargin(FLOOR);
    await openMandate(PRICE);
    await assert.rejects(
      harness.read.computeSplitPublic([FLOOR, TOKEN]), // after platform << floor
      revertsWith("BelowFloor"),
    );
  });

  it("split: commission — floor is constraint; owner keeps upside", async () => {
    await grantCommission(FLOOR);
    await openMandate(PRICE);
    const settled = PRICE;
    const [platformAmt, ownerAmt, agentAmt] = (await harness.read.computeSplitPublic([
      settled,
      TOKEN,
    ])) as [bigint, bigint, bigint];
    // Monotonic Commission: platform = ⌊S·p/B⌋ first; owner = ⌊S·(B−p−c)/B⌋; agent = residual.
    const expectedPlatform = (settled * PLATFORM_FEE_BPS) / 10_000n;
    const expectedOwner = (settled * (10_000n - PLATFORM_FEE_BPS - 500n)) / 10_000n;
    const expectedAgent = settled - expectedPlatform - expectedOwner;
    assert.equal(platformAmt, expectedPlatform);
    assert.equal(agentAmt, expectedAgent);
    assert.equal(ownerAmt, expectedOwner);
    // Proof floor is not a payout line: owner receives more than floor (upside).
    assert.ok(ownerAmt > FLOOR);
    // If margin math were wrongly applied, owner would get exactly FLOOR and agent the rest.
    assert.notEqual(ownerAmt, FLOOR);
  });

  it("split: commission BelowFloor when owner remainder < floor", async () => {
    await grantCommission(FLOOR);
    await openMandate(PRICE);
    // Small settled: owner share falls below floor
    await assert.rejects(
      harness.read.computeSplitPublic([1_050_000n, TOKEN]),
      revertsWith("BelowFloor"),
    );
  });

  it("paySplit routes native and closes", async () => {
    await openDirect(parseEther("1"));
    const settled = parseEther("1");
    const expectedPlatform = (settled * PLATFORM_FEE_BPS) / 10_000n;
    const expectedOwner = settled - expectedPlatform;
    const platformBefore = await publicClient.getBalance({ address: platform.account.address });
    const ownerBefore = await publicClient.getBalance({ address: owner.account.address });

    // Stranger funds the split so owner/platform deltas are not mixed with gas.
    await harness.write.paySplitPublic([TOKEN_DIRECT, settled], {
      account: stranger.account,
      value: settled,
    });

    assert.equal(await harness.read.consignmentPhase([TOKEN_DIRECT]), 2); // Closed
    const platformAfter = await publicClient.getBalance({ address: platform.account.address });
    const ownerAfter = await publicClient.getBalance({ address: owner.account.address });
    assert.equal(platformAfter - platformBefore, expectedPlatform);
    assert.equal(ownerAfter - ownerBefore, expectedOwner);
  });

  // ---- Opening × both authorisation forms ----

  describe("opening — direct form", () => {
    it("refuses when encumbrance denies (N3 via gate only)", async () => {
      await harness.write.setMayOpen([TOKEN_DIRECT, false]);
      await assert.rejects(openDirect(), revertsWith("OpenConsignmentRefused"));
    });

    it("refuses when escrow not approved", async () => {
      await harness.write.setEscrowApproved([TOKEN_DIRECT, false]);
      await assert.rejects(openDirect(), revertsWith("EscrowNotApproved"));
    });

    it("refuses when live", async () => {
      await openDirect();
      await assert.rejects(openDirect(), revertsWith("LiveConsignment"));
    });

    it("happy path snapshots seller and Offered", async () => {
      await openDirect();
      assert.equal(await harness.read.consignmentPhase([TOKEN_DIRECT]), 1); // Offered
      assert.equal(
        (await harness.read.consignmentSellerOf([TOKEN_DIRECT])).toLowerCase(),
        owner.account.address.toLowerCase(),
      );
      assert.equal(await harness.read.consignmentAgentOf([TOKEN_DIRECT]), ZERO);
      assert.equal(await harness.read.consignmentPriceOf([TOKEN_DIRECT]), PRICE);
      assert.equal(
        (await harness.read.custodyHolder([TOKEN_DIRECT])).toLowerCase(),
        harness.address.toLowerCase(),
      );
    });
  });

  describe("opening — mandate form", () => {
    it("refuses when encumbrance denies", async () => {
      await grantMargin();
      await harness.write.setMayOpen([TOKEN, false]);
      await assert.rejects(openMandate(), revertsWith("OpenConsignmentRefused"));
    });

    it("refuses when escrow not approved", async () => {
      await grantMargin();
      await harness.write.setEscrowApproved([TOKEN, false]);
      await assert.rejects(openMandate(), revertsWith("EscrowNotApproved"));
    });

    it("refuses when live", async () => {
      await grantMargin();
      await openMandate();
      await assert.rejects(openMandate(), revertsWith("LiveConsignment"));
    });

    it("refuses C6 when margin price leaves owner below floor", async () => {
      await grantMargin(FLOOR);
      // afterPlatform < floor
      await assert.rejects(
        harness.write.openFromMandate([TOKEN, DENOM_ASSET, FLOOR], { account: agent.account }),
        revertsWith("BelowFloor"),
      );
    });

    it("refuses C6 when commission price leaves owner below floor", async () => {
      await grantCommission(FLOOR);
      await assert.rejects(
        harness.write.openFromMandate([TOKEN, DENOM_ASSET, 1_050_000n], {
          account: agent.account,
        }),
        revertsWith("BelowFloor"),
      );
    });

    it("happy path copies mandate terms (M1)", async () => {
      await grantCommission(FLOOR);
      await openMandate();
      assert.equal(await harness.read.consignmentFloorOf([TOKEN]), FLOOR);
      assert.equal(await harness.read.consignmentCommissionBpsOf([TOKEN]), 500);
      assert.equal(await harness.read.consignmentCompensationFormOf([TOKEN]), 1);
      assert.equal(
        (await harness.read.consignmentAgentOf([TOKEN])).toLowerCase(),
        agent.account.address.toLowerCase(),
      );
    });

    it("refuses stranger openFromMandate", async () => {
      await grantMargin();
      await assert.rejects(
        harness.write.openFromMandate([TOKEN, DENOM_ASSET, PRICE], { account: stranger.account }),
        revertsWith("NotConsignmentAgent"),
      );
    });
  });

  it("M3: denomination mismatch refuses open; match succeeds", async () => {
    await grantMargin();
    await assert.rejects(
      harness.write.openFromMandate([TOKEN, DENOM_FIAT_USD, PRICE], { account: agent.account }),
      revertsWith("DenominationMismatch"),
    );
    await openMandate();
    assert.equal(await harness.read.consignmentPhase([TOKEN]), 1);
  });

  it("M1: snapshot independent of mandate expiry after open", async () => {
    await grantCommission(FLOOR);
    await openMandate();
    const floorBefore = await harness.read.consignmentFloorOf([TOKEN]);
    await harness.write.forceSetMandateExpiry([TOKEN, 1n]);
    assert.equal(await harness.read.consignmentFloorOf([TOKEN]), floorBefore);
    assert.equal(await harness.read.consignmentCommissionBpsOf([TOKEN]), 500);
    await assert.rejects(
      harness.write.revoke([TOKEN], { account: owner.account }),
      revertsWith("LiveConsignment"),
    );
  });

  it("M2: grant has no encumbrance gate; open asks encumbrance (N3)", async () => {
    await harness.write.setMayOpen([TOKEN, false]);
    await grantMargin(); // succeeds — M2
    await assert.rejects(openMandate(), revertsWith("OpenConsignmentRefused"));
  });

  // ---- Withdraw / O1 / Recall ----

  it("O1: direct ownerWithdraw returns to owner", async () => {
    await openDirect();
    await harness.write.ownerWithdraw([TOKEN_DIRECT], { account: owner.account });
    assert.equal(await harness.read.consignmentPhase([TOKEN_DIRECT]), 3); // Returned
    assert.equal(
      (await harness.read.custodyHolder([TOKEN_DIRECT])).toLowerCase(),
      owner.account.address.toLowerCase(),
    );
  });

  it("O1: agented owner cannot ownerWithdraw; agentWithdraw returns to owner", async () => {
    await grantMargin();
    await openMandate();
    await assert.rejects(
      harness.write.ownerWithdraw([TOKEN], { account: owner.account }),
      revertsWith("NotDirectConsignment"),
    );
    await harness.write.agentWithdraw([TOKEN], { account: agent.account });
    assert.equal(await harness.read.consignmentPhase([TOKEN]), 3);
    assert.equal(
      (await harness.read.custodyHolder([TOKEN])).toLowerCase(),
      owner.account.address.toLowerCase(),
    );
  });

  it("Recall: request, refuse force before cooldown, force after → Returned", async () => {
    await grantMargin();
    await openMandate();
    await harness.write.requestRecall([TOKEN], { account: owner.account });
    await assert.rejects(
      harness.write.forceRecall([TOKEN], { account: owner.account }),
      revertsWith("ReturnCooldownPending"),
    );
    await increaseTime(publicClient, 7n * 24n * 60n * 60n + 1n);
    await harness.write.forceRecall([TOKEN], { account: owner.account });
    assert.equal(await harness.read.consignmentPhase([TOKEN]), 3);
  });

  it("RC1: after enterCommittedNotOffered, recall unreachable; still live", async () => {
    await grantMargin();
    await openMandate();
    await harness.write.enterCommittedNotOffered([TOKEN]);
    await assert.rejects(
      harness.write.requestRecall([TOKEN], { account: owner.account }),
      revertsWith("NotOfferedAgented"),
    );
    await assert.rejects(
      harness.write.forceRecall([TOKEN], { account: owner.account }),
      revertsWith("NotOfferedAgented"),
    );
    await assert.rejects(
      harness.write.revoke([TOKEN], { account: owner.account }),
      revertsWith("LiveConsignment"),
    );
  });

  it("E5: base and harness sources do not read passportStatus for open permission", () => {
    const base = readFileSync(
      path.join(repoRoot, "contracts/lib/ConsignmentBase.sol"),
      "utf8",
    );
    const harnessSrc = readFileSync(
      path.join(repoRoot, "contracts/test/ConsignmentBaseHarness.sol"),
      "utf8",
    );
    for (const src of [base, harnessSrc]) {
      assert.ok(!src.includes("passportStatus"));
      assert.ok(!/\.status\s*\(/.test(src));
    }
    assert.ok(base.includes("IKarPassportEncumbrance.Intent.OpenConsignment"));
    assert.ok(base.includes("function _may("));
    assert.ok(!base.includes("_mayOpenConsignment"));
    assert.ok(harnessSrc.includes("mayPermit"));
  });

  describe("S32 monotonic Commission split", () => {
    const BPS = 10_000n;
    const TOKEN_S32 = 42n;

    function monoCommissionLegs(S: bigint, p: bigint, c: bigint) {
      const platform = (S * p) / BPS;
      const cut = p + c;
      const ownerAmt = cut >= BPS ? 0n : (S * (BPS - cut)) / BPS;
      const agent = S - platform - ownerAmt;
      return { platform, owner: ownerAmt, agent };
    }

    /** Pre-fix platform-first remainder (documented baseline; not on-chain). */
    function oldCommissionOwner(S: bigint, p: bigint, c: bigint) {
      const platform = (S * p) / BPS;
      const agent = (S * c) / BPS;
      return S - platform - agent;
    }

    async function prepareToken(tokenId: bigint) {
      await harness.write.setPassportOwner([tokenId, owner.account.address]);
      await harness.write.setEscrowApproved([tokenId, true]);
      await harness.write.setMayOpen([tokenId, true]);
    }

    async function openCommissionLot(opts: {
      tokenId: bigint;
      feeBps: number;
      commissionBps: number;
      floor: bigint;
      reserve: bigint;
    }) {
      await prepareToken(opts.tokenId);
      await harness.write.forceSetPlatformFeeBps([opts.feeBps]);
      const comp = { form: 1, commissionBps: opts.commissionBps } as const;
      await harness.write.grant(
        [opts.tokenId, agent.account.address, 0n, ZERO, DENOM_ASSET, opts.floor, comp],
        { account: owner.account },
      );
      await harness.write.openFromMandate([opts.tokenId, DENOM_ASSET, opts.reserve], {
        account: agent.account,
      });
    }

    it("documents old non-monotonic 999→1000; on-chain clears the danger band after legal open", async () => {
      const p = 10n;
      const c = 500n;
      // Old legs (platform-first remainder): owner(999)=950, owner(1000)=949 — non-monotonic.
      assert.equal(oldCommissionOwner(999n, p, c), 950n);
      assert.equal(oldCommissionOwner(1000n, p, c), 949n);
      assert.ok(oldCommissionOwner(1000n, p, c) < oldCommissionOwner(999n, p, c));

      // New math: owner(999)=948, owner(1000)=949 — monotonic; open at 999 with floor 950 fails.
      assert.equal(monoCommissionLegs(999n, p, c).owner, 948n);
      assert.equal(monoCommissionLegs(1000n, p, c).owner, 949n);
      await prepareToken(TOKEN_S32 + 1n);
      await harness.write.forceSetPlatformFeeBps([10]);
      await harness.write.grant(
        [
          TOKEN_S32 + 1n,
          agent.account.address,
          0n,
          ZERO,
          DENOM_ASSET,
          950n,
          { form: 1, commissionBps: 500 },
        ],
        { account: owner.account },
      );
      await assert.rejects(
        harness.write.openFromMandate([TOKEN_S32 + 1n, DENOM_ASSET, 999n], {
          account: agent.account,
        }),
        revertsWith("BelowFloor"),
      );

      // Open at the former danger amount with F = owner(R) under the new formula.
      const R = 1000n;
      const atR = monoCommissionLegs(R, p, c);
      await openCommissionLot({
        tokenId: TOKEN_S32,
        feeBps: 10,
        commissionBps: 500,
        floor: atR.owner,
        reserve: R,
      });

      for (const S of [R, R + 1n, 2_000n, 10_000n]) {
        const [platformAmt, ownerAmt, agentAmt] = (await harness.read.computeSplitPublic([
          S,
          TOKEN_S32,
        ])) as [bigint, bigint, bigint];
        const expected = monoCommissionLegs(S, p, c);
        assert.equal(platformAmt, expected.platform);
        assert.equal(ownerAmt, expected.owner);
        assert.equal(agentAmt, expected.agent);
        assert.ok(ownerAmt >= atR.owner);
        assert.equal(platformAmt + ownerAmt + agentAmt, S);
      }
    });

    it("matrix: after open, every tested S ≥ R clears floor; legs conserve; platform = ⌊S·p/B⌋", async () => {
      const cases: Array<{ feeBps: number; commissionBps: number; reserve: bigint }> = [
        { feeBps: 0, commissionBps: 500, reserve: 2_000n },
        { feeBps: 10, commissionBps: 500, reserve: 2_000n },
        { feeBps: 250, commissionBps: 500, reserve: 2_000_000n },
        { feeBps: 250, commissionBps: 10_000, reserve: 1_000_000n },
      ];

      for (const { feeBps, commissionBps, reserve } of cases) {
        const tokenId = 1_000n + BigInt(feeBps) * 100n + BigInt(commissionBps);
        await prepareToken(tokenId);
        await harness.write.forceSetPlatformFeeBps([feeBps]);
        const p = BigInt(feeBps);
        const c = BigInt(commissionBps);
        const atR = monoCommissionLegs(reserve, p, c);
        const floor = atR.owner;
        const comp = { form: 1, commissionBps } as const;
        await harness.write.grant(
          [tokenId, agent.account.address, 0n, ZERO, DENOM_ASSET, floor, comp],
          { account: owner.account },
        );
        await harness.write.openFromMandate([tokenId, DENOM_ASSET, reserve], {
          account: agent.account,
        });

        const spreads = [reserve, reserve + 1n, reserve + 7n, reserve * 2n, reserve * 10n + 3n];
        let prevOwner = -1n;
        for (const S of spreads) {
          const [platformAmt, ownerAmt, agentAmt] = (await harness.read.computeSplitPublic([
            S,
            tokenId,
          ])) as [bigint, bigint, bigint];
          const expected = monoCommissionLegs(S, p, c);
          assert.equal(platformAmt, expected.platform, `p=${feeBps} c=${commissionBps} S=${S}`);
          assert.equal(ownerAmt, expected.owner);
          assert.equal(agentAmt, expected.agent);
          assert.equal(platformAmt + ownerAmt + agentAmt, S);
          assert.ok(ownerAmt >= floor);
          assert.equal(platformAmt, (S * p) / BPS);
          if (prevOwner >= 0n) assert.ok(ownerAmt >= prevOwner);
          prevOwner = ownerAmt;
        }
      }
    });

    it("platform floored share survives commission at or above B − p", async () => {
      // Pre-S32 (platform + ⌊S·c/B⌋): c = B and p > 0 → BelowFloor. Interim residual-to-platform
      // completed the open with platform = 0. Final: platform stays ⌊S·p/B⌋; agent residual.
      const p = 250n;
      const cFull = BPS; // 100%
      const cSqueeze = BPS - p; // owner kept bps = 0
      const R = 1_000_000n;
      const flooredAtR = (R * p) / BPS;
      assert.ok(flooredAtR > 0n);

      // Document old refusal at 100% commission.
      const oldPlat = (R * p) / BPS;
      const oldAgent = (R * cFull) / BPS;
      assert.ok(R < oldPlat + oldAgent);

      for (const { commissionBps, tokenOffset } of [
        { commissionBps: Number(cFull), tokenOffset: 200n },
        { commissionBps: Number(cSqueeze), tokenOffset: 201n },
      ]) {
        const tokenId = TOKEN_S32 + tokenOffset;
        await prepareToken(tokenId);
        await harness.write.forceSetPlatformFeeBps([Number(p)]);
        const c = BigInt(commissionBps);
        const atR = monoCommissionLegs(R, p, c);
        assert.equal(atR.owner, 0n);
        assert.equal(atR.platform, flooredAtR);
        await harness.write.grant(
          [tokenId, agent.account.address, 0n, ZERO, DENOM_ASSET, 0n, { form: 1, commissionBps }],
          { account: owner.account },
        );
        await harness.write.openFromMandate([tokenId, DENOM_ASSET, R], {
          account: agent.account,
        });

        for (const S of [R, R + 1n, R * 2n, R * 10n + 3n]) {
          const [platformAmt, ownerAmt, agentAmt] = (await harness.read.computeSplitPublic([
            S,
            tokenId,
          ])) as [bigint, bigint, bigint];
          const expected = monoCommissionLegs(S, p, c);
          assert.equal(platformAmt, (S * p) / BPS);
          assert.ok(platformAmt > 0n);
          assert.equal(ownerAmt, 0n);
          assert.equal(agentAmt, S - platformAmt);
          assert.equal(platformAmt, expected.platform);
          assert.equal(agentAmt, expected.agent);
          assert.equal(platformAmt + ownerAmt + agentAmt, S);
        }
      }
    });

    it("Margin unchanged: owner = floor, platform = ⌊S·p/B⌋, agent residual", async () => {
      const tokenId = TOKEN_S32 + 99n;
      await prepareToken(tokenId);
      await harness.write.forceSetPlatformFeeBps([10]);
      const floor = 950n;
      await harness.write.grant(
        [tokenId, agent.account.address, 0n, ZERO, DENOM_ASSET, floor, COMP_MARGIN],
        { account: owner.account },
      );
      const R = 2000n;
      await harness.write.openFromMandate([tokenId, DENOM_ASSET, R], {
        account: agent.account,
      });
      for (const S of [R, R + 1n, 10_000n]) {
        const [platformAmt, ownerAmt, agentAmt] = (await harness.read.computeSplitPublic([
          S,
          tokenId,
        ])) as [bigint, bigint, bigint];
        const expectedPlatform = (S * 10n) / BPS;
        assert.equal(platformAmt, expectedPlatform);
        assert.equal(ownerAmt, floor);
        assert.equal(agentAmt, S - expectedPlatform - floor);
      }
    });
  });
});
