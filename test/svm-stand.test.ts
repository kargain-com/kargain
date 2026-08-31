/**
 * S3 local cross-VM stand — host simulation always; live Core CPI when LIVE=1.
 *
 * Host (default): dumb relay + both-direction payload path (no Hardhat / no validator).
 * Live (`KARGAIN_SVM_STAND_LIVE=1`): require local validator; fail if Core CPI round-trip fails.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertPayloadUnchanged,
  relayCopyPayload,
} from "../svm/stand/dumb-relay.ts";
import {
  assertClearBeforeState,
  refuseReceiveCorruptedCompose,
  refuseReceiveWithoutCompose,
  runBothDirectionHostRoundTrip,
} from "../svm/stand/host-sim.ts";
import {
  STAND_EVM_NAMESPACE,
  STAND_SVM_NAMESPACE,
} from "../svm/stand/constants.ts";
import {
  probeValidator,
  runLiveSvmRoundTrip,
} from "../svm/stand/live-roundtrip.ts";
import { runLiveVerifierFlow } from "../svm/stand/live-verifier-flow.ts";
import {
  probeValidator as probeMoneyValidator,
  runLiveMoneyPayoutProof,
} from "../svm/stand/live-money-payout.ts";
import {
  probeValidator as probeConsignmentValidator,
  runLiveConsignmentAutomaton,
} from "../svm/stand/live-consignment-automaton.ts";
import {
  probeValidator as probeFixedPriceValidator,
  runLiveFixedPrice,
} from "../svm/stand/live-fixed-price.ts";
import { testnetMinStakeLamports } from "../lib/web3/min-stake-sol.ts";

const LIVE = process.env.KARGAIN_SVM_STAND_LIVE === "1";
const LIVE_EVM = process.env.KARGAIN_SVM_STAND_EVM === "1";

describe("svm-stand host simulation", () => {
  it("dumb relay copies payload bytes without mutation", () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const packet = {
      srcEid: 1,
      dstEid: 40168,
      sender: new Uint8Array(32).fill(9),
      nonce: 1n,
      guid: new Uint8Array(32).fill(8),
      payload,
    };
    const out = relayCopyPayload(packet);
    assertPayloadUnchanged(packet.payload, out.payload);
    out.payload[0] = 99;
    assert.equal(packet.payload[0], 1, "source buffer must stay intact");
  });

  it("clear-before-state refuses state-first", () => {
    assert.throws(() => assertClearBeforeState(["state"]), /before endpoint clear/);
    assert.throws(() => assertClearBeforeState([]), /missing endpoint clear/);
    assertClearBeforeState(["cleared", "state"]);
  });

  it("receive fail-closed without compose and on corrupted compose", () => {
    const a = refuseReceiveWithoutCompose(STAND_SVM_NAMESPACE);
    assert.equal(a.error, "ComposeRequired");
    const b = refuseReceiveCorruptedCompose(STAND_SVM_NAMESPACE);
    assert.equal(b.error, "ComposeUndecodable");
  });

  it("both-direction round trip: trust reset, URI travels, records stay", () => {
    const result = runBothDirectionHostRoundTrip({ priorHomeStatus: "VERIFIED" });
    assert.equal(result.verificationResetOnReturn, true);

    const mint = result.steps.find((s) => s.name === "mint_home_evm")!;
    assert.equal(mint.evm.status, "UNVERIFIED");
    assert.equal(mint.evm.recordCount, 1);

    const foreign = result.steps.find((s) => s.name === "receive_svm_mint_foreign")!;
    assert.equal(foreign.svm.status, "UNVERIFIED");
    assert.equal(foreign.svm.uri, mint.evm.uri);
    assert.equal(foreign.clearBeforeState, true);
    // Home remains locked on EVM while abroad
    assert.equal(foreign.evm.custodyLocked, true);
    assert.equal(foreign.evm.status, "VERIFIED");

    const afterNote = result.steps.find((s) => s.name === "svm_local_record")!;
    assert.equal(afterNote.svm.recordCount, 1);
    assert.equal(afterNote.evm.recordCount, 2); // mint + verify stayed on EVM

    const unlocked = result.steps.find((s) => s.name === "receive_evm_unlock_home")!;
    assert.equal(unlocked.evm.status, "UNVERIFIED");
    assert.equal(unlocked.evm.custodyLocked, false);
    assert.equal(unlocked.svm.burned, true);
    assert.equal(unlocked.svm.recordCount, 1);
    assert.equal(unlocked.evm.recordCount, 2);

    assert.ok(result.outboundPayload.length > 64);
    assert.ok(result.returnPayload.length > 64);
  });

  it("return from never-verified home does not claim VerificationReset", () => {
    const result = runBothDirectionHostRoundTrip({ priorHomeStatus: "UNVERIFIED" });
    assert.equal(result.verificationResetOnReturn, false);
    const unlocked = result.steps.find((s) => s.name === "receive_evm_unlock_home")!;
    assert.equal(unlocked.evm.status, "UNVERIFIED");
  });

  it("namespaces distinguish home vs foreign receive kinds", () => {
    const result = runBothDirectionHostRoundTrip();
    assert.notEqual(STAND_EVM_NAMESPACE, STAND_SVM_NAMESPACE);
    const foreign = result.steps.find((s) => s.name === "receive_svm_mint_foreign")!;
    assert.equal(foreign.svm.assetExists, true);
    const unlocked = result.steps.find((s) => s.name === "receive_evm_unlock_home")!;
    assert.equal(unlocked.evm.assetExists, true);
  });
});

describe("svm-stand live Core CPI round trip", () => {
  it(
    LIVE
      ? "EVM-wire ONFT → SVM mint + home lock/unlock via Core CPI"
      : "live path skipped (set KARGAIN_SVM_STAND_LIVE=1 + ./svm/stand/start-validator.sh)",
    { skip: !LIVE },
    async () => {
      const ready = await probeValidator("http://127.0.0.1:8899");
      if (!ready) {
        throw new Error(
          "KARGAIN_SVM_STAND_LIVE=1 but solana-test-validator not reachable at 127.0.0.1:8899 — start ./svm/stand/start-validator.sh",
        );
      }

      const result = await runLiveSvmRoundTrip();
      assert.equal(result.relayIdentityOk, true);
      assert.equal(result.foreignAssetLive, true);
      assert.equal(result.homeUnlocked, true);
      assert.equal(result.homeStatusAfterUnlock, 0, "UNVERIFIED after unlock");
      assert.equal(result.uriTravelled, true);
      assert.ok(
        result.foreignMintCu == null || result.foreignMintCu > 0,
        "receive-shaped CU should be measured when available",
      );
      assert.ok(
        result.foreignMintTxSize != null && result.foreignMintTxSize > 0,
        "foreign-mint tx size should be measured",
      );
      assert.ok(
        result.foreignMintTxSize! <= 1232,
        `mock foreign-mint tx ${result.foreignMintTxSize} must fit Solana packet 1232`,
      );
      console.warn(
        `\n[svm-stand] live PASS uri=${result.liveUriLen}B foreignMintCu=${result.foreignMintCu} foreignMintTxSize=${result.foreignMintTxSize} (mock 13-meta) homeUnlockCu=${result.homeUnlockCu}\n`,
      );

      const verifier = await runLiveVerifierFlow({ reuseInited: true });
      assert.equal(verifier.joined, true);
      assert.equal(verifier.verified, true);
      assert.equal(verifier.left, true);
      assert.equal(verifier.passClosed, true);
      assert.equal(verifier.claimed, true);
      assert.equal(
        verifier.claimedAmount,
        testnetMinStakeLamports(),
        "claimed principal must equal stated min stake (from stake record)",
      );
      assert.equal(
        verifier.minStakePin.solLamports,
        testnetMinStakeLamports().toString(),
      );
      console.warn(
        `\n[svm-stand] verifier PASS joinCu=${verifier.joinCu} verifyCu=${verifier.verifyCu} ` +
          `claimed=${verifier.claimedAmount} minStake=${verifier.minStakePin.solLamports} lamports\n`,
      );

      const moneyReady = await probeMoneyValidator("http://127.0.0.1:8899");
      if (!moneyReady) {
        throw new Error("validator lost health before money payout proof");
      }
      const money = await runLiveMoneyPayoutProof();
      assert.equal(money.absentCase.settled, true);
      assert.equal(money.absentCase.claimAmount, 700n);
      assert.equal(money.absentCase.withdrawn, 700n);
      assert.equal(money.frozenCase.inboundBlocked, true);
      assert.equal(money.frozenCase.claimAmount, 500n);
      assert.equal(money.frozenCase.withdrawn, 500n);
      console.warn(
        `\n[svm-stand] money-payout PASS absent→claim→withdraw; frozen→claim→withdraw (inbound 0x11)\n`,
      );

      const consignReady = await probeConsignmentValidator("http://127.0.0.1:8899");
      if (!consignReady) {
        throw new Error("validator lost health before consignment automaton proof");
      }
      const consign = await runLiveConsignmentAutomaton();
      assert.equal(consign.mandateOpen.phase, 1, "Offered");
      assert.equal(consign.mandateOpen.floor, 700n);
      assert.equal(consign.mandateOpen.feeBps, 250);
      assert.equal(consign.setPriceOk, 1200n);
      assert.equal(consign.refusals.belowFloor, 57);
      assert.equal(consign.refusals.cannotRaiseFloor, 86);
      assert.equal(consign.refusals.cooldown, 94);
      assert.equal(consign.recallForce.phase, 3, "Returned");
      assert.equal(consign.settle.phase, 2, "Closed");
      assert.equal(consign.settle.platformDelta, 25n);
      assert.equal(consign.settle.sellerDelta, 700n);
      assert.equal(consign.settle.agentDelta, 275n);
      assert.equal(
        consign.settle.platformDelta + consign.settle.sellerDelta + consign.settle.agentDelta,
        consign.settle.settled,
      );
      console.warn(
        `\n[svm-stand] consignment-automaton PASS open/mandate/amend/concessions/recall/settle ` +
          `P=${consign.settle.platformDelta} O=${consign.settle.sellerDelta} A=${consign.settle.agentDelta}\n`,
      );

      const fpReady = await probeFixedPriceValidator("http://127.0.0.1:8899");
      if (!fpReady) {
        throw new Error("validator lost health before FixedPrice proof");
      }
      const fp = await runLiveFixedPrice();
      assert.equal(fp.nativeBuy.phase, 2, "Closed");
      assert.equal(fp.nativeBuy.platformDelta, 25n);
      assert.equal(fp.nativeBuy.sellerDelta, 975n);
      assert.equal(
        fp.nativeBuy.platformDelta + fp.nativeBuy.sellerDelta + fp.nativeBuy.agentDelta,
        fp.nativeBuy.price,
      );
      assert.equal(fp.fiatRefuseCode, 101);
      assert.equal(fp.external.platformDelta, 0n);
      assert.equal(fp.external.sellerDelta, 0n);
      assert.equal(fp.external.escrowDelta, 0n);
      assert.equal(fp.pauseOpenCode, 76);
      assert.equal(fp.pauseBuyCode, 76);
      assert.equal(fp.pauseExternalPhase, 2);
      assert.equal(fp.softRevokeBuyPhase, 2);
      assert.equal(fp.admittedDecimals, fp.chainMintDecimals);
      assert.equal(fp.transferFeeRefuseCode, 69);
      console.warn(
        `\n[svm-stand] fixed-price PASS native buy / fiat refuse / external / pause / soft-revoke / admit-prove / TransferFee refuse\n`,
      );

      if (LIVE_EVM) {
        const evm = await probeHardhat("http://127.0.0.1:8545");
        if (!evm) {
          throw new Error(
            "KARGAIN_SVM_STAND_EVM=1 but Hardhat node not at 127.0.0.1:8545",
          );
        }
        console.warn(
          "[svm-stand] Hardhat reachable — dual EndpointV2Mock coverage: test/KarPassportBridgeGateway.test.ts",
        );
      }
    },
  );
});

async function probeHardhat(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
