import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { fileURLToPath } from "node:url";

import hardhat from "hardhat";
import { increaseTime, ZERO } from "../../scripts/lib/local-stack.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Connection = Awaited<ReturnType<typeof hardhat.network.connect>>;
type ViemSuite = Connection["viem"];
type WalletClient = Awaited<ReturnType<ViemSuite["getWalletClients"]>>[number];
type DeployedContract = Awaited<ReturnType<ViemSuite["deployContract"]>>;
type PublicClient = Awaited<ReturnType<ViemSuite["getPublicClient"]>>;

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

const BOND = 10n ** 15n; // 0.001 ETH
const WINDOW_V = 500n;
const WINDOW_S = 700n;
const ABANDONMENT_WINDOW = 600n;

// Print deployed sizes before registering describes (plan requirement).
{
  const rows = [
    { name: "BondedChallenge", artifactPath: "artifacts/contracts/lib/BondedChallenge.sol/BondedChallenge.json" },
    {
      name: "BondedChallengeInstanceVerificationHarness",
      artifactPath:
        "artifacts/contracts/test/BondedChallengeInstances.sol/BondedChallengeInstanceVerificationHarness.json",
    },
    {
      name: "BondedChallengeInstanceSettlementHarness",
      artifactPath:
        "artifacts/contracts/test/BondedChallengeInstances.sol/BondedChallengeInstanceSettlementHarness.json",
    },
  ] as const;

  process.stdout.write("\n--- BondedChallenge deployed bytecode sizes ---\n");
  process.stdout.write("| Contract | bytes |\n| --- | --- |\n");
  for (const row of rows) {
    const bytes = deployedBytecodeBytes(row.artifactPath, row.name);
    process.stdout.write(`| ${row.name} | ${bytes} |\n`);
  }
  process.stdout.write("\n");
}

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    if (err.message.includes(errorName)) return true;
    return false;
  };
}

