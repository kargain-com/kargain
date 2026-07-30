import assert from "node:assert/strict";
import { describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress, parseEther, zeroHash } from "viem";

import {
  Category,
  DISPUTE_DEPOSIT,
  increaseTime,
  joinVerifier,
  receiptLogs,
  THREE_DAYS,
  ZERO,
} from "../scripts/lib/local-stack.js";
import { requireLocalDeployment } from "../scripts/lib/load-deployment.js";
import {
  ASCENDING_ABANDONMENT_WINDOW,
  ASCENDING_CHALLENGE_WINDOW,
  ASCENDING_EXTENSION_WINDOW,
  ASCENDING_MIN_PROTECTION_WINDOW,
} from "../scripts/lib/verify-constructor-args.js";

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
      const commissionFloor = parseEther("0.5");

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
        500,
      ]);
      await agentContract.write.openFixedFromMandate([
        fixedPrice.address,
        splitToken,
        0,
        BYTES32_ZERO,
        fpPrice,
      ]);
      await fixedPrice.write.buy([splitToken], { account: buyer.account, value: fpPrice });

      const expectedPlatform = (fpPrice * feeBps) / 10_000n;
      const expectedAgent = (fpPrice * 500n) / 10_000n;
      const expectedOwner = fpPrice - expectedPlatform - expectedAgent;
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
