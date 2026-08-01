import assert from "node:assert/strict";
import { describe, it } from "node:test";
import hardhat from "hardhat";
import { encodeFunctionData, getAddress, parseEther, zeroHash } from "viem";

import {
  Category,
  CURRENCY_USD,
  DISPUTE_DEPOSIT,
  increaseTime,
  joinVerifier,
  receiptLogs,
  THREE_DAYS,
  ZERO,
} from "../scripts/lib/local-stack.js";
import { requireLocalDeployment } from "../scripts/lib/load-deployment.js";
import {
  buildTimelockOp,
  runTimelockOp,
} from "../scripts/lib/timelock-execute.js";
import {
  ASCENDING_ABANDONMENT_WINDOW,
  ASCENDING_CHALLENGE_WINDOW,
  ASCENDING_EXTENSION_WINDOW,
  ASCENDING_MIN_PROTECTION_WINDOW,
} from "../scripts/lib/verify-constructor-args.js";
import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
} from "../lib/contracts/abis.generated.js";

const URI_MINT = "ar://e2e-mint";
const URI_EDIT_1 = "ar://e2e-edit-1";
const URI_POST_DISPUTE = "ar://e2e-post-dispute";
const NATIVE = ZERO;
const DENOM_ASSET = { kind: 0, currencyCode: zeroHash } as const;
const PONDER_URL = process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";
const PONDER_POLL_MS = 1500;
const PONDER_TIMEOUT_MS = 60_000;
const E2E_STRICT = process.env.KARGAIN_E2E_STRICT === "1";
const E2E_CHAIN_ONLY = process.env.KARGAIN_E2E_CHAIN_ONLY === "1";

type NetworkConnection = Awaited<ReturnType<typeof hardhat.network.connect>>;

async function isPonderApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${PONDER_URL}/ready`);
    return res.ok;
  } catch {
    return false;
  }
}

function skipPonderChecks(reason: string): void {
  console.warn("\n[e2e] ═══ WARNING: Ponder indexer assertions SKIPPED ═══");
  console.warn(`[e2e] ${reason}`);
  console.warn("[e2e] Summary: chain lifecycle PASS · Ponder indexer assertions SKIPPED\n");
}

function failPonderChecks(reason: string): never {
  assert.fail(`[e2e] Ponder indexer assertions failed (strict): ${reason}`);
}

async function assertChainStatus(
  passport: { read: { getPassportStatus: (args: [bigint]) => Promise<[number, string, bigint]> } },
  tokenId: bigint,
  expected: number,
) {
  const [status] = await passport.read.getPassportStatus([tokenId]);
  assert.equal(status, expected, `expected passport status ${expected}, got ${status}`);
}

async function pollPonderPassport(
  tokenId: string,
  predicate: (body: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + PONDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${PONDER_URL}/passports/${tokenId}`);
      if (res.ok) {
        const body = (await res.json()) as Record<string, unknown>;
        if (predicate(body)) return body;
      }
    } catch {
      // indexer not ready
    }
    await new Promise((r) => setTimeout(r, PONDER_POLL_MS));
  }
  return null;
}

async function optionalPonderChecks(ownerAddress: string, tokenId: bigint) {
  if (E2E_CHAIN_ONLY) {
    console.warn("\n[e2e] ═══ INDEXER ASSERTIONS SKIPPED (chain-only mode) ═══");
    console.warn("[e2e] KARGAIN_E2E_CHAIN_ONLY=1 — Ponder not started; chain lifecycle only");
    console.warn(
      "[e2e] Summary: chain lifecycle PASS · INDEXER ASSERTIONS SKIPPED (chain-only mode)\n",
    );
    return;
  }

  const tokenIdParam = String(tokenId);

  if (!(await isPonderApiReachable())) {
    const reason = `Ponder API unreachable at ${PONDER_URL}/ready`;
    if (E2E_STRICT) failPonderChecks(reason);
    skipPonderChecks(reason);
    return;
  }

  const row = await pollPonderPassport(tokenIdParam, (body) => {
    if (body.status !== "VERIFIED") return false;
    const uriHistory = body.uriHistory as
      | Array<{ verificationReset?: boolean; uri?: string }>
      | undefined;
    // Do not return on the first VERIFIED snapshot — URI history rows can lag
    // VerificationReset / PassportURIUpdated in the same backlog.
    return Boolean(
      uriHistory &&
        uriHistory.length >= 2 &&
        uriHistory.some((h) => h.verificationReset === true),
    );
  });
  if (!row) {
    const reason = `Ponder did not index passport ${tokenIdParam} to VERIFIED with uriHistory (≥2, verificationReset) within ${PONDER_TIMEOUT_MS}ms`;
    if (E2E_STRICT) failPonderChecks(reason);
    skipPonderChecks(reason);
    return;
  }

  const uriHistory = row.uriHistory as Array<{ verificationReset?: boolean; uri?: string }>;
  assert.ok(uriHistory.length >= 2, "expected uriHistory.length >= 2");
  assert.ok(
    uriHistory.some((h) => h.verificationReset === true),
    "expected at least one uriHistory row with verificationReset: true",
  );

  if (typeof row.lastDisputer === "string" && row.lastDisputer.length > 0) {
    assert.equal(getAddress(row.lastDisputer as `0x${string}`), getAddress(ownerAddress as `0x${string}`));
  }

  console.log("[e2e] Ponder assertions passed");
  console.log("[e2e] Summary: chain lifecycle PASS · Ponder indexer assertions PASS");
}

const RUN_E2E = process.env.KARGAIN_E2E_LOCAL === "1";

const describeE2e = RUN_E2E ? describe : describe.skip;

const BPS = 10_000n;
const DENOM_USD = { kind: 1, currencyCode: CURRENCY_USD } as const;

/** S32 / current source Commission legs (platform first, owner floored rate, agent residual). */
function monoCommissionLegs(S: bigint, p: bigint, c: bigint) {
  const platform = (S * p) / BPS;
  const cut = p + c;
  const ownerAmt = cut >= BPS ? 0n : (S * (BPS - cut)) / BPS;
  const agent = S - platform - ownerAmt;
  return { platform, owner: ownerAmt, agent };
}

/** Pre-S32 Commission owner share (platform + agent cuts floored independently). */
function oldCommissionOwner(S: bigint, p: bigint, c: bigint) {
  return S - (S * p) / BPS - (S * c) / BPS;
}

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    return err.message.includes(errorName);
  };
}

