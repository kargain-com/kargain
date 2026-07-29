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

const EIP170_MAX = 24_576;

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

// Print deployed sizes before registering describes (plan requirement).
{
  const rows = [
    { name: "Mandate", artifactPath: "artifacts/contracts/lib/Mandate.sol/Mandate.json" },
    { name: "Recall", artifactPath: "artifacts/contracts/lib/Recall.sol/Recall.json" },
    {
      name: "MandateRecallHarness",
      artifactPath: "artifacts/contracts/test/MandateRecallHarness.sol/MandateRecallHarness.json",
    },
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

  process.stdout.write("\n--- Mandate / Recall deployed bytecode sizes ---\n");
  process.stdout.write("| Contract | bytes |\n| --- | --- |\n");
  let running = 0;
  for (const row of rows) {
    const bytes = deployedBytecodeBytes(row.artifactPath, row.name);
    running += bytes;
    process.stdout.write(`| ${row.name} | ${bytes} |\n`);
  }
  process.stdout.write(`| running total (harnesses) | ${running} |\n`);
  process.stdout.write(`| EIP-170 limit | ${EIP170_MAX} |\n\n`);
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
const TOKEN = 1n;

describe("Mandate + Recall (M1–M3, C1–C5, RC1)", () => {
  let connection: Connection;
  let viem: ViemSuite;
  let publicClient: PublicClient;

  let harness: DeployedContract;
  let owner: WalletClient;
  let agent: WalletClient;
  let stranger: WalletClient;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
    viem = connection.viem;
    publicClient = await viem.getPublicClient();
    const wallets = await viem.getWalletClients();
    [owner, agent, stranger] = wallets;

    harness = await viem.deployContract("MandateRecallHarness", []);
    await harness.write.setPassportOwner([TOKEN, owner.account.address]);
    await harness.write.setEscrowApproved([TOKEN, true]);
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

  async function openAsset() {
    await harness.write.openFromMandate([TOKEN, DENOM_ASSET], { account: owner.account });
  }

  it("declared Mandate errors are reachable", async () => {
    await assert.rejects(
      harness.write.grant(
        [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, FLOOR, COMP_MARGIN],
        { account: stranger.account },
      ),
      revertsWith("NotPassportOwner"),
    );

    await harness.write.setEscrowApproved([TOKEN, false]);
    await assert.rejects(
      harness.write.grant(
        [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, FLOOR, COMP_MARGIN],
        { account: owner.account },
      ),
      revertsWith("EscrowNotApproved"),
    );
    await harness.write.setEscrowApproved([TOKEN, true]);

    await assert.rejects(
      harness.write.grant(
        [TOKEN, ZERO, 0n, ZERO, DENOM_ASSET, FLOOR, COMP_MARGIN],
        { account: owner.account },
      ),
      revertsWith("ZeroAddress"),
    );

    await assert.rejects(
      harness.write.revoke([TOKEN], { account: owner.account }),
      revertsWith("NoMandate"),
    );

    await assert.rejects(
      harness.write.lowerFloor([TOKEN, FLOOR - 1n], { account: owner.account }),
      revertsWith("NoLiveConsignment"),
    );
  });

  it("M2: grant has no subject/verification gate and is not an open", async () => {
    await grantCommission();
    assert.equal(await harness.read.mandateActive([TOKEN]), true);
    assert.equal(await harness.read.phase([TOKEN]), 0); // None
  });

  it("Grant/Revoke fail while live and succeed when idle", async () => {
    await grantCommission();
    await openAsset();

    await assert.rejects(
      harness.write.grant(
        [TOKEN, agent.account.address, 0n, ZERO, DENOM_ASSET, FLOOR, COMP_COMMISSION_500],
        { account: owner.account },
      ),
      revertsWith("LiveConsignment"),
    );
    await assert.rejects(
      harness.write.revoke([TOKEN], { account: owner.account }),
      revertsWith("LiveConsignment"),
    );

    await harness.write.agentWithdraw([TOKEN], { account: agent.account });
    await harness.write.revoke([TOKEN], { account: owner.account });
    assert.equal(await harness.read.mandateActive([TOKEN]), false);
  });

  it("M3: denomination mismatch refuses open; match succeeds", async () => {
    await grantCommission();
    await assert.rejects(
      harness.write.openFromMandate([TOKEN, DENOM_FIAT_USD], { account: owner.account }),
      revertsWith("DenominationMismatch"),
    );
    await openAsset();
    assert.equal(await harness.read.phase([TOKEN]), 1); // Offered
    assert.equal(await harness.read.snapshotFloorPublic([TOKEN]), FLOOR);
  });

  it("M1: snapshot is independent of mandate expiry after open", async () => {
    const farExpiry = BigInt(Math.floor(Date.now() / 1000) + 10_000);
    await grantCommission(FLOOR, farExpiry);
    await openAsset();

    const snapFloor = await harness.read.snapshotFloorPublic([TOKEN]);
    const snapBps = await harness.read.snapshotCommissionBpsPublic([TOKEN]);

    // Expire the standing mandate while the sale is live.
    await harness.write.forceSetMandateExpiry([TOKEN, 1n]);
    assert.equal(await harness.read.mandateExpiry([TOKEN]), 1n);

    assert.equal(await harness.read.snapshotFloorPublic([TOKEN]), snapFloor);
    assert.equal(await harness.read.snapshotCommissionBpsPublic([TOKEN]), snapBps);
    assert.equal(await harness.read.phase([TOKEN]), 1);

    // Opening a second consignment after return would see MandateExpired.
    await harness.write.agentWithdraw([TOKEN], { account: agent.account });
    await assert.rejects(
      harness.write.openFromMandate([TOKEN, DENOM_ASSET], { account: owner.account }),
      revertsWith("MandateExpired"),
    );
  });

  it("C1: lower floor reaches snapshot only; raise refused; mandate floor unchanged", async () => {
    await grantCommission();
    await openAsset();
    const mandateFloorBefore = await harness.read.mandateFloor([TOKEN]);

    await harness.write.lowerFloor([TOKEN, FLOOR - 100n], { account: owner.account });
    assert.equal(await harness.read.snapshotFloorPublic([TOKEN]), FLOOR - 100n);
    assert.equal(await harness.read.mandateFloor([TOKEN]), mandateFloorBefore);

    await assert.rejects(
      harness.write.lowerFloor([TOKEN, FLOOR], { account: owner.account }),
      revertsWith("CannotRaiseFloor"),
    );
    await assert.rejects(
      harness.write.lowerFloor([TOKEN, FLOOR - 100n], { account: owner.account }),
      revertsWith("CannotRaiseFloor"),
    );
    await assert.rejects(
      harness.write.lowerFloor([TOKEN, FLOOR - 200n], { account: stranger.account }),
      revertsWith("NotPassportOwner"),
    );
  });

  it("C2: lower commission reaches snapshot only; raise refused; margin form reverts", async () => {
    await grantCommission();
    await openAsset();
    const mandateBps = await harness.read.mandateCommissionBps([TOKEN]);

    await harness.write.lowerCommission([TOKEN, 400], { account: agent.account });
    assert.equal(await harness.read.snapshotCommissionBpsPublic([TOKEN]), 400);
    assert.equal(await harness.read.mandateCommissionBps([TOKEN]), mandateBps);

    await assert.rejects(
      harness.write.lowerCommission([TOKEN, 500], { account: agent.account }),
      revertsWith("CannotRaiseCommission"),
    );
    await assert.rejects(
      harness.write.lowerCommission([TOKEN, 300], { account: owner.account }),
      revertsWith("NotConsignmentAgent"),
    );

    // Margin form: no commission object.
    await harness.write.agentWithdraw([TOKEN], { account: agent.account });
    await harness.write.revoke([TOKEN], { account: owner.account });
    await grantMargin();
    await openAsset();
    await assert.rejects(
      harness.write.lowerCommission([TOKEN, 0], { account: agent.account }),
      revertsWith("NotCommissionForm"),
    );
  });

  it("C5: higher floor has no path — only lower on snapshot; new mandate needed for raise", async () => {
    await grantCommission();
    await openAsset();
    await assert.rejects(
      harness.write.lowerFloor([TOKEN, FLOOR + 1n], { account: owner.account }),
      revertsWith("CannotRaiseFloor"),
    );
  });

  it("Recall: request, refuse force before cooldown, force after, agent withdraw parallel", async () => {
    await grantCommission();
    await openAsset();

    await assert.rejects(
      harness.write.forceRecall([TOKEN], { account: owner.account }),
      revertsWith("ReturnNotRequested"),
    );

    await harness.write.requestRecall([TOKEN], { account: owner.account });
    await assert.rejects(
      harness.write.requestRecall([TOKEN], { account: owner.account }),
      revertsWith("ReturnAlreadyRequested"),
    );
    await assert.rejects(
      harness.write.forceRecall([TOKEN], { account: owner.account }),
      revertsWith("ReturnCooldownPending"),
    );

    const cooldown = (await harness.read.recallCooldown()) as bigint;
    await increaseTime(publicClient, cooldown + 1n);
    await harness.write.forceRecall([TOKEN], { account: owner.account });
    assert.equal(await harness.read.phase([TOKEN]), 3); // Returned
    assert.equal(await harness.read.recallRequestTimestamp([TOKEN]), 0n);

    // Agent withdraw during cooldown reaches the same destination.
    await grantCommission();
    await openAsset();
    await harness.write.requestRecall([TOKEN], { account: owner.account });
    await harness.write.agentWithdraw([TOKEN], { account: agent.account });
    assert.equal(await harness.read.phase([TOKEN]), 3);
    assert.equal(await harness.read.recallRequestTimestamp([TOKEN]), 0n);
  });

  it("RC1: recall is absent after BINDING", async () => {
    await grantCommission();
    await openAsset();
    await harness.write.enterBinding([TOKEN], { account: owner.account });
    assert.equal(await harness.read.phase([TOKEN]), 2); // Binding

    await assert.rejects(
      harness.write.requestRecall([TOKEN], { account: owner.account }),
      revertsWith("NotOfferedAgented"),
    );
    await assert.rejects(
      harness.write.forceRecall([TOKEN], { account: owner.account }),
      revertsWith("NotOfferedAgented"),
    );
  });

  it("Recall: stranger cannot request; NotConsignmentSeller", async () => {
    await grantCommission();
    await openAsset();
    await assert.rejects(
      harness.write.requestRecall([TOKEN], { account: stranger.account }),
      revertsWith("NotConsignmentSeller"),
    );
  });
});
