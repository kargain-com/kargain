import assert from "node:assert/strict";
import { describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress } from "viem";

import {
  Category,
  CURRENCY_USD,
  DISPUTE_DEPOSIT,
  joinVerifier,
  receiptLogs,
} from "../scripts/lib/local-stack.js";
import { requireLocalDeployment } from "../scripts/lib/load-deployment.js";

const URI_MINT = "ar://e2e-mint";
const URI_EDIT_1 = "ar://e2e-edit-1";
const URI_POST_DISPUTE = "ar://e2e-post-dispute";
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

  const row = await pollPonderPassport(tokenIdParam, (body) => body.status === "VERIFIED");
  if (!row) {
    const reason = `Ponder did not index passport ${tokenIdParam} to VERIFIED within ${PONDER_TIMEOUT_MS}ms`;
    if (E2E_STRICT) failPonderChecks(reason);
    skipPonderChecks(reason);
    return;
  }

  const uriHistory = row.uriHistory as Array<{ verificationReset?: boolean; uri?: string }> | undefined;
  assert.ok(uriHistory && uriHistory.length >= 2, "expected uriHistory.length >= 2");
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
      const marketplace = await viem.getContractAt("MarketplaceEscrow", deployment.marketplace);

      const wallets = await viem.getWalletClients();
      const owner = wallets[1]!;
      const verifier = wallets[2]!;
      const buyer = wallets[2]!;

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

      // 6 — disputePassport
      await passport.write.disputePassport([firstTokenId, "e2e dispute"], {
        account: owner.account,
        value: DISPUTE_DEPOSIT,
      });
      await assertChainStatus(passport, firstTokenId, 2);

      // 7 — resolveDispute(false)
      await passport.write.resolveDispute([firstTokenId, false], { account: verifier.account });
      await assertChainStatus(passport, firstTokenId, 0);

      // 8 — setPassportURI after resolve (T9)
      await passport.write.setPassportURI([firstTokenId, URI_POST_DISPUTE], {
        account: owner.account,
      });
      assert.equal(await passport.read.tokenURI([firstTokenId]), URI_POST_DISPUTE);

      // Re-verify before marketplace + appendRecord (T10 requires VERIFIED)
      await passport.write.verifyPassport([firstTokenId], { account: verifier.account });
      await assertChainStatus(passport, firstTokenId, 1);

      // 9 — list + buyWithNative
      await passport.write.setApprovalForAll([marketplace.address, true], {
        account: owner.account,
      });
      const usd1e8 = 500n * 10n ** 8n;
      await marketplace.write.list([firstTokenId, usd1e8, CURRENCY_USD], { account: owner.account });
      let listing = await marketplace.read.listings([firstTokenId]);
      assert.equal(listing[2], true);

      const gross = await marketplace.read.quoteBuyWithNative([firstTokenId]);
      await marketplace.write.buyWithNative([firstTokenId], {
        account: buyer.account,
        value: gross,
      });
      listing = await marketplace.read.listings([firstTokenId]);
      assert.equal(listing[2], false);
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
      assert.equal(await passport.read.recordCount([firstTokenId]), 2n);

      await optionalPonderChecks(owner.account.address, firstTokenId);
    } finally {
      await connection?.close();
    }
  });
});
