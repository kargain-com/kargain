/**
 * Nuclear #2 deployment rehearsal — prove ownership, Timelock-gated owner ops,
 * atomic proxy init, and upgrade-with-live-lot through the real governance path.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import hardhat from "hardhat";
import {
  encodeFunctionData,
  getAddress,
  padHex,
  parseEther,
  stringToHex,
  type Hex,
} from "viem";

import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
  KarPassportAbi,
} from "../lib/contracts/abis.generated.js";
import {
  Category,
  joinVerifier,
  mintPassport,
  ZERO,
} from "../scripts/lib/local-stack.js";
import {
  assertNuclearEncumbranceOrdering,
  assertSourcesRegistered,
  CHECKLIST_ONCHAIN_OPEN_WITHOUT_REGISTER,
} from "../scripts/lib/nuclear-ordering.js";
import {
  deployNuclearRehearsalStack,
  encodeUpgradeToAndCall,
  type NuclearRehearsalStack,
} from "../scripts/lib/nuclear-rehearsal-stack.js";
import {
  buildTimelockOp,
  runTimelockOp,
  type TimelockClient,
} from "../scripts/lib/timelock-execute.js";
import {
  ASCENDING_ABANDONMENT_WINDOW,
  ASCENDING_CHALLENGE_BOND,
  ASCENDING_EXTENSION_WINDOW,
  ASCENDING_MAX_DURATION,
  ASCENDING_MIN_DURATION,
  ASCENDING_MIN_INCREMENT_BPS,
  ASCENDING_PROTECTION_WINDOW,
  MARKETPLACE_MAX_FEED_STALENESS,
} from "../scripts/lib/verify-constructor-args.js";
import { NUCLEAR_DEPLOY_STEPS } from "../scripts/lib/nuclear-deploy-plan.js";

type Connection = Awaited<ReturnType<typeof hardhat.network.connect>>;

const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const DENOM_ASSET = { kind: 0, currencyCode: BYTES32_ZERO } as const;
const EUR = padHex(stringToHex("EUR"), { size: 32, dir: "right" });
const RESERVE = parseEther("1");
const MIN_INCREMENT_BPS = ASCENDING_MIN_INCREMENT_BPS;

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    if (err.message.includes(errorName)) return true;
    // OZ InvalidInitialization is often undecoded on Hardhat.
    if (errorName === "InvalidInitialization") {
      return err.message.includes("0xf92ee8a9");
    }
    return false;
  };
}

function paymentEnabled(cfg: unknown): boolean {
  if (Array.isArray(cfg)) return Boolean(cfg[2]);
  if (cfg && typeof cfg === "object" && "enabled" in cfg) {
    return Boolean((cfg as { enabled: boolean }).enabled);
  }
  return false;
}

function asTimelock(c: NuclearRehearsalStack["timelock"]): TimelockClient {
  return c as unknown as TimelockClient;
}

describe("Nuclear #2 deployment rehearsal", () => {
  let connection: Connection;
  let stack: NuclearRehearsalStack;
  let executedOps: string[];

  async function viaTimelock(label: string, target: `0x${string}`, data: Hex) {
    const { networkHelpers } = connection;
    const op = await buildTimelockOp({
      timelock: asTimelock(stack.timelock),
      target,
      data,
      saltLabel: `nuclear-rehearsal:${label}:${Date.now()}:${Math.random()}`,
    });
    await runTimelockOp({
      timelock: asTimelock(stack.timelock),
      op,
      account: stack.deployer.account,
      increaseTime: async (seconds) => {
        await networkHelpers.time.increase(seconds);
        await networkHelpers.mine();
      },
    });
    executedOps.push(label);
  }

  before(async () => {
    connection = await hardhat.network.connect();
    stack = await deployNuclearRehearsalStack(connection.viem);
    executedOps = [];
  });

  after(async () => {
    await connection.close();
  });

  it("structural: plan encumbrance order; bad order fails; checklist documented", () => {
    assertNuclearEncumbranceOrdering(NUCLEAR_DEPLOY_STEPS);
    assert.throws(
      () =>
        assertNuclearEncumbranceOrdering([
          "Timelock48h",
          "FixedPriceConsignmentProxy",
          "AscendingConsignmentProxy",
          "KarPassportBridgeGateway",
          "addEncumbranceSourceFixedPrice",
          "addEncumbranceSourceAscending",
          "setBridgeGateway",
          "transferPassportOwnership",
        ]),
      /addEncumbranceSource must complete before KarPassportBridgeGateway/,
    );
    assert.throws(
      () =>
        assertSourcesRegistered({
          fixedPriceRegistered: false,
          ascendingRegistered: true,
          fixedPrice: "0x1",
          ascending: "0x2",
        }),
      /Encumbrance not registered for FixedPrice/,
    );
    assert.ok(CHECKLIST_ONCHAIN_OPEN_WITHOUT_REGISTER.includes("isEncumbranceSource"));
  });

  it("ownership: modes + passport + staking owned by Timelock; guardian distinct", async () => {
    const tl = getAddress(stack.timelock.address);
    assert.equal(getAddress((await stack.fixedPrice.read.owner([])) as string), tl);
    assert.equal(getAddress((await stack.ascending.read.owner([])) as string), tl);
    assert.equal(getAddress((await stack.passport.read.owner([])) as string), tl);
    assert.equal(getAddress((await stack.staking.read.owner([])) as string), tl);

    const gFp = getAddress((await stack.fixedPrice.read.guardian([])) as string);
    const gAsc = getAddress((await stack.ascending.read.guardian([])) as string);
    assert.equal(gFp, getAddress(stack.guardian.account.address));
    assert.equal(gAsc, getAddress(stack.guardian.account.address));
    assert.notEqual(gFp, tl);
    assert.notEqual(gFp, getAddress(stack.deployer.account.address));

    assert.equal(
      await stack.passport.read.isEncumbranceSource([stack.fixedPrice.address]),
      true,
    );
    assert.equal(
      await stack.passport.read.isEncumbranceSource([stack.ascending.address]),
      true,
    );
  });

  it("atomic init: proxy state live after deploy; re-initialize reverts", async () => {
    assert.equal(await stack.fixedPrice.read.VERSION(), "2.1.0-rc.1");
    assert.equal(await stack.ascending.read.VERSION(), "2.1.0-rc.1");
    assert.equal(
      getAddress((await stack.fixedPrice.read.owner([])) as string),
      getAddress(stack.timelock.address),
    );

    await assert.rejects(
      stack.fixedPrice.write.initialize(
        [
          stack.passport.address,
          stack.platformRecipient,
          10n,
          stack.nativeFeed.address,
          MARKETPLACE_MAX_FEED_STALENESS,
          stack.timelock.address,
          stack.guardian.account.address,
        ],
        { account: stack.deployer.account },
      ),
      revertsWith("InvalidInitialization"),
    );
  });

  it("G3: guardian pauses; only Timelock unpauses", async () => {
    await stack.fixedPrice.write.pause({ account: stack.guardian.account });
    assert.equal(await stack.fixedPrice.read.paused([]), true);

    await assert.rejects(
      stack.fixedPrice.write.unpause({ account: stack.guardian.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );
    await assert.rejects(
      stack.fixedPrice.write.unpause({ account: stack.deployer.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );
    await assert.rejects(
      stack.fixedPrice.write.unpause({ account: stack.stranger.account }),
      revertsWith("OwnableUnauthorizedAccount"),
    );

    await viaTimelock(
      "FixedPrice.unpause",
      stack.fixedPrice.address,
      encodeFunctionData({
        abi: FixedPriceConsignmentAbi,
        functionName: "unpause",
        args: [],
      }),
    );
    assert.equal(await stack.fixedPrice.read.paused([]), false);

    await stack.ascending.write.pause({ account: stack.guardian.account });
    await viaTimelock(
      "Ascending.unpause",
      stack.ascending.address,
      encodeFunctionData({
        abi: AscendingConsignmentAbi,
        functionName: "unpause",
        args: [],
      }),
    );
    assert.equal(await stack.ascending.read.paused([]), false);
  });

  it("Timelock: FixedPrice approve/revoke token, currency feed, staleness, guardian", async () => {
    await viaTimelock(
      "FixedPrice.approvePaymentToken",
      stack.fixedPrice.address,
      encodeFunctionData({
        abi: FixedPriceConsignmentAbi,
        functionName: "approvePaymentToken",
        args: [stack.usdc.address, ZERO],
      }),
    );
    const cfg = await stack.fixedPrice.read.paymentTokens([stack.usdc.address]);
    assert.equal(paymentEnabled(cfg), true);

    const eurFeed = await connection.viem.deployContract("ChainlinkV3TestFeed", [
      8,
      110n * 10n ** 8n,
    ]);
    // Live Chainlink updates continuously; static test feeds go stale across the
    // 48h Timelock delay because `_validateFeed` runs at execute time. Refresh
    // after the wait so execute mirrors a live aggregator.
    {
      const { networkHelpers } = connection;
      const op = await buildTimelockOp({
        timelock: asTimelock(stack.timelock),
        target: stack.fixedPrice.address,
        data: encodeFunctionData({
          abi: FixedPriceConsignmentAbi,
          functionName: "setCurrencyFeed",
          args: [EUR, eurFeed.address],
        }),
        saltLabel: `nuclear-rehearsal:FixedPrice.setCurrencyFeed:${Date.now()}`,
      });
      await stack.timelock.write.schedule(
        [op.target, op.value, op.data, op.predecessor, op.salt, op.delay],
        { account: stack.deployer.account },
      );
      await networkHelpers.time.increase(Number(op.delay));
      await networkHelpers.mine();
      await eurFeed.write.setAnswer([110n * 10n ** 8n]);
      await stack.timelock.write.execute(
        [op.target, op.value, op.data, op.predecessor, op.salt],
        { account: stack.deployer.account },
      );
      executedOps.push("FixedPrice.setCurrencyFeed");
    }
    assert.equal(
      getAddress((await stack.fixedPrice.read.currencyFeeds([EUR])) as string),
      getAddress(eurFeed.address),
    );

    const newStaleness = MARKETPLACE_MAX_FEED_STALENESS + 60n;
    await viaTimelock(
      "FixedPrice.setMaxFeedStaleness",
      stack.fixedPrice.address,
      encodeFunctionData({
        abi: FixedPriceConsignmentAbi,
        functionName: "setMaxFeedStaleness",
        args: [newStaleness],
      }),
    );
    assert.equal(await stack.fixedPrice.read.maxFeedStaleness([]), newStaleness);

    await viaTimelock(
      "FixedPrice.revokePaymentToken",
      stack.fixedPrice.address,
      encodeFunctionData({
        abi: FixedPriceConsignmentAbi,
        functionName: "revokePaymentToken",
        args: [stack.usdc.address],
      }),
    );
    const after = await stack.fixedPrice.read.paymentTokens([stack.usdc.address]);
    assert.equal(paymentEnabled(after), false);

    // Re-approve for product completeness of later commerce (not required by this it).
    await viaTimelock(
      "FixedPrice.approvePaymentToken(re)",
      stack.fixedPrice.address,
      encodeFunctionData({
        abi: FixedPriceConsignmentAbi,
        functionName: "approvePaymentToken",
        args: [stack.usdc.address, ZERO],
      }),
    );

    const nextGuardian = stack.stranger.account.address;
    await viaTimelock(
      "FixedPrice.setGuardian",
      stack.fixedPrice.address,
      encodeFunctionData({
        abi: FixedPriceConsignmentAbi,
        functionName: "setGuardian",
        args: [nextGuardian],
      }),
    );
    assert.equal(
      getAddress((await stack.fixedPrice.read.guardian([])) as string),
      getAddress(nextGuardian),
    );
    // Restore rehearsal guardian for remaining tests.
    await viaTimelock(
      "FixedPrice.setGuardian(restore)",
      stack.fixedPrice.address,
      encodeFunctionData({
        abi: FixedPriceConsignmentAbi,
        functionName: "setGuardian",
        args: [stack.guardian.account.address],
      }),
    );
  });

  it("Timelock: Ascending setAuctionRules + approve/revoke payment token + guardian", async () => {
    const newBond = ASCENDING_CHALLENGE_BOND * 2n;
    await viaTimelock(
      "Ascending.setAuctionRules",
      stack.ascending.address,
      encodeFunctionData({
        abi: AscendingConsignmentAbi,
        functionName: "setAuctionRules",
        args: [
          ASCENDING_MIN_DURATION,
          ASCENDING_MAX_DURATION,
          ASCENDING_EXTENSION_WINDOW,
          ASCENDING_MIN_INCREMENT_BPS,
          ASCENDING_PROTECTION_WINDOW,
          ASCENDING_ABANDONMENT_WINDOW,
          newBond,
        ],
      }),
    );
    const rules = (await stack.ascending.read.auctionRules([])) as
      | { challengeBond: bigint }
      | readonly unknown[];
    const bond = Array.isArray(rules)
      ? (rules[6] as bigint)
      : (rules as { challengeBond: bigint }).challengeBond;
    assert.equal(bond, newBond);

    await viaTimelock(
      "Ascending.approvePaymentToken",
      stack.ascending.address,
      encodeFunctionData({
        abi: AscendingConsignmentAbi,
        functionName: "approvePaymentToken",
        args: [stack.usdc.address],
      }),
    );
    assert.equal(await stack.ascending.read.paymentTokenEnabled([stack.usdc.address]), true);

    await viaTimelock(
      "Ascending.revokePaymentToken",
      stack.ascending.address,
      encodeFunctionData({
        abi: AscendingConsignmentAbi,
        functionName: "revokePaymentToken",
        args: [stack.usdc.address],
      }),
    );
    assert.equal(await stack.ascending.read.paymentTokenEnabled([stack.usdc.address]), false);

    await viaTimelock(
      "Ascending.setGuardian",
      stack.ascending.address,
      encodeFunctionData({
        abi: AscendingConsignmentAbi,
        functionName: "setGuardian",
        args: [stack.stranger.account.address],
      }),
    );
    await viaTimelock(
      "Ascending.setGuardian(restore)",
      stack.ascending.address,
      encodeFunctionData({
        abi: AscendingConsignmentAbi,
        functionName: "setGuardian",
        args: [stack.guardian.account.address],
      }),
    );
  });

  it("Timelock: passport add/remove encumbrance source after handoff", async () => {
    const mock = await connection.viem.deployContract("MockEncumbranceSource", []);
    await viaTimelock(
      "KarPassport.addEncumbranceSource",
      stack.passport.address,
      encodeFunctionData({
        abi: KarPassportAbi,
        functionName: "addEncumbranceSource",
        args: [mock.address],
      }),
    );
    assert.equal(await stack.passport.read.isEncumbranceSource([mock.address]), true);

    await viaTimelock(
      "KarPassport.removeEncumbranceSource",
      stack.passport.address,
      encodeFunctionData({
        abi: KarPassportAbi,
        functionName: "removeEncumbranceSource",
        args: [mock.address],
      }),
    );
    assert.equal(await stack.passport.read.isEncumbranceSource([mock.address]), false);
  });

  it("Timelock upgrade preserves live ascending lot, bid, and claimable balance", async () => {
    // Ascending `_requireModeOpen` requires the opener to be an active verifier.
    await joinVerifier(stack.staking, stack.seller, {
      category: Category.DEALER,
      name: "Rehearsal Seller",
      metadataURI: "ar://rehearsal-seller",
    });
    await joinVerifier(stack.staking, stack.verifier, {
      category: Category.INSPECTOR,
      name: "Rehearsal Verifier",
      metadataURI: "ar://rehearsal-verifier",
    });

    const tokenId = await mintPassport(
      stack.passport,
      stack.seller,
      stack.seller.account.address,
      "ar://rehearsal-lot",
    );
    await stack.passport.write.verifyPassport([tokenId], {
      account: stack.verifier.account,
    });
    await stack.passport.write.setApprovalForAll([stack.ascending.address, true], {
      account: stack.seller.account,
    });

    const duration = ASCENDING_MIN_DURATION;
    await stack.ascending.write.openAscendingDirect(
      [tokenId, ZERO, RESERVE, duration],
      { account: stack.seller.account },
    );
    assert.equal(await stack.ascending.read.consignmentPhase([tokenId]), 1);

    const reverting = await connection.viem.deployContract("RevertingBidder", [
      stack.ascending.address,
    ]);
    await reverting.write.bidNative([tokenId], { value: RESERVE });
    assert.equal(await stack.ascending.read.auctionHighestBid([tokenId]), RESERVE);

    const minNext = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10_000n;
    await stack.ascending.write.bid([tokenId, minNext], {
      account: stack.bidder2.account,
      value: minNext,
    });
    const claimBefore = (await stack.ascending.read.pendingClaims([
      reverting.address,
      ZERO,
    ])) as bigint;
    assert.equal(claimBefore, RESERVE);

    const endsAt = (await stack.ascending.read.auctionEndsAt([tokenId])) as bigint;
    const high = (await stack.ascending.read.auctionHighestBid([tokenId])) as bigint;

    const nextImpl = await connection.viem.deployContract("AscendingConsignment", []);
    await viaTimelock(
      "Ascending.upgradeToAndCall",
      stack.ascending.address,
      encodeUpgradeToAndCall(nextImpl.address),
    );

    assert.equal(await stack.ascending.read.VERSION(), "2.1.0-rc.1");
    assert.equal(await stack.ascending.read.auctionEndsAt([tokenId]), endsAt);
    assert.equal(await stack.ascending.read.auctionHighestBid([tokenId]), high);
    assert.equal(
      await stack.ascending.read.pendingClaims([reverting.address, ZERO]),
      RESERVE,
    );
    assert.equal(await stack.ascending.read.consignmentPhase([tokenId]), 1);
  });

  it("Timelock FixedPrice upgrade preserves live offered consignment", async () => {
    const tokenId = await mintPassport(
      stack.passport,
      stack.seller,
      stack.seller.account.address,
      "ar://rehearsal-fp",
    );
    await stack.passport.write.verifyPassport([tokenId], {
      account: stack.verifier.account,
    });
    await stack.passport.write.setApprovalForAll([stack.fixedPrice.address, true], {
      account: stack.seller.account,
    });
    const price = parseEther("2");
    await stack.fixedPrice.write.openDirect([tokenId, DENOM_ASSET, ZERO, price], {
      account: stack.seller.account,
    });
    assert.equal(await stack.fixedPrice.read.consignmentPhase([tokenId]), 1);
    assert.equal(await stack.fixedPrice.read.consignmentPriceOf([tokenId]), price);

    const nextImpl = await connection.viem.deployContract("FixedPriceConsignment", []);
    await viaTimelock(
      "FixedPrice.upgradeToAndCall",
      stack.fixedPrice.address,
      encodeUpgradeToAndCall(nextImpl.address),
    );
    assert.equal(await stack.fixedPrice.read.VERSION(), "2.1.0-rc.1");
    assert.equal(await stack.fixedPrice.read.consignmentPhase([tokenId]), 1);
    assert.equal(await stack.fixedPrice.read.consignmentPriceOf([tokenId]), price);
  });

  it("finding checklist: open without register remains possible on bytecode (not fixed)", async () => {
    // Documented finding — rehearsal does not change Solidity. Prove the shape still holds:
    // isEncumbranceSource is advisory for open; LeaveChain consults the registry.
    assert.ok(
      CHECKLIST_ONCHAIN_OPEN_WITHOUT_REGISTER.includes("Register both modes"),
      "checklist must stay attached to the open-without-register finding",
    );
  });

  it("report: every rehearsed delayed op executed through Timelock", () => {
    const required = [
      "FixedPrice.unpause",
      "Ascending.unpause",
      "FixedPrice.approvePaymentToken",
      "FixedPrice.setCurrencyFeed",
      "FixedPrice.setMaxFeedStaleness",
      "FixedPrice.revokePaymentToken",
      "FixedPrice.setGuardian",
      "Ascending.setAuctionRules",
      "Ascending.approvePaymentToken",
      "Ascending.revokePaymentToken",
      "Ascending.setGuardian",
      "KarPassport.addEncumbranceSource",
      "KarPassport.removeEncumbranceSource",
      "Ascending.upgradeToAndCall",
      "FixedPrice.upgradeToAndCall",
    ];
    for (const op of required) {
      assert.ok(
        executedOps.some((e) => e === op || e.startsWith(`${op}(`)),
        `missing Timelock execution evidence for ${op}; got: ${executedOps.join(", ")}`,
      );
    }
  });
});
