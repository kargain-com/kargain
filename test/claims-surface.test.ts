import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeEventTopics, zeroAddress, type Log } from "viem";

import { claimablePayoutsAbi } from "../lib/claims/claimable-payouts-abi.ts";
import { formatClaimAmount } from "../lib/claims/format-claim-amount.ts";
import { claimRecordedFromReceipt } from "../lib/claims/receipt-claims.ts";
import { claimableContractsForChain } from "../lib/web3/claimable-contracts.ts";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

describe("formatClaimAmount", () => {
  it("formats native with decimals", () => {
    assert.equal(
      formatClaimAmount({
        amount: 10n ** 18n,
        decimals: 18,
        symbol: null,
        nativeSymbol: "ETH",
        isNative: true,
      }),
      "1 ETH",
    );
  });

  it("fail-closed raw when decimals missing", () => {
    assert.equal(
      formatClaimAmount({
        amount: 123n,
        decimals: null,
        symbol: "USDC",
        isNative: false,
      }),
      "123 USDC",
    );
  });
});

describe("claimableContractsForChain", () => {
  it("includes passport, staking, and both commerce modes on Nuclear commercial stacks", () => {
    const hub = claimableContractsForChain(84532);
    assert.equal(hub.length, 4);
    assert.deepEqual(
      hub.map((c) => c.key).sort(),
      [
        "ascendingConsignment",
        "fixedPriceConsignment",
        "karPassport",
        "karProStaking",
      ].sort(),
    );
    assert.equal(claimableContractsForChain(1).length, 0);
  });
});

describe("receipt claim parsing", () => {
  it("detects ClaimRecorded for account", () => {
    const topics = encodeEventTopics({
      abi: claimablePayoutsAbi,
      eventName: "ClaimRecorded",
      args: { account: ACCOUNT, asset: zeroAddress },
    });
    const amountHex =
      "0x0000000000000000000000000000000000000000000000000000000000000064";
    const log = {
      address: "0x3333333333333333333333333333333333333333",
      topics,
      data: amountHex,
      blockHash: "0x1",
      blockNumber: 1n,
      logIndex: 0,
      transactionHash: "0x2",
      transactionIndex: 0,
      removed: false,
    } as Log;

    const claims = claimRecordedFromReceipt({ logs: [log] }, ACCOUNT);
    assert.equal(claims.length, 1);
    assert.equal(claims[0]!.amount, 100n);
    assert.equal(claims[0]!.account, ACCOUNT);
    assert.equal(claimRecordedFromReceipt({ logs: [log] }, OTHER).length, 0);
  });
});
