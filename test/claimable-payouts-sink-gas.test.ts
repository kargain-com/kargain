/**
 * NATIVE_PUSH_GAS (30_000) sink behavior — fee and forfeit recipients (SPEC §13.9).
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { parseEther } from "viem";

import {
  DISPUTE_DEPOSIT,
  deployCommerceBaseStack,
  deployFixedPriceConsignment,
  joinVerifier,
  mintPassport,
  ZERO,
} from "../scripts/lib/local-stack.js";

const NATIVE_PUSH_GAS = 30_000n;
const PLATFORM_FEE_BPS = 250n;
const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const DENOM_NATIVE = { kind: 0, currencyCode: BYTES32_ZERO } as const;

function directSplitLegs(price: bigint, feeBps: bigint) {
  const platformLeg = (price * feeBps) / 10_000n;
  return { platformLeg, ownerLeg: price - platformLeg };
}

describe("ClaimablePayouts — sink native push vs NATIVE_PUSH_GAS", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("fee sink: low-burn receive succeeds within NATIVE_PUSH_GAS; high-burn credits claim", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const base = await deployCommerceBaseStack(viem);
    const feeSink = await viem.deployContract("GasBoundedRecipient", []);
    const price = parseEther("1");
    const { platformLeg } = directSplitLegs(price, PLATFORM_FEE_BPS);

    const { mode } = await deployFixedPriceConsignment(viem, {
      passport: base.passport.address,
      platformRecipient: feeSink.address,
      feeBps: PLATFORM_FEE_BPS,
      nativeUsdFeed: base.nativeFeed.address,
      nativeUsdStalenessTolerance: 3600,
      owner: base.admin.account.address,
      guardian: base.admin.account.address,
    });
    await base.passport.write.addEncumbranceSource([mode.address], {
      account: base.admin.account,
    });
    await joinVerifier(base.staking, base.stranger);
    const tokenId = await mintPassport(
      base.passport,
      base.owner,
      base.owner.account.address,
      "ar://gas-fee",
    );
    await base.passport.write.setApprovalForAll([mode.address, true], {
      account: base.owner.account,
    });
    await mode.write.openDirect([tokenId, DENOM_NATIVE, ZERO, price], {
      account: base.owner.account,
    });

    await feeSink.write.setGasToBurn([5_000n]);
    const sinkBeforeLow = await publicClient.getBalance({ address: feeSink.address });
    await mode.write.buy([tokenId], { account: base.buyer.account, value: price });
    const sinkAfterLow = await publicClient.getBalance({ address: feeSink.address });
    assert.equal(sinkAfterLow - sinkBeforeLow, platformLeg);
    assert.equal(await mode.read.pendingClaims([feeSink.address, ZERO]), 0n);

    const tokenId2 = await mintPassport(
      base.passport,
      base.owner,
      base.owner.account.address,
      "ar://gas-fee-2",
    );
    await base.passport.write.setApprovalForAll([mode.address, true], {
      account: base.owner.account,
    });
    await mode.write.openDirect([tokenId2, DENOM_NATIVE, ZERO, price], {
      account: base.owner.account,
    });
    await feeSink.write.setGasToBurn([50_000n]);
    await mode.write.buy([tokenId2], { account: base.buyer.account, value: price });
    assert.equal(await mode.read.pendingClaims([feeSink.address, ZERO]), platformLeg);
    assert.equal(await mode.read.totalPendingNative(), platformLeg);
  });

  it("forfeit sink: low-burn receive succeeds; high-burn credits claim on judge Rejected", async () => {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const base = await deployCommerceBaseStack(viem);
    const forfeitSink = await viem.deployContract("GasBoundedRecipient", []);
    const passport = await viem.deployContract("KarPassport", [
      base.staking.address,
      base.admin.account.address,
      DISPUTE_DEPOSIT,
      forfeitSink.address,
    ]);
    await joinVerifier(base.staking, base.verifier);
    const tokenId = await mintPassport(
      passport,
      base.owner,
      base.owner.account.address,
      "ar://forfeit-gas",
    );
    await passport.write.verifyPassport([tokenId], { account: base.verifier.account });
    await joinVerifier(base.staking, base.stranger);

    await passport.write.open([tokenId], {
      account: base.owner.account,
      value: DISPUTE_DEPOSIT,
    });

    await forfeitSink.write.setGasToBurn([5_000n]);
    const sinkBefore = await publicClient.getBalance({ address: forfeitSink.address });
    await passport.write.judge([tokenId, 1], { account: base.stranger.account });
    const sinkAfter = await publicClient.getBalance({ address: forfeitSink.address });
    assert.equal(sinkAfter - sinkBefore, DISPUTE_DEPOSIT);
    assert.equal(await passport.read.pendingClaims([forfeitSink.address, ZERO]), 0n);

    const tokenId2 = await mintPassport(
      passport,
      base.owner,
      base.owner.account.address,
      "ar://forfeit-gas-2",
    );
    await passport.write.verifyPassport([tokenId2], { account: base.verifier.account });
    await passport.write.open([tokenId2], {
      account: base.owner.account,
      value: DISPUTE_DEPOSIT,
    });
    await forfeitSink.write.setGasToBurn([50_000n]);
    await passport.write.judge([tokenId2, 1], { account: base.stranger.account });
    assert.equal(await passport.read.pendingClaims([forfeitSink.address, ZERO]), DISPUTE_DEPOSIT);
  });
});