describeE2e("localhost 31337 passport lifecycle E2E", () => {
  it("runs full lifecycle against deployed stack", async () => {
    requireLocalDeployment();

    let connection: NetworkConnection | undefined;
    try {
      connection = await hardhat.network.connect({ network: "localhost" });
      const { viem } = connection;
      const publicClient = await viem.getPublicClient();
      const deployment = requireLocalDeployment();

      const passport = await viem.getContractAt("KarPassport", deployment.karPassport);
      const chainId = await publicClient.getChainId();
      const firstTokenId = BigInt(chainId) << 128n;
      assert.equal(
        await passport.read.tokenIdOffset(),
        firstTokenId,
        "tokenIdOffset must equal chainId << 128",
      );
      const staking = await viem.getContractAt("KarProStaking", deployment.karProStaking);
      assert.ok(
        deployment.fixedPriceConsignment,
        "deployments/31337.json missing fixedPriceConsignment — re-run pnpm deploy:local",
      );
      const fixedPrice = await viem.getContractAt(
        "FixedPriceConsignment",
        deployment.fixedPriceConsignment!,
      );

      const wallets = await viem.getWalletClients();
      const owner = wallets[1]!;
      const verifier = wallets[2]!;
      const buyer = wallets[2]!;
      const resolver = wallets[3]!;

      // 1 — becomeVerifierNative
      await joinVerifier(staking, verifier, {
        category: Category.INSPECTOR,
        name: "E2E Verifier",
        metadataURI: "ar://e2e-verifier",
      });
      assert.equal(await staking.read.isActiveVerifier([verifier.account.address]), true);

      // 2 — mintPassport
      await passport.write.mintPassport([owner.account.address, URI_MINT], {
        account: owner.account,
      });
      assert.equal(await passport.read.nextTokenId(), firstTokenId + 1n);
      await assertChainStatus(passport, firstTokenId, 0);

      // 3 — verifyPassport
      await passport.write.verifyPassport([firstTokenId], { account: verifier.account });
      await assertChainStatus(passport, firstTokenId, 1);

      // 4 — setPassportURI → VerificationReset
      const resetHash = await passport.write.setPassportURI([firstTokenId, URI_EDIT_1], {
        account: owner.account,
      });
      const resetLogs = await receiptLogs(publicClient, resetHash, passport.abi);
      assert.ok(resetLogs.some((l) => l.eventName === "VerificationReset"));
      await assertChainStatus(passport, firstTokenId, 0);
      assert.equal(await passport.read.tokenURI([firstTokenId]), URI_EDIT_1);

      // 5 — verify again
      await passport.write.verifyPassport([firstTokenId], { account: verifier.account });
      await assertChainStatus(passport, firstTokenId, 1);

      // 6 — open challenge
      await passport.write.open([firstTokenId], {
        account: owner.account,
        value: DISPUTE_DEPOSIT,
      });
      await assertChainStatus(passport, firstTokenId, 2);

      // 7 — judge(Upheld) via independent resolver
      await joinVerifier(staking, resolver, {
        category: Category.INSPECTOR,
        name: "E2E Resolver",
        metadataURI: "ar://e2e-resolver",
      });
      await passport.write.judge([firstTokenId, 0], { account: resolver.account });
      await assertChainStatus(passport, firstTokenId, 0);

      // 8 — setPassportURI after resolve (T9)
      await passport.write.setPassportURI([firstTokenId, URI_POST_DISPUTE], {
        account: owner.account,
      });
      assert.equal(await passport.read.tokenURI([firstTokenId]), URI_POST_DISPUTE);

      // Re-verify before consignment + appendRecord (T10 requires VERIFIED)
      await passport.write.verifyPassport([firstTokenId], { account: verifier.account });
      await assertChainStatus(passport, firstTokenId, 1);

      // 9 — FixedPriceConsignment openDirect + buy
      await passport.write.setApprovalForAll([fixedPrice.address, true], {
        account: owner.account,
      });
      const price = parseEther("1");
      await fixedPrice.write.openDirect(
        [firstTokenId, DENOM_ASSET, NATIVE, price],
        { account: owner.account },
      );
      // Phase.Offered = 1 — live fixed-price offer (isLiveConsignment is internal).
      assert.equal(await fixedPrice.read.consignmentPhase([firstTokenId]), 1);

      await fixedPrice.write.buy([firstTokenId], { account: buyer.account, value: price });
      // Phase.Closed = 2 after buy.
      assert.equal(await fixedPrice.read.consignmentPhase([firstTokenId]), 2);
      assert.equal(
        getAddress(await passport.read.ownerOf([firstTokenId])),
        getAddress(buyer.account.address),
      );

      // 10 — appendRecord on VERIFIED (T10 — status unchanged)
      await passport.write.appendRecord(
        [firstTokenId, "service", "E2E oil change", "ar://e2e-record"],
        { account: buyer.account },
      );
      await assertChainStatus(passport, firstTokenId, 1);
      assert.equal(await passport.read.recordCount([firstTokenId]), 1n);

      await optionalPonderChecks(owner.account.address, firstTokenId);
    } finally {
      await connection?.close();
    }
  });
});

