/**
 * §7.2 U6.7.2 — passport WithdrawChallenge write owner + claim-outcome disclosure:
 * EVM withdraw+[tid] no value; SVM eight metas + fresh recordCount; Claims only on EVM.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AccountRole, getBase58Decoder } from "@solana/kit";

import {
  challengeBondDisclosure,
  CHALLENGE_BOND_EVM_CLAIM_SUCCESS,
  CHALLENGE_BOND_WITHDRAW_RELEASED,
} from "@/lib/passport/challenge-bond-disclosure";
import {
  assembleWithdrawChallengeAccounts,
  buildEvmWithdrawChallengeCall,
  executeWithdrawChallenge,
  planWithdrawChallenge,
} from "@/lib/passport/withdraw-challenge";
import {
  hexToBytes,
  passportStateLayout,
} from "@/lib/svm/decode-account-state";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";
import { systemProgramId } from "@/lib/svm/foreign-programs";
import {
  commercialSvmNamespaceIds,
  requireSvmCommercialActive,
} from "@/lib/web3/commercial-active";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  vmBranchViolationInSource,
  VM_BRANCH_ALLOWLIST,
} from "./network-vm-component-policy.test.ts";
import {
  assertBindingIsSigner,
  assertBindingOrder,
  extractNextAccountBindings,
  locateEntrypointFnBody,
  readEntrypointFnBody,
  saveStateTargets,
} from "./svm-entrypoint-account-bindings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/withdraw-challenge.ts";
const DISCLOSURE_REL = "lib/passport/challenge-bond-disclosure.ts";
const PANEL_REL = "components/passport/passport-actions-panel.tsx";
const HOOK_REL = "hooks/use-withdraw-challenge.ts";
const ENTRYPOINT_REL = "svm/programs/kar-passport/src/entrypoint.rs";

const EXPECTED_WITHDRAW_BINDINGS = [
  "challenger",
  "config",
  "asset",
  "state",
  "challenge_info",
  "record",
  "system",
  "payer",
] as const;

/** PassportState.record_count starts at byte 83 (u32 LE). */
const RECORD_COUNT_OFFSET = 8 + 32 + 1 + 32 + 8 + 1 + 1;

const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));
const tokenId = "1";

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

function disclosureSource(): string {
  return readFileSync(path.join(ROOT, DISCLOSURE_REL), "utf8");
}

function panelSource(): string {
  return readFileSync(path.join(ROOT, PANEL_REL), "utf8");
}

function hookSource(): string {
  return readFileSync(path.join(ROOT, HOOK_REL), "utf8");
}

function readWithdrawChallengeBody(): string {
  return readEntrypointFnBody(ROOT, ENTRYPOINT_REL, "withdraw_challenge");
}

function stateBytesWithRecordCount(count: number): Uint8Array {
  const layout = passportStateLayout();
  const bytes = hexToBytes(layout.goldenHex);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(RECORD_COUNT_OFFSET, count >>> 0, true);
  return bytes;
}

function assertEvmWithdrawPin(
  call: {
    functionName: string;
    args: readonly unknown[];
    value?: unknown;
    chainId?: number;
  },
  expectedTokenId: string,
): void {
  assert.equal(call.functionName, "withdraw");
  assert.equal(call.args.length, 1);
  assert.equal(call.args[0], BigInt(expectedTokenId));
  assert.equal(
    "value" in call && call.value !== undefined,
    false,
    "withdraw must not carry value",
  );
  if (call.chainId != null) {
    assert.equal(call.chainId, wagmiChainId(84532));
  }
}

