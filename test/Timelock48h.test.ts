import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress, keccak256, toBytes, toHex } from "viem";

describe("Timelock48h", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("MIN_DELAY_SECONDS is 48 hours", async () => {
    const { viem } = connection;
    const [admin] = await viem.getWalletClients();
    const timelock = await viem.deployContract("Timelock48h", [
      [admin.account.address],
      [admin.account.address],
      admin.account.address,
    ]);
    assert.equal(await timelock.read.MIN_DELAY_SECONDS(), 48n * 3600n);
  });

  it("getMinDelay matches MIN_DELAY_SECONDS", async () => {
    const { viem } = connection;
    const [admin] = await viem.getWalletClients();
    const timelock = await viem.deployContract("Timelock48h", [
      [admin.account.address],
      [admin.account.address],
      admin.account.address,
    ]);
    assert.equal(await timelock.read.getMinDelay(), 48n * 3600n);
  });

  it("proposer can schedule and execute after delay", async () => {
    const { viem, networkHelpers } = connection;
    const publicClient = await viem.getPublicClient();
    const [admin, recipient] = await viem.getWalletClients();

    const timelock = await viem.deployContract("Timelock48h", [
      [admin.account.address],
      [admin.account.address],
      admin.account.address,
    ]);

    const value = 1_000_000_000_000_000n;
    const target = recipient.account.address;
    const data = "0x" as `0x${string}`;
    const predecessor = toHex(new Uint8Array(32)) as `0x${string}`;
    const salt = keccak256(toBytes("test-salt"));
    const delay = 48n * 3600n;

    const scheduleId = (await timelock.read.hashOperation([
      target,
      value,
      data,
      predecessor,
      salt,
    ])) as `0x${string}`;

    await timelock.write.schedule([target, value, data, predecessor, salt, delay], {
      account: admin.account,
    });

    const opState = (await timelock.read.getOperationState([scheduleId])) as number;
    assert.equal(opState, 1);

    await networkHelpers.time.increase(Number(delay));
    await networkHelpers.mine();

    const before = await publicClient.getBalance({ address: target });
    await timelock.write.execute([target, value, data, predecessor, salt], {
      account: admin.account,
      value,
    });
    const after = await publicClient.getBalance({ address: target });
    assert.equal(after - before, value);
  });

  it("non-proposer cannot schedule", async () => {
    const { viem } = connection;
    const [admin, stranger] = await viem.getWalletClients();
    const timelock = await viem.deployContract("Timelock48h", [
      [admin.account.address],
      [admin.account.address],
      admin.account.address,
    ]);

    await assert.rejects(
      timelock.write.schedule(
        [stranger.account.address, 0n, "0x", toHex(new Uint8Array(32)), keccak256(toBytes("x")), 48n * 3600n],
        { account: stranger.account },
      ),
    );
  });
});
