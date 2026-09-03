/**
 * Timelock48h schedule → wait → execute helpers for Nuclear rehearsal and ops.
 */

import { getAddress, keccak256, toBytes, toHex, type Hex } from "viem";

import type { DeployedContract } from "./local-stack.js";

export const TIMELOCK_ZERO_PREDECESSOR = toHex(new Uint8Array(32)) as Hex;

/** Structural Timelock surface — Hardhat/viem contract clients satisfy DeployedContract. */
export type TimelockClient = DeployedContract;

export type TimelockOp = {
  target: `0x${string}`;
  value: bigint;
  data: Hex;
  predecessor: Hex;
  salt: Hex;
  delay: bigint;
};

export function nuclearOpSalt(label: string): Hex {
  return keccak256(toBytes(label));
}

export async function buildTimelockOp(input: {
  timelock: TimelockClient;
  target: `0x${string}`;
  data: Hex;
  saltLabel: string;
  value?: bigint;
  predecessor?: Hex;
}): Promise<TimelockOp> {
  const delay = BigInt((await input.timelock.read.getMinDelay([])) as bigint);
  return {
    target: getAddress(input.target),
    value: input.value ?? 0n,
    data: input.data,
    predecessor: input.predecessor ?? TIMELOCK_ZERO_PREDECESSOR,
    salt: nuclearOpSalt(input.saltLabel),
    delay,
  };
}

export async function scheduleTimelockOp(input: {
  timelock: TimelockClient;
  op: TimelockOp;
  account: { address: `0x${string}` };
}): Promise<Hex> {
  const { op, timelock, account } = input;
  const id = (await timelock.read.hashOperation([
    op.target,
    op.value,
    op.data,
    op.predecessor,
    op.salt,
  ])) as Hex;
  await timelock.write.schedule(
    [op.target, op.value, op.data, op.predecessor, op.salt, op.delay],
    { account, value: op.value > 0n ? op.value : undefined },
  );
  return id;
}

export async function executeTimelockOp(input: {
  timelock: TimelockClient;
  op: TimelockOp;
  account: { address: `0x${string}` };
}): Promise<void> {
  const { op, timelock, account } = input;
  await timelock.write.execute(
    [op.target, op.value, op.data, op.predecessor, op.salt],
    { account, value: op.value > 0n ? op.value : undefined },
  );
}

/**
 * Full delayed path: schedule → advance time by min delay → execute.
 * `increaseTime` is injected so Hardhat tests and future CLIs share one shape.
 */
export async function runTimelockOp(input: {
  timelock: TimelockClient;
  op: TimelockOp;
  account: { address: `0x${string}` };
  increaseTime: (seconds: number) => Promise<void>;
}): Promise<Hex> {
  const id = await scheduleTimelockOp(input);
  await input.increaseTime(Number(input.op.delay));
  await executeTimelockOp(input);
  return id;
}