function assertWithdrawProcessorFacts(body: string): {
  bindings: string[];
} {
  const bindings = extractNextAccountBindings(body, 8);
  assert.equal(
    bindings.length,
    8,
    "withdraw_challenge must bind exactly eight accounts",
  );
  assertBindingOrder(
    bindings,
    EXPECTED_WITHDRAW_BINDINGS,
    "withdraw_challenge next_account_info order",
  );
  assertBindingIsSigner(
    body,
    "challenger",
    "withdraw_challenge requires challenger to be a signer",
  );
  assertBindingIsSigner(
    body,
    "payer",
    "withdraw_challenge requires payer to be a signer",
  );
  assert.match(body, /transfer_bond\s*\(/);
  assert.match(body, /append_dispute_withdrawn_record\s*\(/);
  assert.match(body, /save_challenge\s*\(/);
  const targets = saveStateTargets(body);
  assert.ok(targets.length >= 1, "withdraw_challenge must persist via save_state");
  assert.ok(
    targets.every((t) => t === "state"),
    `withdraw_challenge save_state must target state only; got ${targets.join(",")}`,
  );
  return { bindings };
}

describe("withdrawChallenge EVM pin", () => {
  it("live builder is withdraw + [tid] with no value; planted value / second arg are red", async () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmWithdrawChallengeCall({
      address,
      tokenId,
      chainId: 84532,
    });
    assertEvmWithdrawPin(live, tokenId);

    const plantedValue = {
      ...live,
      value: 1n,
    };
    assert.throws(() => {
      assertEvmWithdrawPin(plantedValue, tokenId);
    });

    const plantedTwoArgs = {
      ...live,
      args: [BigInt(tokenId), "extra"] as unknown as [bigint],
    };
    assert.throws(() => {
      assertEvmWithdrawPin(plantedTwoArgs, tokenId);
    });
    assert.equal(live.args.length, 1);

    const planned = await planWithdrawChallenge({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "evm") throw new Error("expected evm");
    assertEvmWithdrawPin(planned.call, tokenId);
  });

  it("executeWithdrawChallenge EVM passes pinned call through writeEvmContract", async () => {
    const address = karPassportAddress(84532)!;
    let captured: unknown;
    const hash = await executeWithdrawChallenge({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
      writeEvmContract: async (call) => {
        captured = call;
        return "0xabc" as `0x${string}`;
      },
    });
    assert.equal(hash, "0xabc");
    assert.ok(captured);
    assertEvmWithdrawPin(
      captured as { functionName: string; args: readonly unknown[] },
      tokenId,
    );
    assert.equal((captured as { address: string }).address, address);
    assert.equal(
      Object.prototype.hasOwnProperty.call(captured as object, "value"),
      false,
    );
  });
});

describe("withdrawChallenge SVM freshness", () => {
  it("every assembly re-reads state (fetchCount === 2)", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0, "live SVM commercial row required");
    const ns = namespaces[0]!;
    const wallet = "So11111111111111111111111111111111111111112";
    let fetchCount = 0;
    const fetchAccountData = async () => {
      fetchCount += 1;
      return { ok: true as const, value: stateBytesWithRecordCount(7) };
    };

    const first = await planWithdrawChallenge({
      account: { status: "connected", vm: "svm", address: wallet },
      chainId: ns,
      tokenId,
      fetchAccountData,
    });
    const second = await planWithdrawChallenge({
      account: { status: "connected", vm: "svm", address: wallet },
      chainId: ns,
      tokenId,
      fetchAccountData,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(fetchCount, 2, "live owner must fetch on every assembly");

    if (!first.ok || first.vm !== "svm") throw new Error("expected svm");
    if (!second.ok || second.vm !== "svm") throw new Error("expected svm");
    assert.equal(first.plan.recordCount, second.plan.recordCount);
  });

  it("count move yields distinct record PDAs; planted constant index is red", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const wallet = "So11111111111111111111111111111111111111112";
    const tokenBytes = tokenIdToBytes32(tokenId);
    let call = 0;
    const fetchAccountData = async () => {
      call += 1;
      const count = call === 1 ? 3 : 11;
      return { ok: true as const, value: stateBytesWithRecordCount(count) };
    };

    const first = await planWithdrawChallenge({
      account: { status: "connected", vm: "svm", address: wallet },
      chainId: ns,
      tokenId,
      fetchAccountData,
    });
    const second = await planWithdrawChallenge({
      account: { status: "connected", vm: "svm", address: wallet },
      chainId: ns,
      tokenId,
      fetchAccountData,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || first.vm !== "svm") throw new Error("expected svm");
    if (!second.ok || second.vm !== "svm") throw new Error("expected svm");
    assert.equal(first.plan.recordCount, 3);
    assert.equal(second.plan.recordCount, 11);
    assert.notEqual(
      first.plan.accounts[5]!.address,
      second.plan.accounts[5]!.address,
    );

    const expectedSecond = await deriveSvmPda({
      recipe: "kar-passport/record",
      programId: stack.karPassport,
      seeds: { token_id: tokenBytes, index: 11 },
    });
    assert.equal(expectedSecond.ok, true);
    if (!expectedSecond.ok) return;
    assert.equal(second.plan.accounts[5]!.address, expectedSecond.address);

    // Planted constant index (reuse first count) is red against live second.
    assert.throws(() => {
      assert.equal(
        second.plan.accounts[5]!.address,
        first.plan.accounts[5]!.address,
        "planted cached record PDA",
      );
    });

    const plantedConstant = assembleWithdrawChallengeAccounts({
      challenger: wallet,
      config: second.plan.accounts[1]!.address,
      asset: second.plan.accounts[2]!.address,
      state: second.plan.accounts[3]!.address,
      challenge: second.plan.accounts[4]!.address,
      record: second.plan.accounts[1]!.address, // wrong — reused config
      system: systemProgramId(),
      payer: wallet,
    });
    assert.throws(() => {
      assert.equal(plantedConstant[5]!.address, expectedSecond.address);
    });
  });
});

describe("withdrawChallenge SVM metas order", () => {
  it("processor body binds eight accounts; plan metas match roles; transposition plant red", async () => {
    const body = readWithdrawChallengeBody();
    const liveFacts = assertWithdrawProcessorFacts(body);
    assert.deepEqual(liveFacts.bindings, [...EXPECTED_WITHDRAW_BINDINGS]);

    const plantedOrderBody = body
      .replace(
        /let\s+state\s*=\s*next_account_info\s*\(\s*iter\s*\)\s*\?/,
        "let __tmp_state_binding = next_account_info(iter)?",
      )
      .replace(
        /let\s+challenge_info\s*=\s*next_account_info\s*\(\s*iter\s*\)\s*\?/,
        "let state = next_account_info(iter)?",
      )
      .replace(
        /let\s+__tmp_state_binding\s*=\s*next_account_info\s*\(\s*iter\s*\)\s*\?/,
        "let challenge_info = next_account_info(iter)?",
      );
    assert.throws(
      () => {
        assertWithdrawProcessorFacts(plantedOrderBody);
      },
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        return true;
      },
      "planted transposed bindings must turn order assertion red",
    );
    assertWithdrawProcessorFacts(body);

    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const wallet = "So11111111111111111111111111111111111111112";
    const tokenBytes = tokenIdToBytes32(tokenId);
    const recordCount = 11;

    const planned = await planWithdrawChallenge({
      account: { status: "connected", vm: "svm", address: wallet },
      chainId: ns,
      tokenId,
      fetchAccountData: async () => ({
        ok: true,
        value: stateBytesWithRecordCount(recordCount),
      }),
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("expected svm");

    const accounts = planned.plan.accounts;
    assert.equal(accounts.length, 8);
    assert.equal(accounts[0]!.role, AccountRole.WRITABLE_SIGNER); // challenger
    assert.equal(accounts[1]!.role, AccountRole.READONLY); // config
    assert.equal(accounts[2]!.role, AccountRole.READONLY); // asset
    assert.equal(accounts[3]!.role, AccountRole.WRITABLE); // state
    assert.equal(accounts[4]!.role, AccountRole.WRITABLE); // challenge
    assert.equal(accounts[5]!.role, AccountRole.WRITABLE); // record
    assert.equal(accounts[6]!.role, AccountRole.READONLY); // system
    assert.equal(accounts[7]!.role, AccountRole.WRITABLE_SIGNER); // payer
    assert.equal(accounts[0]!.address, wallet);
    assert.equal(accounts[7]!.address, wallet);
    assert.equal(accounts[6]!.address, systemProgramId());
    assert.equal(planned.plan.feePayer, wallet);
    assert.equal(planned.plan.programId, stack.karPassport);
    assert.equal(planned.plan.recordCount, recordCount);

    const [
      expectedConfig,
      expectedAsset,
      expectedState,
      expectedChallenge,
      expectedRecord,
    ] = await Promise.all([
      deriveSvmPda({ recipe: "kar-passport/config", programId: stack.karPassport }),
      deriveSvmPda({
        recipe: "kar-passport/asset",
        programId: stack.karPassport,
        seeds: { token_id: tokenBytes },
      }),
      deriveSvmPda({
        recipe: "kar-passport/state",
        programId: stack.karPassport,
        seeds: { token_id: tokenBytes },
      }),
      deriveSvmPda({
        recipe: "kargain-bonded-challenge/challenge",
        programId: stack.karPassport,
        seeds: { subject_id: tokenBytes },
      }),
      deriveSvmPda({
        recipe: "kar-passport/record",
        programId: stack.karPassport,
        seeds: { token_id: tokenBytes, index: recordCount },
      }),
    ]);
    assert.equal(expectedConfig.ok, true);
    assert.equal(expectedAsset.ok, true);
    assert.equal(expectedState.ok, true);
    assert.equal(expectedChallenge.ok, true);
    assert.equal(expectedRecord.ok, true);
    if (
      !expectedConfig.ok ||
      !expectedAsset.ok ||
      !expectedState.ok ||
      !expectedChallenge.ok ||
      !expectedRecord.ok
    ) {
      return;
    }
    assert.equal(accounts[1]!.address, expectedConfig.address);
    assert.equal(accounts[2]!.address, expectedAsset.address);
    assert.equal(accounts[3]!.address, expectedState.address);
    assert.equal(accounts[4]!.address, expectedChallenge.address);
    assert.equal(accounts[5]!.address, expectedRecord.address);

    // Adjacent challenger↔config role swap fails the pin.
    const swapped = [...accounts];
    const tmp = swapped[0]!;
    swapped[0] = swapped[1]!;
    swapped[1] = tmp;
    assert.throws(() => {
      assert.equal(swapped[0]!.role, AccountRole.WRITABLE_SIGNER);
      assert.equal(swapped[1]!.role, AccountRole.READONLY);
    });

    // Planted writable asset is red.
    const plantedWritableAsset = {
      ...accounts[2]!,
      role: AccountRole.WRITABLE,
    };
    assert.throws(() => {
      assert.equal(
        plantedWritableAsset.role,
        AccountRole.READONLY,
        "planted writable asset role",
      );
    });
  });

  it("extraction refuses when withdraw_challenge is missing or under-bound", () => {
    assert.throws(
      () => extractNextAccountBindings("fn other() { Ok(()) }", 8),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /binding_count_below_8/);
        return true;
      },
    );
    assert.throws(
      () =>
        locateEntrypointFnBody(
          "pub fn something_else() -> ProgramResult { Ok(()) }\n",
          "withdraw_challenge",
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "withdraw_challenge_not_found");
        return true;
      },
    );
    const live = extractNextAccountBindings(readWithdrawChallengeBody(), 8);
    assert.deepEqual(live, [...EXPECTED_WITHDRAW_BINDINGS]);
  });

  it("executeWithdrawChallenge SVM sends assembled metas via sendSvmInstruction", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const wallet = "So11111111111111111111111111111111111111112";
    let wireSeen = false;
    const port: SvmSignAndSendPort = {
      async signAndSendTransaction() {
        wireSeen = true;
        return new Uint8Array(64).fill(9);
      },
    };
    const sig = await executeWithdrawChallenge({
      account: { status: "connected", vm: "svm", address: wallet },
      chainId: ns,
      tokenId: "1",
      writeEvmContract: async () => {
        throw new Error("evm arm must not run");
      },
      svmPort: port,
      fetchAccountData: async () => ({
        ok: true,
        value: stateBytesWithRecordCount(0),
      }),
      fetchBlockhash: async () =>
        ({
          ok: true as const,
          value: {
            blockhash: MOCK_BLOCKHASH,
            lastValidBlockHeight: 1_000_000n,
          },
        }) as const,
    });
    assert.ok(typeof sig === "string" && sig.length > 0);
    assert.equal(wireSeen, true);
  });
});