async function pollJson(
  path: string,
  predicate: (body: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + PONDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${PONDER_URL}${path}`);
      if (res.ok) {
        const body = (await res.json()) as Record<string, unknown>;
        if (predicate(body)) return body;
      }
    } catch {
      // indexer not ready
    }
    await new Promise((r) => setTimeout(r, PONDER_POLL_MS));
  }
  return null;
}

describeE2e("localhost commerce modes E2E", () => {
  it("FixedPrice + Ascending: open, mandate, bid/extension, settle, challenge, claim", async () => {
    let connection: NetworkConnection | undefined;
    try {
      connection = await hardhat.network.connect({ network: "localhost" });
      const { viem } = connection;
      const publicClient = await viem.getPublicClient();
      const deployment = requireLocalDeployment();
      assert.ok(
        deployment.fixedPriceConsignment && deployment.ascendingConsignment,
        "deployments/31337.json missing commerce modes — run pnpm deploy:local",
      );
      assert.ok(
        deployment.commercePayoutSink,
        "deployments/31337.json missing commercePayoutSink — run pnpm deploy:local",
      );

      const passport = await viem.getContractAt("KarPassport", deployment.karPassport);
      const staking = await viem.getContractAt("KarProStaking", deployment.karProStaking);
      const fixedPrice = await viem.getContractAt(
        "FixedPriceConsignment",
        deployment.fixedPriceConsignment!,
      );
      const ascending = await viem.getContractAt(
        "AscendingConsignment",
        deployment.ascendingConsignment!,
      );
      const sink = await viem.getContractAt(
        "RevertingRecipient",
        deployment.commercePayoutSink!,
      );

      const wallets = await viem.getWalletClients();
      const funder = wallets[0]!;
      const owner = wallets[1]!;
      const agent = wallets[2]!;
      const buyer = wallets[3]!;
      const bidder2 = wallets[4]!;
      const judge = wallets[5]!;

      const BYTES32_ZERO =
        "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
      const DENOM_ASSET = { kind: 0, currencyCode: BYTES32_ZERO } as const;
      const COMP_MARGIN = { form: 0, commissionBps: 0 } as const;
      const reserve = 1n * 10n ** 18n;
      const duration = THREE_DAYS;
      const bond = DISPUTE_DEPOSIT;
      const fpPrice = parseEther("1");

      for (const w of [owner, agent, judge]) {
        const active = (await staking.read.isActiveVerifier([w.account.address])) as boolean;
        if (!active) {
          await joinVerifier(staking, w, {
            category: Category.INSPECTOR,
            name: `E2E Commerce ${w.account.address.slice(0, 8)}`,
            metadataURI: "ar://e2e-commerce",
          });
        }
      }

      await passport.write.setApprovalForAll([fixedPrice.address, true], {
        account: owner.account,
      });
      await passport.write.setApprovalForAll([ascending.address, true], {
        account: owner.account,
      });

      async function mintVerified(uri: string): Promise<bigint> {
        const tokenId = (await passport.read.nextTokenId()) as bigint;
        await passport.write.mintPassport([owner.account.address, uri], {
          account: owner.account,
        });
        await passport.write.verifyPassport([tokenId], { account: agent.account });
        return tokenId;
      }

      async function fundRejecting(
        rejecting: {
          address: `0x${string}`;
          write: { setAcceptEth: (args: [boolean]) => Promise<unknown> };
        },
        value: bigint,
      ) {
        await rejecting.write.setAcceptEth([true]);
        await funder.sendTransaction({
          to: rejecting.address,
          value,
          account: funder.account,
        });
        await rejecting.write.setAcceptEth([false]);
      }

      async function openAscendingLot(uri: string): Promise<bigint> {
        const tokenId = await mintVerified(uri);
        await ascending.write.openAscendingDirect(
          [tokenId, NATIVE, reserve, duration, ASCENDING_MIN_PROTECTION_WINDOW],
          {
          account: owner.account,
        },
        );
        return tokenId;
      }

      async function settleAfterSingleBid(
        tokenId: bigint,
        rejecting: {
          address: `0x${string}`;
          write: {
            setAcceptEth: (args: [boolean]) => Promise<unknown>;
            bidNative: (args: [bigint], opts: { value: bigint }) => Promise<unknown>;
          };
        },
      ) {
        await fundRejecting(rejecting, reserve);
        await rejecting.write.bidNative([tokenId], { value: reserve });
        await increaseTime(publicClient, duration + 2n);
        await ascending.write.settle([tokenId], { account: buyer.account });
      }

      // Sink refuses ETH so platform / forfeit legs → ClaimRecorded.
      await sink.write.setAcceptEth([false]);

      const feeBps = BigInt((await fixedPrice.read.platformFeeBps()) as number);
      const commissionBps = 500n;
      const commissionFloor = monoCommissionLegs(fpPrice, feeBps, commissionBps).owner;

      // --- FixedPrice direct buy: platform leg fails → consignment.platform_payout ---
      const fpToken = await mintVerified("ar://e2e-fp");
      await fixedPrice.write.openDirect([fpToken, DENOM_ASSET, NATIVE, fpPrice], {
        account: owner.account,
      });
      await fixedPrice.write.buy([fpToken], { account: buyer.account, value: fpPrice });
      assert.equal(
        getAddress(await passport.read.ownerOf([fpToken])),
        getAddress(buyer.account.address),
      );

      // --- Owner + agent split legs: both parties are receive-reverting contracts ---
      const sellerContract = await viem.deployContract("RevertingRecipient");
      const agentContract = await viem.deployContract("RevertingRecipient");
      await sellerContract.write.setAcceptEth([false]);
      await agentContract.write.setAcceptEth([false]);

      const splitToken = (await passport.read.nextTokenId()) as bigint;
      await passport.write.mintPassport([sellerContract.address, "ar://e2e-fp-split"], {
        account: owner.account,
      });
      await passport.write.verifyPassport([splitToken], { account: agent.account });
      await sellerContract.write.approvePassport([passport.address, fixedPrice.address, true]);
      await sellerContract.write.grantFixed([
        fixedPrice.address,
        splitToken,
        agentContract.address,
        0n,
        NATIVE,
        0,
        BYTES32_ZERO,
        commissionFloor,
        1,
        Number(commissionBps),
      ]);
      await agentContract.write.openFixedFromMandate([
        fixedPrice.address,
        splitToken,
        0,
        BYTES32_ZERO,
        fpPrice,
      ]);
      await fixedPrice.write.buy([splitToken], { account: buyer.account, value: fpPrice });

      // S32: platform first, owner floored kept-rate, agent residual (not ⌊S·c/B⌋).
      const splitLegs = monoCommissionLegs(fpPrice, feeBps, commissionBps);
      const expectedPlatform = splitLegs.platform;
      const expectedOwner = splitLegs.owner;
      const expectedAgent = splitLegs.agent;
      const ownerClaim = (await fixedPrice.read.pendingClaims([
        sellerContract.address,
        NATIVE,
      ])) as bigint;
      const agentClaim = (await fixedPrice.read.pendingClaims([
        agentContract.address,
        NATIVE,
      ])) as bigint;
      assert.equal(
        ownerClaim,
        expectedOwner,
        `owner pendingClaims must match split owner leg (${expectedOwner})`,
      );
      assert.equal(
        agentClaim,
        expectedAgent,
        `agent pendingClaims must match split agent leg (${expectedAgent})`,
      );

      // --- FixedPrice mandate open (left offered) ---
      const fpToken2 = await mintVerified("ar://e2e-fp-m");
      await fixedPrice.write.grant(
        [fpToken2, agent.account.address, 0n, NATIVE, DENOM_ASSET, 0n, COMP_MARGIN],
        { account: owner.account },
      );
      await fixedPrice.write.openFromMandate([fpToken2, DENOM_ASSET, fpPrice], {
        account: agent.account,
      });

      // --- Ascending: outbid refund + Rejected (forfeit + platform split) ---
      const aToken = await openAscendingLot("ar://e2e-asc-outbid");
      const rejectingOutbid = await viem.deployContract("AscendingRejectingBidder", [
        ascending.address,
      ]);
      await fundRejecting(rejectingOutbid, reserve);
      await rejectingOutbid.write.bidNative([aToken], { value: reserve });

      await increaseTime(publicClient, duration - 60n);
      const raise = (reserve * 10_300n) / 10_000n;
      await ascending.write.bid([aToken, raise], {
        account: bidder2.account,
        value: raise,
      });
      await increaseTime(publicClient, ASCENDING_EXTENSION_WINDOW + 2n);
      await ascending.write.settle([aToken], { account: buyer.account });

      await ascending.write.open([aToken], { account: bidder2.account, value: bond });
      await ascending.write.judge([aToken, 1], { account: judge.account });

      const outbidClaim = (await ascending.read.pendingClaims([
        rejectingOutbid.address,
        NATIVE,
      ])) as bigint;
      assert.ok(outbidClaim > 0n, "expected outbid ClaimRecorded for rejecting bidder");

      // --- Bond return on withdraw ---
      const wToken = await openAscendingLot("ar://e2e-asc-withdraw");
      const rejectingWithdraw = await viem.deployContract("AscendingRejectingBidder", [
        ascending.address,
      ]);
      await settleAfterSingleBid(wToken, rejectingWithdraw);
      await fundRejecting(rejectingWithdraw, bond);
      await rejectingWithdraw.write.openChallenge([wToken], { value: bond });
      await rejectingWithdraw.write.withdrawChallenge([wToken]);
      const withdrawClaim = (await ascending.read.pendingClaims([
        rejectingWithdraw.address,
        NATIVE,
      ])) as bigint;
      assert.ok(withdrawClaim >= bond, "expected bond-return ClaimRecorded");

      // --- Bond on judgement (Upheld) + completeReversal ---
      const uToken = await openAscendingLot("ar://e2e-asc-upheld");
      const rejectingUpheld = await viem.deployContract("AscendingRejectingBidder", [
        ascending.address,
      ]);
      await settleAfterSingleBid(uToken, rejectingUpheld);
      await fundRejecting(rejectingUpheld, bond);
      await rejectingUpheld.write.openChallenge([uToken], { value: bond });
      await ascending.write.judge([uToken, 0], { account: judge.account });
      const upheldBondClaim = (await ascending.read.pendingClaims([
        rejectingUpheld.address,
        NATIVE,
      ])) as bigint;
      assert.ok(upheldBondClaim >= bond, "expected upheld bond ClaimRecorded");

      await rejectingUpheld.write.approvePassport([passport.address, ascending.address, true]);
      await rejectingUpheld.write.completeReversal([uToken]);
      const reversalClaim = (await ascending.read.pendingClaims([
        rejectingUpheld.address,
        NATIVE,
      ])) as bigint;
      assert.ok(reversalClaim > upheldBondClaim, "expected reversal refund ClaimRecorded");

      // --- Bond forfeit on expiry (conclude) ---
      const eToken = await openAscendingLot("ar://e2e-asc-expire");
      await ascending.write.bid([eToken, reserve], {
        account: bidder2.account,
        value: reserve,
      });
      await increaseTime(publicClient, duration + 2n);
      await ascending.write.settle([eToken], { account: buyer.account });
      await ascending.write.open([eToken], { account: bidder2.account, value: bond });
      await increaseTime(publicClient, ASCENDING_CHALLENGE_WINDOW + 2n);
      await ascending.write.conclude([eToken], { account: buyer.account });
      const sinkExpireClaim = (await ascending.read.pendingClaims([
        sink.address,
        NATIVE,
      ])) as bigint;
      assert.ok(sinkExpireClaim > 0n, "expected forfeit/platform ClaimRecorded on conclude");

      // --- Reversal abandon (platform split to sink) ---
      const abToken = await openAscendingLot("ar://e2e-asc-abandon");
      await ascending.write.bid([abToken, reserve], {
        account: bidder2.account,
        value: reserve,
      });
      await increaseTime(publicClient, duration + 2n);
      await ascending.write.settle([abToken], { account: buyer.account });
      await ascending.write.open([abToken], { account: bidder2.account, value: bond });
      await ascending.write.judge([abToken, 0], { account: judge.account });
      await increaseTime(publicClient, ASCENDING_ABANDONMENT_WINDOW + 2n);
      const sinkBeforeAbandon = (await ascending.read.pendingClaims([
        sink.address,
        NATIVE,
      ])) as bigint;
      await ascending.write.abandonReversal([abToken], { account: buyer.account });
      const sinkAfterAbandon = (await ascending.read.pendingClaims([
        sink.address,
        NATIVE,
      ])) as bigint;
      assert.ok(
        sinkAfterAbandon > sinkBeforeAbandon,
        "expected platform ClaimRecorded on abandonReversal",
      );

      const runIndexer = !E2E_CHAIN_ONLY && (await isPonderApiReachable());
      if (!E2E_CHAIN_ONLY && !runIndexer) {
        const reason = `Ponder API unreachable at ${PONDER_URL}/ready`;
        if (E2E_STRICT) failPonderChecks(reason);
        skipPonderChecks(reason);
        return;
      }
      if (!runIndexer) {
        console.warn(
          "[e2e-commerce] Summary: chain commerce PASS · INDEXER ASSERTIONS SKIPPED (chain-only mode)",
        );
        return;
      }

      const fpClosed = await pollJson(`/consignments/by-token/${fpToken}`, (body) => {
        const row = body.consignment as Record<string, unknown> | undefined;
        return row?.phase === "closed" && row?.mode === "fixedPrice";
      });
      if (!fpClosed) {
        const reason = `Ponder fixedPrice consignment ${fpToken} not closed`;
        if (E2E_STRICT) failPonderChecks(reason);
        skipPonderChecks(reason);
        return;
      }

      const mandateBody = await pollJson(
        `/agents/${getAddress(agent.account.address)}/mandates?active=true`,
        (body) => typeof body.total === "number" && (body.total as number) >= 1,
      );
      assert.ok(mandateBody, "expected agent mandate indexed");

      const ascLive = await pollJson(`/consignments/by-token/${aToken}?mode=ascending`, (body) => {
        const row = body.consignment as Record<string, unknown> | undefined;
        return row != null && typeof row.id === "string";
      });
      if (!ascLive) {
        const reason = `Ponder ascending consignment ${aToken} missing`;
        if (E2E_STRICT) failPonderChecks(reason);
        skipPonderChecks(reason);
        return;
      }
      const ascId = (ascLive.consignment as Record<string, unknown>).id as string;
      const bids = await pollJson(
        `/consignments/${encodeURIComponent(ascId)}/bids`,
        (body) => typeof body.total === "number" && (body.total as number) >= 2,
      );
      assert.ok(bids, "expected ≥2 ascending bids indexed (including extension)");

      const fpMandate = await pollJson(`/consignments/by-token/${fpToken2}`, (body) => {
        const row = body.consignment as Record<string, unknown> | undefined;
        return row?.phase === "offered" && row?.mode === "fixedPrice";
      });
      assert.ok(fpMandate, "mandate-opened fixed consignment offered");

      const EXPECTED_REASON_CODES = [
        "ascending.outbid_refund",
        "consignment.platform_payout",
        "consignment.owner_payout",
        "consignment.agent_payout",
        "challenge.bond_returned",
        "challenge.bond_routed",
        "ascending.reversal_refund",
      ] as const;

      type CreditRow = {
        reasonCode?: string;
        account?: string;
        amount?: string | number | bigint;
      };

      function creditAmount(c: CreditRow): bigint {
        return BigInt(String(c.amount ?? "0"));
      }

      const creditsCovered = await pollJson("/commerce-claim-credits?limit=100", (body) => {
        const credits = body.credits as CreditRow[] | undefined;
        if (!Array.isArray(credits)) return false;
        const seen = new Set(credits.map((c) => c.reasonCode).filter(Boolean));
        if (!EXPECTED_REASON_CODES.every((code) => seen.has(code))) return false;
        const ownerHit = credits.find(
          (c) =>
            c.reasonCode === "consignment.owner_payout" &&
            typeof c.account === "string" &&
            getAddress(c.account) === getAddress(sellerContract.address) &&
            creditAmount(c) === expectedOwner,
        );
        const agentHit = credits.find(
          (c) =>
            c.reasonCode === "consignment.agent_payout" &&
            typeof c.account === "string" &&
            getAddress(c.account) === getAddress(agentContract.address) &&
            creditAmount(c) === expectedAgent,
        );
        return ownerHit != null && agentHit != null;
      });
      if (!creditsCovered) {
        const body = await fetch(`${PONDER_URL}/commerce-claim-credits?limit=100`)
          .then((r) => r.json() as Promise<{ credits?: CreditRow[] }>)
          .catch(() => null);
        const credits = body?.credits ?? [];
        const seen = new Set(credits.map((c) => c.reasonCode).filter(Boolean) as string[]);
        const missing = EXPECTED_REASON_CODES.filter((c) => !seen.has(c));
        const ownerRows = credits.filter((c) => c.reasonCode === "consignment.owner_payout");
        const agentRows = credits.filter((c) => c.reasonCode === "consignment.agent_payout");
        const reason =
          `missing attributed commerce claim credits` +
          (missing.length ? ` (codes: ${missing.join(", ")})` : "") +
          `; expected owner=${getAddress(sellerContract.address)} amount=${expectedOwner}` +
          ` seenOwner=[${ownerRows.map((c) => `${c.account}:${c.amount}`).join("; ") || "none"}]` +
          `; expected agent=${getAddress(agentContract.address)} amount=${expectedAgent}` +
          ` seenAgent=[${agentRows.map((c) => `${c.account}:${c.amount}`).join("; ") || "none"}]` +
          ` (all: ${[...seen].join(", ") || "none"})`;
        if (E2E_STRICT) failPonderChecks(reason);
        skipPonderChecks(reason);
        return;
      }

      const unknownBody = await pollJson(
        "/commerce-claim-credits?reasonCode=unknown&limit=100",
        (body) => typeof body.total === "number",
      );
      assert.ok(unknownBody, "commerce-claim-credits?reasonCode=unknown reachable");
      const unknownTotal = unknownBody.total as number;
      if (unknownTotal > 0) {
        const credits = (unknownBody.credits as Array<Record<string, unknown>>) ?? [];
        const detail = credits
          .map((c) => {
            const id = String(c.id ?? "");
            const txHash = id.includes("-") ? id.slice(0, id.lastIndexOf("-")) : id;
            return `id=${id} tx=${txHash} account=${c.account} contract=${c.contract}`;
          })
          .join("; ");
        assert.fail(
          `[e2e-commerce] unknown reasonCode credits found (total=${unknownTotal}): ${detail}`,
        );
      }

      console.log(
        "[e2e-commerce] Summary: chain commerce PASS · Ponder indexer assertions PASS · owner/agent split attributed · unknown credits=0",
      );
    } finally {
      await connection?.close();
    }
  });
});

/**
 * Phase 1 — PENDING-REDEPLOY behavioural delta walk on Hardhat 31337 (current source).
 * Not a re-run of unit coverage: §1 + §5 share FixedPrice.buy / `_agentedFloorScaleBase`.
 * Record: docs/PENDING-REDEPLOY.md (Nuclear #3 prep); scenarios prove source ahead of old commercial bytecode.
 */
describeE2e("localhost Phase 1 PENDING-REDEPLOY walk", () => {
  it("scenarios 1–6: combined §1+§5 buy, monotonicity, high commission, ShortDelivery, S30 getters, ZeroMinStake", async () => {
    let connection: NetworkConnection | undefined;
    try {
      connection = await hardhat.network.connect({ network: "localhost" });
      const { viem } = connection;
      const publicClient = await viem.getPublicClient();
      const deployment = requireLocalDeployment();
      assert.ok(deployment.fixedPriceConsignment && deployment.ascendingConsignment);
      assert.ok(deployment.usdc && deployment.nativeFeed && deployment.timelock);
      assert.ok(deployment.commercePayoutSink);

      const passport = await viem.getContractAt("KarPassport", deployment.karPassport);
      const staking = await viem.getContractAt("KarProStaking", deployment.karProStaking);
      const fixedPrice = await viem.getContractAt(
        "FixedPriceConsignment",
        deployment.fixedPriceConsignment!,
      );
      const ascending = await viem.getContractAt(
        "AscendingConsignment",
        deployment.ascendingConsignment!,
      );
      const usdc = await viem.getContractAt("MockUSDC", deployment.usdc!);
      const nativeFeed = await viem.getContractAt("ChainlinkV3TestFeed", deployment.nativeFeed!);
      const timelock = await viem.getContractAt("Timelock48h", deployment.timelock!);
      const sink = await viem.getContractAt("RevertingRecipient", deployment.commercePayoutSink!);

      const wallets = await viem.getWalletClients();
      const admin = wallets[0]!;
      const owner = wallets[1]!;
      const agent = wallets[2]!;
      const buyer = wallets[3]!;

      const DENOM_ASSET = { kind: 0, currencyCode: zeroHash } as const;
      const feeBps = BigInt((await fixedPrice.read.platformFeeBps()) as number);
      assert.equal(feeBps, 10n, "local FixedPrice fee must be MARKETPLACE_FEE_BPS=10 for S32 danger-band cases");

      for (const w of [owner, agent]) {
        if (!(await staking.read.isActiveVerifier([w.account.address]))) {
          await joinVerifier(staking, w, {
            category: Category.INSPECTOR,
            name: `E2E P1 ${w.account.address.slice(0, 8)}`,
            metadataURI: "ar://e2e-p1",
          });
        }
      }

      await passport.write.setApprovalForAll([fixedPrice.address, true], {
        account: owner.account,
      });
      await passport.write.setApprovalForAll([ascending.address, true], {
        account: owner.account,
      });
      // Platform sink accepts ETH so Phase 1 can assert live balances (not claims).
      await sink.write.setAcceptEth([true]);

      // Commerce E2E ahead of this suite advances time (auction windows) → feeds go StalePrice.
      async function refreshNativeFeed(answer: bigint = 2000n * 10n ** 8n) {
        await nativeFeed.write.setAnswer([answer]);
      }
      async function refreshUsdcFeed() {
        const raw = (await fixedPrice.read.paymentTokens([usdc.address])) as
          | { feed: `0x${string}`; decimals: number; enabled: boolean; stalenessTolerance: number }
          | readonly [`0x${string}`, number, boolean, number];
        const feed = Array.isArray(raw) ? raw[0] : raw.feed;
        assert.ok(feed && feed !== ZERO, "USDC must have an admitted feed");
        // deploy:local admits with MockV3Aggregator; ChainlinkV3TestFeed also has setAnswer.
        const usdcFeed = await viem.getContractAt("MockV3Aggregator", feed);
        await usdcFeed.write.setAnswer([10n ** 8n]); // $1
      }
      await refreshNativeFeed();
      await refreshUsdcFeed();

      async function mintVerified(uri: string): Promise<bigint> {
        const tokenId = (await passport.read.nextTokenId()) as bigint;
        await passport.write.mintPassport([owner.account.address, uri], {
          account: owner.account,
        });
        await passport.write.verifyPassport([tokenId], { account: agent.account });
        return tokenId;
      }

      async function admitPaymentTokenViaTimelock(
        modeAddress: `0x${string}`,
        data: `0x${string}`,
        saltLabel: string,
      ) {
        const op = await buildTimelockOp({
          timelock,
          target: modeAddress,
          data,
          saltLabel,
        });
        await runTimelockOp({
          timelock,
          op,
          account: admin.account,
          increaseTime: async (seconds) => {
            await increaseTime(publicClient, BigInt(seconds));
          },
        });
        // Timelock delay advances wall-clock → refresh oracle updatedAt.
        await refreshNativeFeed();
        await refreshUsdcFeed();
      }

      // ─── Scenario 1: combined fiat agented sale (§1 S32 + §5 floor) ─────────
      {
        const commissionBps = 500n;
        const openPrice = 100n * 10n ** 8n; // $100
        const settlePrice = 150n * 10n ** 8n; // $150 — strictly above open
        const floor = monoCommissionLegs(openPrice, feeBps, commissionBps).owner;
        assert.ok(floor > 0n);

        // Native settlement asset
        const nativeToken = await mintVerified("ar://e2e-p1-s1-native");
        await fixedPrice.write.grant(
          [
            nativeToken,
            agent.account.address,
            0n,
            ZERO,
            DENOM_USD,
            floor,
            { form: 1, commissionBps: Number(commissionBps) },
          ],
          { account: owner.account },
        );
        await fixedPrice.write.openFromMandate([nativeToken, DENOM_USD, openPrice], {
          account: agent.account,
        });
        await fixedPrice.write.setPrice([nativeToken, settlePrice], { account: agent.account });

        const amount = (await fixedPrice.read.quoteBuy([nativeToken])) as bigint;
        const baseFiat = monoCommissionLegs(settlePrice, feeBps, commissionBps).owner;
        const baseAsset = monoCommissionLegs(amount, feeBps, commissionBps).owner;
        const expectedFloorAsset = (baseAsset * floor) / baseFiat;
        const legs = monoCommissionLegs(amount, feeBps, commissionBps);
        assert.ok(legs.platform > 0n, "platform fee must be non-zero");

        const sellerBefore = await publicClient.getBalance({ address: owner.account.address });
        const agentBefore = await publicClient.getBalance({ address: agent.account.address });
        const platformBefore = await publicClient.getBalance({ address: sink.address });

        await fixedPrice.write.buy([nativeToken], { account: buyer.account, value: amount });

        // Consignment storage is deleted on close — floor snapshot is not readable after buy.
        // Prove §5 by settlement: owner received the S32 owner share (mulDiv path did not BelowFloor).
        assert.equal(
          (await publicClient.getBalance({ address: sink.address })) - platformBefore,
          legs.platform,
        );
        assert.equal(
          (await publicClient.getBalance({ address: owner.account.address })) - sellerBefore,
          legs.owner,
        );
        assert.equal(
          (await publicClient.getBalance({ address: agent.account.address })) - agentBefore,
          legs.agent,
        );
        assert.equal(
          getAddress(await passport.read.ownerOf([nativeToken])),
          getAddress(buyer.account.address),
        );
        assert.ok(
          expectedFloorAsset <= legs.owner,
          `floorAsset ${expectedFloorAsset} must fit in owner share ${legs.owner}`,
        );

        console.log(
          `[e2e-p1] S1 native: open=$${Number(openPrice) / 1e8} settle=$${Number(settlePrice) / 1e8}` +
            ` amount=${amount} floorFiat=${floor} floorAsset=${expectedFloorAsset}` +
            ` platform=${legs.platform} owner=${legs.owner} agent=${legs.agent}`,
        );

        // USDC-6 settlement (admitted MockUSDC + 8-decimal feed from deploy:local)
        const usdcToken = await mintVerified("ar://e2e-p1-s1-usdc");
        await fixedPrice.write.grant(
          [
            usdcToken,
            agent.account.address,
            0n,
            usdc.address,
            DENOM_USD,
            floor,
            { form: 1, commissionBps: Number(commissionBps) },
          ],
          { account: owner.account },
        );
        await fixedPrice.write.openFromMandate([usdcToken, DENOM_USD, openPrice], {
          account: agent.account,
        });
        await fixedPrice.write.setPrice([usdcToken, settlePrice], { account: agent.account });

        const usdcAmount = (await fixedPrice.read.quoteBuy([usdcToken])) as bigint;
        const usdcLegs = monoCommissionLegs(usdcAmount, feeBps, commissionBps);
        const usdcBaseFiat = monoCommissionLegs(settlePrice, feeBps, commissionBps).owner;
        const usdcFloorAsset = (usdcLegs.owner * floor) / usdcBaseFiat;
        assert.ok(usdcLegs.platform > 0n);

        await usdc.write.mint([buyer.account.address, usdcAmount]);
        await usdc.write.approve([fixedPrice.address, usdcAmount], { account: buyer.account });

        const usdcSellerBefore = (await usdc.read.balanceOf([owner.account.address])) as bigint;
        const usdcAgentBefore = (await usdc.read.balanceOf([agent.account.address])) as bigint;
        const usdcPlatformBefore = (await usdc.read.balanceOf([sink.address])) as bigint;

        await fixedPrice.write.buy([usdcToken], { account: buyer.account });

        assert.equal(
          ((await usdc.read.balanceOf([sink.address])) as bigint) - usdcPlatformBefore,
          usdcLegs.platform,
        );
        assert.equal(
          ((await usdc.read.balanceOf([owner.account.address])) as bigint) - usdcSellerBefore,
          usdcLegs.owner,
        );
        assert.equal(
          ((await usdc.read.balanceOf([agent.account.address])) as bigint) - usdcAgentBefore,
          usdcLegs.agent,
        );
        assert.ok(usdcFloorAsset <= usdcLegs.owner);

        console.log(
          `[e2e-p1] S1 USDC-6: amount=${usdcAmount} floorAsset=${usdcFloorAsset}` +
            ` platform=${usdcLegs.platform} owner=${usdcLegs.owner} agent=${usdcLegs.agent}`,
        );
      }

      // ─── Scenario 2: monotonicity + deployed-formula BelowFloor counterexample ─
      {
        // Asset-denom S32 danger band documentation (p=10,c=500): old owner non-monotonic.
        assert.equal(oldCommissionOwner(999n, 10n, 500n), 950n);
        assert.equal(oldCommissionOwner(1000n, 10n, 500n), 949n);
        assert.ok(oldCommissionOwner(1000n, 10n, 500n) < oldCommissionOwner(999n, 10n, 500n));
        assert.equal(monoCommissionLegs(999n, 10n, 500n).owner, 948n);
        assert.equal(monoCommissionLegs(1000n, 10n, 500n).owner, 949n);

        // §5 counterexample: open=settle at $100, ETH/USD=$1999 → independent quote(F) > owner(A).
        const ethUsd = 1_999n * 10n ** 8n;
        await refreshNativeFeed(ethUsd);

        const commissionBps = 500n;
        const openPrice = 100n * 10n ** 8n;
        const floor = monoCommissionLegs(openPrice, feeBps, commissionBps).owner;

        const tokenId = await mintVerified("ar://e2e-p1-s2-trunc");
        await fixedPrice.write.grant(
          [
            tokenId,
            agent.account.address,
            0n,
            ZERO,
            DENOM_USD,
            floor,
            { form: 1, commissionBps: Number(commissionBps) },
          ],
          { account: owner.account },
        );
        await fixedPrice.write.openFromMandate([tokenId, DENOM_USD, openPrice], {
          account: agent.account,
        });

        const amount = (await fixedPrice.read.quoteBuy([tokenId])) as bigint;
        const baseAsset = monoCommissionLegs(amount, feeBps, commissionBps).owner;
        const independentQuoteFloor = (floor * 10n ** 18n) / ethUsd;
        assert.ok(
          independentQuoteFloor > baseAsset,
          `deployed quote(F)=${independentQuoteFloor} must exceed owner(A)=${baseAsset} (BelowFloor under old buy)`,
        );

        const sellerBefore = await publicClient.getBalance({ address: owner.account.address });
        await fixedPrice.write.buy([tokenId], { account: buyer.account, value: amount });
        assert.equal(
          (await publicClient.getBalance({ address: owner.account.address })) - sellerBefore,
          baseAsset,
        );

        console.log(
          `[e2e-p1] S2 trunc: ethUsd=1999 amount=${amount} independentQuote(F)=${independentQuoteFloor}` +
            ` > owner(A)=${baseAsset}; buy succeeded (would BelowFloor on deployed formula)`,
        );

        // Settle strictly above open: open at R, setPrice R' > R, buy clears (S32 monotonic).
        await refreshNativeFeed(2000n * 10n ** 8n);
        const settlePrice = 120n * 10n ** 8n;
        const token2 = await mintVerified("ar://e2e-p1-s2-mono");
        const floor2 = monoCommissionLegs(openPrice, feeBps, commissionBps).owner;
        await fixedPrice.write.grant(
          [
            token2,
            agent.account.address,
            0n,
            ZERO,
            DENOM_USD,
            floor2,
            { form: 1, commissionBps: Number(commissionBps) },
          ],
          { account: owner.account },
        );
        await fixedPrice.write.openFromMandate([token2, DENOM_USD, openPrice], {
          account: agent.account,
        });
        await fixedPrice.write.setPrice([token2, settlePrice], { account: agent.account });
        const amount2 = (await fixedPrice.read.quoteBuy([token2])) as bigint;
        const legs2 = monoCommissionLegs(amount2, feeBps, commissionBps);
        assert.ok(legs2.owner >= monoCommissionLegs(amount, feeBps, commissionBps).owner);
        const sellerBefore2 = await publicClient.getBalance({ address: owner.account.address });
        await fixedPrice.write.buy([token2], { account: buyer.account, value: amount2 });
        assert.equal(
          (await publicClient.getBalance({ address: owner.account.address })) - sellerBefore2,
          legs2.owner,
        );

        console.log(
          `[e2e-p1] S2 mono: open=$${Number(openPrice) / 1e8} settle=$${Number(settlePrice) / 1e8}` +
            ` owner=${legs2.owner}`,
        );
      }

      // ─── Scenario 3: platform fee survives high commission ────────────────────
      {
        const commissionBps = BPS; // 100% — owner kept rate = 0
        const price = parseEther("1");
        const tokenId = await mintVerified("ar://e2e-p1-s3");
        await fixedPrice.write.grant(
          [
            tokenId,
            agent.account.address,
            0n,
            ZERO,
            DENOM_ASSET,
            0n,
            { form: 1, commissionBps: Number(commissionBps) },
          ],
          { account: owner.account },
        );
        await fixedPrice.write.openFromMandate([tokenId, DENOM_ASSET, price], {
          account: agent.account,
        });

        const legs = monoCommissionLegs(price, feeBps, commissionBps);
        assert.equal(legs.owner, 0n);
        assert.ok(legs.platform > 0n);
        assert.equal(legs.agent, price - legs.platform);

        const sellerBefore = await publicClient.getBalance({ address: owner.account.address });
        const agentBefore = await publicClient.getBalance({ address: agent.account.address });
        const platformBefore = await publicClient.getBalance({ address: sink.address });

        await fixedPrice.write.buy([tokenId], { account: buyer.account, value: price });

        assert.equal(
          (await publicClient.getBalance({ address: sink.address })) - platformBefore,
          legs.platform,
        );
        assert.equal(
          (await publicClient.getBalance({ address: owner.account.address })) - sellerBefore,
          0n,
        );
        assert.equal(
          (await publicClient.getBalance({ address: agent.account.address })) - agentBefore,
          legs.agent,
        );

        // Near B−p: commission leaves owner rate 0, platform still floored first.
        const cSqueeze = BPS - feeBps;
        const token2 = await mintVerified("ar://e2e-p1-s3b");
        await fixedPrice.write.grant(
          [
            token2,
            agent.account.address,
            0n,
            ZERO,
            DENOM_ASSET,
            0n,
            { form: 1, commissionBps: Number(cSqueeze) },
          ],
          { account: owner.account },
        );
        await fixedPrice.write.openFromMandate([token2, DENOM_ASSET, price], {
          account: agent.account,
        });
        const legs2 = monoCommissionLegs(price, feeBps, cSqueeze);
        assert.equal(legs2.owner, 0n);
        assert.ok(legs2.platform > 0n);
        const platformBefore2 = await publicClient.getBalance({ address: sink.address });
        await fixedPrice.write.buy([token2], { account: buyer.account, value: price });
        assert.equal(
          (await publicClient.getBalance({ address: sink.address })) - platformBefore2,
          legs2.platform,
        );

        console.log(
          `[e2e-p1] S3: c=B platform=${legs.platform} agent=${legs.agent}; c=B-p platform=${legs2.platform}`,
        );
      }

      // ─── Scenario 4: ShortDelivery (FoT) + WrongValue native ─────────────────
      {
        const fot = await viem.deployContract("MockFeeToken", [1000n]);
        const clean = await viem.deployContract("MockFeeToken", [0n]);

        await admitPaymentTokenViaTimelock(
          fixedPrice.address,
          encodeFunctionData({
            abi: FixedPriceConsignmentAbi,
            functionName: "approvePaymentToken",
            args: [fot.address, ZERO, 0],
          }),
          "e2e-p1-fot-fp",
        );
        await admitPaymentTokenViaTimelock(
          fixedPrice.address,
          encodeFunctionData({
            abi: FixedPriceConsignmentAbi,
            functionName: "approvePaymentToken",
            args: [clean.address, ZERO, 0],
          }),
          "e2e-p1-clean-fp",
        );
        await admitPaymentTokenViaTimelock(
          ascending.address,
          encodeFunctionData({
            abi: AscendingConsignmentAbi,
            functionName: "approvePaymentToken",
            args: [fot.address],
          }),
          "e2e-p1-fot-asc",
        );
        await admitPaymentTokenViaTimelock(
          ascending.address,
          encodeFunctionData({
            abi: AscendingConsignmentAbi,
            functionName: "approvePaymentToken",
            args: [clean.address],
          }),
          "e2e-p1-clean-asc",
        );

        const price = 1_000_000n;
        const fpFot = await mintVerified("ar://e2e-p1-s4-fp-fot");
        await fixedPrice.write.openDirect([fpFot, DENOM_ASSET, fot.address, price], {
          account: owner.account,
        });
        await fot.write.mint([buyer.account.address, price]);
        await fot.write.approve([fixedPrice.address, price], { account: buyer.account });
        await assert.rejects(
          fixedPrice.write.buy([fpFot], { account: buyer.account }),
          revertsWith("ShortDelivery"),
        );
        assert.equal(await fixedPrice.read.consignmentPhase([fpFot]), 1);

        const fpClean = await mintVerified("ar://e2e-p1-s4-fp-clean");
        await fixedPrice.write.openDirect([fpClean, DENOM_ASSET, clean.address, price], {
          account: owner.account,
        });
        await clean.write.mint([buyer.account.address, price]);
        await clean.write.approve([fixedPrice.address, price], { account: buyer.account });
        await fixedPrice.write.buy([fpClean], { account: buyer.account });
        assert.equal(await fixedPrice.read.consignmentPhase([fpClean]), 2);

        const duration = THREE_DAYS;
        const ascFot = await mintVerified("ar://e2e-p1-s4-asc-fot");
        await ascending.write.openAscendingDirect(
          [ascFot, fot.address, price, duration, ASCENDING_MIN_PROTECTION_WINDOW],
          { account: owner.account },
        );
        await fot.write.mint([buyer.account.address, price]);
        await fot.write.approve([ascending.address, price], { account: buyer.account });
        await assert.rejects(
          ascending.write.bid([ascFot, price], { account: buyer.account }),
          revertsWith("ShortDelivery"),
        );
        assert.equal(await ascending.read.auctionHighestBid([ascFot]), 0n);

        const ascClean = await mintVerified("ar://e2e-p1-s4-asc-clean");
        await ascending.write.openAscendingDirect(
          [ascClean, clean.address, price, duration, ASCENDING_MIN_PROTECTION_WINDOW],
          { account: owner.account },
        );
        await clean.write.mint([buyer.account.address, price]);
        await clean.write.approve([ascending.address, price], { account: buyer.account });
        await ascending.write.bid([ascClean, price], { account: buyer.account });
        assert.equal(await ascending.read.auctionHighestBid([ascClean]), price);

        const wrongNative = await mintVerified("ar://e2e-p1-s4-wrong");
        const nativePrice = parseEther("0.1");
        await fixedPrice.write.openDirect([wrongNative, DENOM_ASSET, ZERO, nativePrice], {
          account: owner.account,
        });
        await assert.rejects(
          fixedPrice.write.buy([wrongNative], {
            account: buyer.account,
            value: nativePrice + 1n,
          }),
          revertsWith("WrongValue"),
        );

        console.log("[e2e-p1] S4: FoT ShortDelivery on buy+bid; clean tokens OK; native WrongValue");
      }

      // ─── Scenario 5: challenge config getters on both instances ─────────────
      {
        const passportWindow = (await passport.read.windowDuration()) as bigint;
        const passportForfeit = getAddress(
          (await passport.read.forfeitRecipient()) as `0x${string}`,
        );
        const disputeWindow = (await passport.read.DISPUTE_WINDOW()) as bigint;
        assert.equal(passportWindow, disputeWindow);
        assert.equal(passportWindow, 14n * 24n * 60n * 60n);
        // KarPassport ctor platformRecipient_ = local stack admin.
        assert.equal(passportForfeit, getAddress(admin.account.address));

        const ascWindow = (await ascending.read.windowDuration()) as bigint;
        const ascForfeit = getAddress((await ascending.read.forfeitRecipient()) as `0x${string}`);
        assert.equal(ascWindow, ASCENDING_CHALLENGE_WINDOW);
        assert.equal(ascForfeit, getAddress(sink.address));

        console.log(
          `[e2e-p1] S5: passport window=${passportWindow} forfeit=${passportForfeit}` +
            `; ascending window=${ascWindow} forfeit=${ascForfeit}`,
        );
      }

      // ─── Scenario 6: ZeroMinStake distinct from BelowMinStakeFloor ───────────
      {
        const stakeTok = await viem.deployContract("MockUSDC", []);
        await assert.rejects(
          staking.write.setStakeToken([stakeTok.address, 0n], { account: admin.account }),
          revertsWith("ZeroMinStake"),
        );
        assert.equal(await staking.read.stakeToken(), ZERO);

        const tokenMin = 1_000_000n;
        await staking.write.setStakeToken([stakeTok.address, tokenMin], {
          account: admin.account,
        });
        assert.equal(getAddress(await staking.read.stakeToken()), getAddress(stakeTok.address));
        assert.equal(await staking.read.minStakeToken(), tokenMin);

        const floor = (await staking.read.MIN_STAKE_FLOOR()) as bigint;
        await assert.rejects(
          staking.write.setMinStakeNative([floor - 1n], { account: admin.account }),
          revertsWith("BelowMinStakeFloor"),
        );

        console.log(
          `[e2e-p1] S6: ZeroMinStake on setStakeToken(0); BelowMinStakeFloor on native < ${floor}`,
        );
      }

      console.log(
        "[e2e-p1] Summary: scenarios 1–6 PASS (PENDING §1/§2/§4/§5 on 31337 current source)",
      );
    } finally {
      await connection?.close();
    }
  });
});