describe("BondedChallenge (CH1–CH6)", () => {
  let connection: Connection;
  let viem: ViemSuite;
  let publicClient: PublicClient;
  let wallets: WalletClient[];

  let verification: DeployedContract;
  let settlement: DeployedContract;
  let rejectPlatform: DeployedContract;

  let admin: WalletClient;
  let vChallenger: WalletClient;
  let vNonChallenger: WalletClient;
  let vJudge: WalletClient;
  let vOwner: WalletClient;
  let vChallengedVerifier: WalletClient;

  let sBuyer: WalletClient;
  let sSeller: WalletClient;
  let sAgent: WalletClient;
  let sJudge: WalletClient;
  let stranger: WalletClient;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
    viem = connection.viem;
    publicClient = await viem.getPublicClient();
    wallets = await viem.getWalletClients();

    [
      admin,
      vChallenger,
      vNonChallenger,
      vJudge,
      vOwner,
      vChallengedVerifier,
      sBuyer,
      sSeller,
      sAgent,
      stranger,
    ] = wallets;

    rejectPlatform = await viem.deployContract("RejectETH", []);

    verification = await viem.deployContract("BondedChallengeInstanceVerificationHarness", [
      vOwner.account.address,
      vChallengedVerifier.account.address,
      rejectPlatform.address,
      BOND,
      WINDOW_V,
    ]);

    settlement = await viem.deployContract("BondedChallengeInstanceSettlementHarness", [
      sBuyer.account.address,
      sSeller.account.address,
      sAgent.account.address,
      rejectPlatform.address,
      BOND,
      WINDOW_S,
      ABANDONMENT_WINDOW,
    ]);

    sJudge = vJudge;
  });

  afterEach(async () => {
    await connection.close();
  });

  it("declared errors are reachable (WrongValue, NotEligibleChallenger, NoActiveDispute)", async () => {
    const subject = 1n;

    await assert.rejects(
      verification.write.withdraw([subject], { account: vChallenger.account }),
      revertsWith("NoActiveDispute"),
    );

    await assert.rejects(
      settlement.write.open([subject], { account: vNonChallenger.account, value: BOND }),
      revertsWith("NotEligibleChallenger"),
    );

    await assert.rejects(
      verification.write.open([subject], { account: vChallenger.account, value: BOND + 1n }),
      revertsWith("WrongValue"),
    );
  });

  it("configure: unconfigured open / zero args / one-shot", async () => {
    const unconfigured = await viem.deployContract("BondedChallengeUnconfiguredHarness", [BOND]);
    await assert.rejects(
      unconfigured.write.open([1n], { account: vChallenger.account, value: BOND }),
      revertsWith("ChallengeNotConfigured"),
    );
    await assert.rejects(
      unconfigured.write.configure([ZERO, WINDOW_V], { account: vOwner.account }),
      revertsWith("ZeroForfeitRecipient"),
    );
    await assert.rejects(
      unconfigured.write.configure([rejectPlatform.address, 0n], { account: vOwner.account }),
      revertsWith("ZeroChallengeWindow"),
    );
    await unconfigured.write.configure([rejectPlatform.address, WINDOW_V], {
      account: vOwner.account,
    });
    await assert.rejects(
      unconfigured.write.configure([rejectPlatform.address, WINDOW_V], { account: vOwner.account }),
      revertsWith("ChallengeAlreadyConfigured"),
    );
    await unconfigured.write.open([2n], { account: vChallenger.account, value: BOND });
  });

  it("judge qualification hook: NotQualifiedJudge before success when toggled", async () => {
    const subject = 50n;
    await verification.write.open([subject], { account: vChallenger.account, value: BOND });

    await verification.write.setQualifyAll([false]);
    await assert.rejects(
      verification.write.judge([subject, 1], { account: vJudge.account }),
      revertsWith("NotQualifiedJudge"),
    );

    // Exclusion still wins when the party is also unqualified.
    await assert.rejects(
      verification.write.judge([subject, 1], { account: vChallenger.account }),
      revertsWith("CannotResolveOwnDispute"),
    );

    await verification.write.setQualified([vJudge.account.address, true]);
    await verification.write.judge([subject, 1], { account: vJudge.account });
    assert.equal(await verification.read.challengeOpenedAt([subject]), 0n);
  });

  it("N0 subjectId key: open twice on same subject fails (DisputeActive)", async () => {
    const subject = 2n;
    await verification.write.open([subject], { account: vChallenger.account, value: BOND });
    await assert.rejects(
      verification.write.open([subject], { account: vNonChallenger.account, value: BOND }),
      revertsWith("DisputeActive"),
    );
  });

  it("CH1 phase matrix — verification instance", async () => {
    // Within window
    {
      const subject = 10n;
      await verification.write.open([subject], { account: vChallenger.account, value: BOND });

      // Challenger may withdraw.
      await verification.write.withdraw([subject], { account: vChallenger.account });
      assert.equal(
        await verification.read.passportStatus([subject]),
        1,
        "withdraw restores VERIFIED",
      );

      // Challenger may not judge.
      await verification.write.open([subject + 1n], { account: vChallenger.account, value: BOND });
      await assert.rejects(
        verification.write.judge([subject + 1n, 1], { account: vChallenger.account }),
        revertsWith("CannotResolveOwnDispute"),
      );
    }

    {
      const subjectUpheld = 20n;
      await verification.write.open([subjectUpheld], { account: vChallenger.account, value: BOND });
      await verification.write.judge([subjectUpheld, 0], { account: vJudge.account });
      assert.equal(await verification.read.passportStatus([subjectUpheld]), 0, "upheld -> UNVERIFIED");
      assert.equal(await verification.read.challengeOpenedAt([subjectUpheld]), 0n, "challenge cleared");
      await verification.write.open([subjectUpheld + 1n], { account: vChallenger.account, value: BOND });
      await verification.write.judge([subjectUpheld + 1n, 1], { account: vJudge.account });
      assert.equal(await verification.read.passportStatus([subjectUpheld + 1n]), 1, "rejected -> VERIFIED");
    }

    {
      const subject = 30n;
      await verification.write.open([subject], { account: vChallenger.account, value: BOND });
      await assert.rejects(
        verification.write.withdraw([subject], { account: vNonChallenger.account }),
        revertsWith("NotDisputeOpener"),
      );
      await assert.rejects(
        verification.write.conclude([subject], { account: stranger.account }),
        revertsWith("DisputeWindowActive"),
      );
    }

    // After window
    const after = 40n;
    await verification.write.open([after], { account: vChallenger.account, value: BOND });
    await increaseTime(publicClient, WINDOW_V + 1n);

    // Anyone can conclude.
    await verification.write.conclude([after], { account: stranger.account });
    assert.equal(await verification.read.passportStatus([after]), 0, "expired -> UNVERIFIED");

    // Challenger withdraw/judge after window revert.
    const subjectWithdraw = after + 1n;
    await verification.write.open([subjectWithdraw], { account: vChallenger.account, value: BOND });
    await increaseTime(publicClient, WINDOW_V + 1n);
    await assert.rejects(
      verification.write.withdraw([subjectWithdraw], { account: vChallenger.account }),
      revertsWith("DisputeWindowElapsed"),
    );

    const subjectJudge = subjectWithdraw + 1n;
    await verification.write.open([subjectJudge], { account: vChallenger.account, value: BOND });
    await increaseTime(publicClient, WINDOW_V + 1n);
    await assert.rejects(
      verification.write.judge([subjectJudge, 0], { account: vJudge.account }),
      revertsWith("DisputeWindowElapsed"),
    );
  });

  it("CH1 phase matrix — settlement instance", async () => {
    // Within window
    {
      const subject = 100n;
      await settlement.write.open([subject], { account: sBuyer.account, value: BOND });
      const openedAt = await settlement.read.challengeOpenedAt([subject]);
      const window = await settlement.read.challengeWindowDuration([subject]);

      // Mid-window withdraw restores captured end.
      await increaseTime(publicClient, 100n);
      await settlement.write.withdraw([subject], { account: sBuyer.account });
      assert.equal(await settlement.read.protectionEndsAt([subject]), openedAt + window);

      // Challenger may not judge.
      await settlement.write.open([subject + 1n], { account: sBuyer.account, value: BOND });
      await assert.rejects(
        settlement.write.judge([subject + 1n, 1], { account: sBuyer.account }),
        revertsWith("CannotResolveOwnDispute"),
      );

      // Non-challenger may not withdraw.
      await settlement.write.open([subject + 2n], { account: sBuyer.account, value: BOND });
      await assert.rejects(
        settlement.write.withdraw([subject + 2n], { account: sSeller.account }),
        revertsWith("NotDisputeOpener"),
      );

      // Conclude within window reverts.
      await settlement.write.open([subject + 3n], { account: sBuyer.account, value: BOND });
      await assert.rejects(
        settlement.write.conclude([subject + 3n], { account: stranger.account }),
        revertsWith("DisputeWindowActive"),
      );
    }

    {
      const subjectUpheld = 110n;
      await settlement.write.open([subjectUpheld], { account: sBuyer.account, value: BOND });
      await settlement.write.judge([subjectUpheld, 0], { account: sJudge.account });
      assert.equal(await settlement.read.reversalPending([subjectUpheld]), true, "upheld -> reversal pending");

      const subjectRejected = subjectUpheld + 1n;
      await settlement.write.open([subjectRejected], { account: sBuyer.account, value: BOND });
      await settlement.write.judge([subjectRejected, 1], { account: sJudge.account });
      assert.equal(await settlement.read.sellerPaid([subjectRejected]), true, "rejected -> seller paid");
    }

    // After window
    {
      const subject = 120n;
      await settlement.write.open([subject], { account: sBuyer.account, value: BOND });
      await increaseTime(publicClient, WINDOW_S + 1n);
      await settlement.write.conclude([subject], { account: stranger.account });
      assert.equal(await settlement.read.sellerPaid([subject]), true, "expired -> seller paid");

      const subjectWithdraw = subject + 1n;
      await settlement.write.open([subjectWithdraw], { account: sBuyer.account, value: BOND });
      await increaseTime(publicClient, WINDOW_S + 1n);
      await assert.rejects(
        settlement.write.withdraw([subjectWithdraw], { account: sBuyer.account }),
        revertsWith("DisputeWindowElapsed"),
      );

      const subjectJudge = subjectWithdraw + 1n;
      await settlement.write.open([subjectJudge], { account: sBuyer.account, value: BOND });
      await increaseTime(publicClient, WINDOW_S + 1n);
      await assert.rejects(
        settlement.write.judge([subjectJudge, 0], { account: sJudge.account }),
        revertsWith("DisputeWindowElapsed"),
      );
    }
  });

  it("Ordering obligation: handler sees routed bond + cleared state before reverting (no stranded bond)", async () => {
    const subject = 200n;
    await verification.write.setCheckOrdering([true]);
    await verification.write.setRevertTerminal([1, true]); // TerminalKind.Rejected

    await verification.write.open([subject], { account: vChallenger.account, value: BOND });

    // Rejected outcome routes bond to forfeitRecipient (rejectPlatform), which fails native push -> pending claim exists.
    await assert.rejects(
      verification.write.judge([subject, 1], { account: vJudge.account }),
      revertsWith("HandlerReverted"),
    );

    // Revert must not strand the bond: challenge remains active and no claim persists.
    assert.ok((await verification.read.challengeOpenedAt([subject])) > 0n);
    assert.equal(await verification.read.pendingClaims([rejectPlatform.address, ZERO]), 0n);
  });

  it("CH2: bond never reaches the judge (CannotRouteBondToJudge) — settlement misconfiguration", async () => {
    const subject = 300n;

    // Deploy a second settlement instance misconfigured so forfeitRecipient == judge caller.
    const rejectJudge = await viem.deployContract("RejectETH", []);
    const misconfiguredSettlement = await viem.deployContract(
      "BondedChallengeInstanceSettlementHarness",
      [
        sBuyer.account.address,
        sSeller.account.address,
        sAgent.account.address,
        rejectJudge.address,
        BOND,
        WINDOW_S,
        ABANDONMENT_WINDOW,
      ],
    );

    await misconfiguredSettlement.write.open([subject], { account: sBuyer.account, value: BOND });

    // Judge caller is the RejectETH contract itself.
    await assert.rejects(
      rejectJudge.write.callJudge([misconfiguredSettlement.address, subject, 1], { account: admin.account }),
      revertsWith("CannotRouteBondToJudge"),
    );

    assert.ok((await misconfiguredSettlement.read.challengeOpenedAt([subject])) > 0n);
    assert.equal(await misconfiguredSettlement.read.pendingClaims([rejectJudge.address, ZERO]), 0n);
  });

  it("CH3 + CH5: expiry resolves against the burden-bearer and can be concluded permissionlessly", async () => {
    const subjectV = 400n;
    await verification.write.open([subjectV], { account: vChallenger.account, value: BOND });
    await increaseTime(publicClient, WINDOW_V + 1n);
    await verification.write.conclude([subjectV], { account: stranger.account });
    assert.equal(await verification.read.passportStatus([subjectV]), 0, "verification expired -> UNVERIFIED");

    const subjectS = subjectV + 1n;
    await settlement.write.open([subjectS], { account: sBuyer.account, value: BOND });
    await increaseTime(publicClient, WINDOW_S + 1n);
    await settlement.write.conclude([subjectS], { account: stranger.account });
    assert.equal(await settlement.read.sellerPaid([subjectS]), true, "settlement expired -> seller paid");
  });

  it("CH4 + captured-window observation: withdrawal restores what was suspended", async () => {
    // Verification withdraw restores VERIFIED.
    const subjectV = 500n;
    await verification.write.open([subjectV], { account: vChallenger.account, value: BOND });
    await increaseTime(publicClient, 100n);
    await verification.write.withdraw([subjectV], { account: vChallenger.account });
    assert.equal(await verification.read.passportStatus([subjectV]), 1, "verification withdraw -> VERIFIED");

    // Settlement withdraw restores protection end using captured openedAt + captured window.
    const subjectS = subjectV + 1n;
    await settlement.write.open([subjectS], { account: sBuyer.account, value: BOND });
    const openedAt = await settlement.read.challengeOpenedAt([subjectS]);
    const window = await settlement.read.challengeWindowDuration([subjectS]);

    await increaseTime(publicClient, 200n);
    await settlement.write.withdraw([subjectS], { account: sBuyer.account });
    assert.equal(await settlement.read.protectionEndsAt([subjectS]), openedAt + window);
  });

  it("CH6: settlement upheld reversal sets abandonment deadline usable after BondedChallenge state is cleared", async () => {
    const subject = 600n;
    await settlement.write.open([subject], { account: sBuyer.account, value: BOND });

    await settlement.write.judge([subject, 0], { account: sJudge.account }); // Upheld
    assert.equal(await settlement.read.challengeOpenedAt([subject]), 0n, "bonded challenge cleared on uphold");
    assert.equal(await settlement.read.reversalPending([subject]), true);

    const abandonmentAt = await settlement.read.abandonmentDeadline([subject]);
    await increaseTime(publicClient, ABANDONMENT_WINDOW + 1n);

    await settlement.write.abandonReversal([subject], { account: stranger.account });
    assert.equal(await settlement.read.sellerPaid([subject]), true, "abandonment pays seller after deadline");
    assert.equal(await settlement.read.reversalPending([subject]), false);

    // Sanity: second-stage does not depend on library challenge state anymore.
    assert.equal(await settlement.read.challengeOpenedAt([subject]), 0n);
    assert.ok(abandonmentAt > 0n);
  });
});