describe("withdrawChallenge claim-outcome disclosure", () => {
  it("EVM claimPossible with Claims copy; SVM claimPossible false", () => {
    const evm = challengeBondDisclosure(84532);
    assert.equal(evm.configured, true);
    if (!evm.configured) throw new Error("expected configured");
    assert.equal(evm.undeliverableBondOutcome.claimPossible, true);
    if (!evm.undeliverableBondOutcome.claimPossible) {
      throw new Error("expected claimPossible");
    }
    assert.equal(
      evm.undeliverableBondOutcome.claimSuccessCopy,
      CHALLENGE_BOND_EVM_CLAIM_SUCCESS,
    );
    assert.equal(evm.releasedSuccessCopy, CHALLENGE_BOND_WITHDRAW_RELEASED);
    assert.match(evm.undeliverableBondOutcome.claimSuccessCopy, /Claims/);

    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const svm = challengeBondDisclosure(namespaces[0]!);
    assert.equal(svm.configured, true);
    if (!svm.configured) throw new Error("expected configured");
    assert.equal(svm.undeliverableBondOutcome.claimPossible, false);
    assert.equal(svm.releasedSuccessCopy, CHALLENGE_BOND_WITHDRAW_RELEASED);
  });

  it("planted Claims into SVM claimPossible arm is red; live disclosure is green", () => {
    const src = disclosureSource();
    assert.match(src, /undeliverableBondOutcome:\s*\{\s*claimPossible:\s*false\s*\}/);
    assert.match(src, /CHALLENGE_BOND_EVM_CLAIM_SUCCESS/);

    const planted = src.replace(
      /undeliverableBondOutcome:\s*\{\s*claimPossible:\s*false\s*\}/,
      `undeliverableBondOutcome: { claimPossible: true, claimSuccessCopy: "${CHALLENGE_BOND_EVM_CLAIM_SUCCESS}" }`,
    );
    assert.throws(() => {
      assert.match(
        planted,
        /undeliverableBondOutcome:\s*\{\s*claimPossible:\s*false\s*\}/,
      );
    });
    assert.match(
      src,
      /undeliverableBondOutcome:\s*\{\s*claimPossible:\s*false\s*\}/,
    );
  });
});

