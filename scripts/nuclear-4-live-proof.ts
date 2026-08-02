/**
 * Nuclear #4 Phase F spot-check on Base Sepolia (empty-testnet).
 * Mint → FixedPrice open UNVERIFIED succeeds; Ascending open UNVERIFIED reverts PassportNotVerified.
 * Loads keys via hardhat dotenv only — never logs secrets.
 */
import { parseEventLogs, zeroAddress } from "viem";

import { KarPassportAbi } from "../lib/contracts/abis.generated.ts";
import { requireCommercialActive } from "../lib/web3/commercial-active.ts";

async function main() {
  const hardhat = (await import("hardhat")).default;
  const connection = await hardhat.network.connect();
  const viem = connection.viem;
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  if (chainId !== 84532) {
    throw new Error(`Expected baseSepolia 84532, got ${chainId}`);
  }

  const stack = requireCommercialActive(84532);
  const [wallet] = await viem.getWalletClients();
  const account = wallet.account;
  if (!account) throw new Error("No wallet account");

  const passport = await viem.getContractAt("KarPassport", stack.karPassport);
  const fixedPrice = await viem.getContractAt(
    "FixedPriceConsignment",
    stack.fixedPriceConsignment!,
  );
  const ascending = await viem.getContractAt(
    "AscendingConsignment",
    stack.ascendingConsignment!,
  );

  // One-shot operator approval for both modes (survives getApproved races).
  const forAllFp = await passport.read.isApprovedForAll([
    account.address,
    stack.fixedPriceConsignment!,
  ]);
  if (!forAllFp) {
    const h = await passport.write.setApprovalForAll([stack.fixedPriceConsignment!, true], {
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: h });
  }
  const forAllAsc = await passport.read.isApprovedForAll([
    account.address,
    stack.ascendingConsignment!,
  ]);
  if (!forAllAsc) {
    const h = await passport.write.setApprovalForAll([stack.ascendingConsignment!, true], {
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: h });
  }

  const mintHash = await passport.write.mintPassport([account.address, "ar://nuclear-4-proof"], {
    account,
  });
  const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash });
  const minted = parseEventLogs({
    abi: KarPassportAbi,
    eventName: "PassportMinted",
    logs: mintReceipt.logs,
  });
  if (minted.length === 0) throw new Error("PassportMinted not found");
  const tokenId = minted[0]!.args.tokenId as bigint;
  const status = await passport.read.passportStatus([tokenId]);
  if (status !== 0) throw new Error(`Expected UNVERIFIED(0), got ${status}`);

  const mayOpen = await passport.read.may([tokenId, 1]); // OpenConsignment
  if (!mayOpen) throw new Error("may(OpenConsignment) false for idle UNVERIFIED");

  const denom = { kind: 0, currencyCode: ("0x" + "00".repeat(32)) as `0x${string}` };
  const openFpHash = await fixedPrice.write.openDirect(
    [tokenId, denom, zeroAddress, 10n ** 15n],
    { account },
  );
  await publicClient.waitForTransactionReceipt({ hash: openFpHash });
  console.log("PASS FixedPrice open UNVERIFIED tokenId=%s", tokenId.toString());

  const mint2Hash = await passport.write.mintPassport(
    [account.address, "ar://nuclear-4-proof-asc"],
    { account },
  );
  const mint2Receipt = await publicClient.waitForTransactionReceipt({ hash: mint2Hash });
  const minted2 = parseEventLogs({
    abi: KarPassportAbi,
    eventName: "PassportMinted",
    logs: mint2Receipt.logs,
  });
  const tokenId2 = minted2[0]!.args.tokenId as bigint;

  const staking = await viem.getContractAt("KarProStaking", stack.karProStaking);
  const active = await staking.read.isActiveVerifier([account.address]);
  if (!active) {
    const minStake = await staking.read.minStakeNative();
    const joinHash = await staking.write.becomeVerifierNative(
      [1, "Nuclear4Proof", "ar://nuclear-4-pro"],
      { account, value: minStake },
    );
    await publicClient.waitForTransactionReceipt({ hash: joinHash });
    console.log("joined KarPro for ascending open path");
  }

  let reverted = false;
  try {
    await publicClient.simulateContract({
      account: account.address,
      address: stack.ascendingConsignment!,
      abi: ascending.abi,
      functionName: "openAscendingDirect",
      args: [
        tokenId2,
        zeroAddress,
        10n ** 15n,
        3 * 24 * 60 * 60,
        14 * 24 * 60 * 60,
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("PassportNotVerified")) {
      reverted = true;
      console.log("PASS Ascending open UNVERIFIED → PassportNotVerified");
    } else {
      throw err;
    }
  }
  if (!reverted) throw new Error("Ascending open UNVERIFIED did not revert PassportNotVerified");

  console.log("Nuclear #4 Phase F spot-check: 2/2 PASS on 84532");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
