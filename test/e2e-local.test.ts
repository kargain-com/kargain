import assert from "node:assert/strict";
import { describe, it } from "node:test";
import hardhat from "hardhat";
import { getAddress } from "viem";

import {
  Category,
  joinVerifier,
  receiptLogs,
} from "../scripts/lib/local-stack.js";
import { requireLocalDeployment } from "../scripts/lib/load-deployment.js";

const TOKEN_ID = 0n;
const URI_MINT = "ar://e2e-mint";
const URI_EDIT_1 = "ar://e2e-edit-1";
const URI_POST_DISPUTE = "ar://e2e-post-dispute";
const PONDER_URL = process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";
const PONDER_POLL_MS = 1500;
const PONDER_TIMEOUT_MS = 60_000;

type NetworkConnection = Awaited<ReturnType<typeof hardhat.network.connect>>;

async function assertChainStatus(
  passport: { read: { getPassportStatus: (args: [bigint]) => Promise<[number, string, bigint]> } },
  expected: number,
) {
  const [status] = await passport.read.getPassportStatus([TOKEN_ID]);
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

async function optionalPonderChecks(ownerAddress: string) {
  let ponderAvailable = false;
  try {
    const res = await fetch(`${PONDER_URL}/passports/${TOKEN_ID}`);
    ponderAvailable = res.status !== 404 || res.ok;
  } catch {
    console.log("[e2e] Ponder API unreachable — skipping indexer assertions");
    return;
  }

  if (!ponderAvailable) {
    console.log("[e2e] Ponder API unavailable — skipping indexer assertions");
    return;
  }

  const row = await pollPonderPassport(String(TOKEN_ID), (body) => body.status === "VERIFIED");
  if (!row) {
    console.log("[e2e] Ponder did not reach VERIFIED in time — skipping detailed checks");
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
      assert.equal(await passport.read.nextTokenId(), 1n);
      await assertChainStatus(passport, 0);

      // 3 — verifyPassport
      await passport.write.verifyPassport([TOKEN_ID], { account: verifier.account });
      await assertChainStatus(passport, 1);

      // 4 — setPassportURI → VerificationReset
      const resetHash = await passport.write.setPassportURI([TOKEN_ID, URI_EDIT_1], {
        account: owner.account,
      });
      const resetLogs = await receiptLogs(publicClient, resetHash, passport.abi);
      assert.ok(resetLogs.some((l) => l.eventName === "VerificationReset"));
      await assertChainStatus(passport, 0);
      assert.equal(await passport.read.tokenURI([TOKEN_ID]), URI_EDIT_1);

      // 5 — verify again
      await passport.write.verifyPassport([TOKEN_ID], { account: verifier.account });
      await assertChainStatus(passport, 1);

      // 6 — disputePassport
      await passport.write.disputePassport([TOKEN_ID, "e2e dispute"], {
        account: owner.account,
      });
      await assertChainStatus(passport, 2);

      // 7 — resolveDispute(false)
      await passport.write.resolveDispute([TOKEN_ID, false], { account: verifier.account });
      await assertChainStatus(passport, 0);

      // 8 — setPassportURI after resolve (T9)
      await passport.write.setPassportURI([TOKEN_ID, URI_POST_DISPUTE], {
        account: owner.account,
      });
      assert.equal(await passport.read.tokenURI([TOKEN_ID]), URI_POST_DISPUTE);

      // Re-verify before marketplace + appendRecord (T10 requires VERIFIED)
      await passport.write.verifyPassport([TOKEN_ID], { account: verifier.account });
      await assertChainStatus(passport, 1);

      // 9 — list + buyWithNative
      await passport.write.setApprovalForAll([marketplace.address, true], {
        account: owner.account,
      });
      const usd1e8 = 500n * 10n ** 8n;
      await marketplace.write.list([TOKEN_ID, usd1e8, 0], { account: owner.account });
      let listing = await marketplace.read.listings([TOKEN_ID]);
      assert.equal(listing[3], true);

      const gross = await marketplace.read.quoteNativeWei([TOKEN_ID]);
      await marketplace.write.buyWithNative([TOKEN_ID], {
        account: buyer.account,
        value: gross,
      });
      listing = await marketplace.read.listings([TOKEN_ID]);
      assert.equal(listing[3], false);
      assert.equal(
        getAddress(await passport.read.ownerOf([TOKEN_ID])),
        getAddress(buyer.account.address),
      );

      // 10 — appendRecord on VERIFIED (T10 — status unchanged)
      await passport.write.appendRecord(
        [TOKEN_ID, "service", "E2E oil change", "ar://e2e-record"],
        { account: buyer.account },
      );
      await assertChainStatus(passport, 1);
      assert.equal(await passport.read.recordCount([TOKEN_ID]), 2n);

      await optionalPonderChecks(owner.account.address);
    } finally {
      await connection?.close();
    }
  });
});