/**
 * Challenge dual-VM actions that consume challengeBondDisclosure for chrome
 * or success outcome. Admit must include bondDisclosure.configured — same
 * fact the submit/chrome path needs. Extend when judge/conclude migrate onto
 * disclosure (U6.7.4 / U6.7.5).
 */
const BOND_DISCLOSURE_CHALLENGE_ACTIONS = ["open", "withdraw"] as const;

/**
 * Extract the writeAvail…isAvailable(actionSurface.<action>) conjunction.
 * Requires bondDisclosure.configured inside that gate (not a later block).
 */
function assertBondDisclosureAdmission(
  src: string,
  action: (typeof BOND_DISCLOSURE_CHALLENGE_ACTIONS)[number],
): void {
  const gateRe = new RegExp(
    String.raw`writeAvail\.available\s*&&\s*writeTargetConfigured\s*&&\s*((?:bondDisclosure\.configured\s*&&\s*)?)isAvailable\(actionSurface\.${action}\)`,
  );
  const m = src.match(gateRe);
  assert.ok(
    m,
    `missing writeAvail gate for actionSurface.${action}`,
  );
  assert.match(
    m[0]!,
    /bondDisclosure\.configured/,
    `actionSurface.${action} admit must include bondDisclosure.configured`,
  );
}

function assertAllBondDisclosureAdmissions(src: string): void {
  for (const action of BOND_DISCLOSURE_CHALLENGE_ACTIONS) {
    assertBondDisclosureAdmission(src, action);
  }
}

describe("withdrawChallenge panel + ownership", () => {
  it("panel migrates withdraw via writeAvail + disclosure + owner; judge/conclude stay on evm.ok + run", () => {
    const src = panelSource();
    assert.match(src, /useWithdrawChallenge|withdrawChallenge/);
    assert.match(src, /undeliverableBondOutcome/);
    assert.match(src, /writeOutcomeHasClaimRecipient/);
    assert.match(src, /sessionAddress/);
    assert.doesNotMatch(src, /functionName:\s*"withdraw"/);

    assert.match(
      src,
      /writeAvail\.available[\s\S]*?isAvailable\(actionSurface\.withdraw\)/,
    );
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.withdraw\)/,
    );

    // Judge / conclude remain on legacy run + evm.ok.
    assert.match(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.judge\)/,
    );
    assert.match(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.conclude\)/,
    );
    assert.match(src, /functionName:\s*"judge"/);
    assert.match(src, /functionName:\s*"conclude"/);
    assert.match(src, /const run = useCallback/);

    const withdrawSubmit = src.match(
      /const submitWithdraw = useCallback\(async \(\) => \{[\s\S]*?\}, \[/,
    );
    assert.ok(withdrawSubmit);
    assert.match(withdrawSubmit![0]!, /withdrawChallenge/);
    assert.match(withdrawSubmit![0]!, /undeliverableBondOutcome/);
    assert.match(withdrawSubmit![0]!, /sessionAddress/);
    assert.doesNotMatch(withdrawSubmit![0]!, /\bevm\.address\b/);

    assert.equal(vmBranchViolationInSource(src), false);
    assert.equal(vmBranchViolationInSource(hookSource()), false);

    const plantedWithdrawEvmOk =
      "passport && evm.ok && isAvailable(actionSurface.withdraw)";
    assert.throws(() => {
      assert.doesNotMatch(
        plantedWithdrawEvmOk,
        /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.withdraw\)/,
      );
    });

    const plantedJudgeMigrated =
      "writeAvail.available && writeTargetConfigured && isAvailable(actionSurface.judge)";
    assert.throws(() => {
      assert.match(
        plantedJudgeMigrated,
        /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.judge\)/,
      );
    });
  });

  it("every disclosure-consuming challenge block admits on bondDisclosure.configured", () => {
    const src = panelSource();
    assertAllBondDisclosureAdmissions(src);

    // Plant: strip disclosure from withdraw gate only — withdraw red, open still green.
    const planted = src.replace(
      /writeAvail\.available\s*&&\s*writeTargetConfigured\s*&&\s*bondDisclosure\.configured\s*&&\s*isAvailable\(actionSurface\.withdraw\)/,
      "writeAvail.available && writeTargetConfigured && isAvailable(actionSurface.withdraw)",
    );
    assert.throws(
      () => {
        assertBondDisclosureAdmission(planted, "withdraw");
      },
      (err: unknown) => err instanceof assert.AssertionError,
      "planted withdraw gate without bondDisclosure.configured must be red",
    );
    assertBondDisclosureAdmission(planted, "open");
  });

  it("owner source has freshness decode + no PassportConfig / ChallengeAccount decode", () => {
    const src = ownerSource();
    assert.match(src, /fetchAccountData|fetchProductSvmAccountData/);
    assert.match(src, /decodePassportState/);
    assert.match(src, /recordCount/);
    assert.doesNotMatch(src, /decodePassportConfig/);
    assert.doesNotMatch(src, /decodeChallengeAccount/);
    assert.doesNotMatch(src, /recordCount\s*\+\+/);
    assert.doesNotMatch(src, /@solana\/web3\.js/);
  });

  it("owner and disclosure are on the VM allowlist; panel and hook are not", () => {
    assert.ok((VM_BRANCH_ALLOWLIST as readonly string[]).includes(OWNER_REL));
    assert.ok(
      (VM_BRANCH_ALLOWLIST as readonly string[]).includes(DISCLOSURE_REL),
    );
    assert.equal(
      (VM_BRANCH_ALLOWLIST as readonly string[]).includes(PANEL_REL),
      false,
    );
    assert.equal(
      (VM_BRANCH_ALLOWLIST as readonly string[]).includes(HOOK_REL),
      false,
    );
  });
});
