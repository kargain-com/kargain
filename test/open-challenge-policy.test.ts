/**
 * §7.2 U6.7.1 — passport OpenChallenge write owner + bond disclosure:
 * EVM open+[tid]+value; SVM seven derive-only metas; Claims absent on SVM chrome.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AccountRole, getBase58Decoder } from "@solana/kit";

import {
  challengeBondDisclosure,
} from "@/lib/passport/challenge-bond-disclosure";
import {
  assembleOpenChallengeAccounts,
  buildEvmOpenChallengeCall,
  executeOpenChallenge,
  planOpenChallenge,
} from "@/lib/passport/open-challenge";
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
const OWNER_REL = "lib/passport/open-challenge.ts";
const DISCLOSURE_REL = "lib/passport/challenge-bond-disclosure.ts";
const PANEL_REL = "components/passport/passport-actions-panel.tsx";
const HOOK_REL = "hooks/use-open-challenge.ts";
const ENTRYPOINT_REL = "svm/programs/kar-passport/src/entrypoint.rs";

const EXPECTED_OPEN_BINDINGS = [
  "challenger",
  "config",
  "asset",
  "state",
  "challenge_info",
  "system",
  "payer",
] as const;

const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));
const tokenId = "1";
const deposit = 10_000_000_000_000_000n; // 0.01 ether

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

function readOpenChallengeBody(): string {
  return readEntrypointFnBody(ROOT, ENTRYPOINT_REL, "open_challenge");
}

function assertEvmOpenPin(
  call: {
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
    chainId?: number;
  },
  expectedTokenId: string,
  expectedValue: bigint,
): void {
  assert.equal(call.functionName, "open");
  assert.equal(call.args.length, 1);
  assert.equal(call.args[0], BigInt(expectedTokenId));
  assert.equal(call.value, expectedValue);
  if (call.chainId != null) {
    assert.equal(call.chainId, wagmiChainId(84532));
  }
}

function assertOpenProcessorFacts(body: string): {
  bindings: string[];
} {
  const bindings = extractNextAccountBindings(body, 7);
  assert.equal(bindings.length, 7, "open_challenge must bind exactly seven accounts");
  assertBindingOrder(
    bindings,
    EXPECTED_OPEN_BINDINGS,
    "open_challenge next_account_info order",
  );
  assertBindingIsSigner(
    body,
    "challenger",
    "open_challenge requires challenger to be a signer",
  );
  assertBindingIsSigner(
    body,
    "payer",
    "open_challenge requires payer to be a signer",
  );
  const targets = saveStateTargets(body);
  assert.ok(targets.length >= 1, "open_challenge must persist via save_state");
  assert.ok(
    targets.every((t) => t === "state"),
    `open_challenge save_state must target state only; got ${targets.join(",")}`,
  );
  assert.match(body, /pay_native\s*\(\s*challenger\s*,\s*challenge_info/);
  assert.match(body, /create_pda\s*\(/);
  return { bindings };
}

describe("openChallenge EVM pin", () => {
  it("live builder is open + [tid] + value; planted missing value is red", async () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmOpenChallengeCall({
      address,
      tokenId,
      chainId: 84532,
      value: deposit,
    });
    assertEvmOpenPin(live, tokenId, deposit);

    const plantedNoValue = {
      ...live,
      value: undefined as unknown as bigint,
    };
    assert.throws(() => {
      assertEvmOpenPin(plantedNoValue, tokenId, deposit);
    });

    const planned = await planOpenChallenge({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
      disputeDeposit: deposit,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "evm") throw new Error("expected evm");
    assertEvmOpenPin(planned.call, tokenId, deposit);

    const missing = await planOpenChallenge({
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
    assert.equal(missing.ok, false);
    if (missing.ok) throw new Error("expected refuse");
    assert.equal(missing.cause, "deposit_unknown");
  });

  it("planted second argument is red; live one-arg is green", () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmOpenChallengeCall({
      address,
      tokenId,
      chainId: 84532,
      value: deposit,
    });
    assertEvmOpenPin(live, tokenId, deposit);

    const plantedTwoArgs = {
      ...live,
      args: [BigInt(tokenId), "extra"] as unknown as [bigint],
    };
    assert.throws(() => {
      assertEvmOpenPin(plantedTwoArgs, tokenId, deposit);
    });
    assert.equal(live.args.length, 1);
  });

  it("executeOpenChallenge EVM passes pinned call through writeEvmContract", async () => {
    const address = karPassportAddress(84532)!;
    let captured: unknown;
    const hash = await executeOpenChallenge({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
      disputeDeposit: deposit,
      writeEvmContract: async (call) => {
        captured = call;
        return "0xabc" as `0x${string}`;
      },
    });
    assert.equal(hash, "0xabc");
    assert.ok(captured);
    assertEvmOpenPin(
      captured as { functionName: string; args: readonly unknown[]; value: bigint },
      tokenId,
      deposit,
    );
    assert.equal((captured as { address: string }).address, address);
  });
});

describe("openChallenge SVM no account read", () => {
  it("owner source performs zero state/stake reads; plants go red", () => {
    const src = ownerSource();
    assert.doesNotMatch(src, /decodePassportState/);
    assert.doesNotMatch(src, /decodeStakeAccount/);
    assert.doesNotMatch(src, /fetchAccountData/);
    assert.doesNotMatch(src, /fetchProductSvmAccountData/);
    assert.doesNotMatch(src, /recordCount/);

    for (const [label, plant] of [
      ["decodePassportState", src + "\n  decodePassportState(bytes);\n"],
      ["decodeStakeAccount", src + "\n  decodeStakeAccount(bytes);\n"],
      ["fetchAccountData", src + "\n  await fetchAccountData(addr);\n"],
      ["recordCount", src + "\n  const n = recordCount;\n"],
    ] as const) {
      assert.throws(
        () => {
          assert.doesNotMatch(plant, new RegExp(label));
        },
        (err: unknown) => err instanceof assert.AssertionError,
        `planted ${label} must turn absence pin red`,
      );
    }
  });
});

describe("openChallenge SVM metas order", () => {
  it("processor body binds seven accounts; plan metas match roles; transposition plant red", async () => {
    const body = readOpenChallengeBody();
    const liveFacts = assertOpenProcessorFacts(body);
    assert.deepEqual(liveFacts.bindings, [...EXPECTED_OPEN_BINDINGS]);

    // Plant: transpose state ↔ challenge_info — order assertion red.
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
        assertOpenProcessorFacts(plantedOrderBody);
      },
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        return true;
      },
      "planted transposed bindings must turn order assertion red",
    );
    assertOpenProcessorFacts(body);

    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const wallet = "So11111111111111111111111111111111111111112";
    const tokenBytes = tokenIdToBytes32(tokenId);

    const planned = await planOpenChallenge({
      account: { status: "connected", vm: "svm", address: wallet },
      chainId: ns,
      tokenId,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("expected svm");

    const accounts = planned.plan.accounts;
    assert.equal(accounts.length, 7);
    assert.equal(accounts[0]!.role, AccountRole.WRITABLE_SIGNER); // challenger
    assert.equal(accounts[1]!.role, AccountRole.READONLY); // config
    assert.equal(accounts[2]!.role, AccountRole.READONLY); // asset
    assert.equal(accounts[3]!.role, AccountRole.WRITABLE); // state
    assert.equal(accounts[4]!.role, AccountRole.WRITABLE); // challenge
    assert.equal(accounts[5]!.role, AccountRole.READONLY); // system
    assert.equal(accounts[6]!.role, AccountRole.WRITABLE_SIGNER); // payer
    assert.equal(accounts[0]!.address, wallet);
    assert.equal(accounts[6]!.address, wallet);
    assert.equal(accounts[5]!.address, systemProgramId());
    assert.equal(planned.plan.feePayer, wallet);
    assert.equal(planned.plan.programId, stack.karPassport);

    const [expectedConfig, expectedAsset, expectedState, expectedChallenge] =
      await Promise.all([
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
      ]);
    assert.equal(expectedConfig.ok, true);
    assert.equal(expectedAsset.ok, true);
    assert.equal(expectedState.ok, true);
    assert.equal(expectedChallenge.ok, true);
    if (
      !expectedConfig.ok ||
      !expectedAsset.ok ||
      !expectedState.ok ||
      !expectedChallenge.ok
    ) {
      return;
    }
    assert.equal(accounts[1]!.address, expectedConfig.address);
    assert.equal(accounts[2]!.address, expectedAsset.address);
    assert.equal(accounts[3]!.address, expectedState.address);
    assert.equal(accounts[4]!.address, expectedChallenge.address);

    const plantedConstant = assembleOpenChallengeAccounts({
      challenger: wallet,
      config: accounts[1]!.address,
      asset: accounts[2]!.address,
      state: accounts[1]!.address,
      challenge: accounts[4]!.address,
      system: systemProgramId(),
      payer: wallet,
    });
    assert.throws(() => {
      assert.equal(plantedConstant[3]!.address, expectedState.address);
    });
  });

  it("extraction refuses when open_challenge is missing or under-bound", () => {
    assert.throws(
      () => extractNextAccountBindings("fn other() { Ok(()) }", 7),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /binding_count_below_7/);
        return true;
      },
    );
    assert.throws(
      () =>
        locateEntrypointFnBody(
          "pub fn something_else() -> ProgramResult { Ok(()) }\n",
          "open_challenge",
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "open_challenge_not_found");
        return true;
      },
    );
    const live = extractNextAccountBindings(readOpenChallengeBody(), 7);
    assert.deepEqual(live, [...EXPECTED_OPEN_BINDINGS]);
  });

  it("executeOpenChallenge SVM sends assembled metas via sendSvmInstruction", async () => {
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
    const sig = await executeOpenChallenge({
      account: { status: "connected", vm: "svm", address: wallet },
      chainId: ns,
      tokenId: "1",
      writeEvmContract: async () => {
        throw new Error("evm arm must not run");
      },
      svmPort: port,
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

describe("challenge bond disclosure", () => {
  it("EVM requires amount known; SVM amount readable via keyed config; no Claims in delivery", () => {
    const evm = challengeBondDisclosure(84532);
    assert.equal(evm.configured, true);
    if (!evm.configured) throw new Error("expected configured");
    assert.equal(evm.requiresAmountKnownBeforeSubmit, true);
    assert.equal(evm.amountSource.status, "readable");
    assert.ok("passportAddress" in evm.amountSource);
    assert.match(evm.deliverySentence, /Claims/);

    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const svm = challengeBondDisclosure(namespaces[0]!);
    assert.equal(svm.configured, true);
    if (!svm.configured) throw new Error("expected configured");
    assert.equal(svm.requiresAmountKnownBeforeSubmit, false);
    assert.equal(svm.amountSource.status, "readable");
    assert.ok(
      "keyedConfig" in svm.amountSource,
      "SVM amountSource must be config-backed readable",
    );
    assert.doesNotMatch(svm.deliverySentence, /Claims/i);
    assert.match(svm.deliverySentence, /your bond/i);
    assert.doesNotMatch(svm.deliverySentence, /undeliverable native push/i);
  });

  it("planted Claims in SVM delivery is red; live disclosure source is green", () => {
    const src = disclosureSource();
    assert.doesNotMatch(src, /CHALLENGE_BOND_SVM_DEPOSIT_UNREAD/);
    // Live SVM_DELIVERY constant must not mention Claims.
    const svmConst = src.match(
      /const SVM_DELIVERY\s*=\s*"([^"]+)"/,
    );
    assert.ok(svmConst);
    assert.doesNotMatch(svmConst![1]!, /Claims/i);

    const planted = src.replace(
      /const SVM_DELIVERY\s*=\s*"[^"]+"/,
      'const SVM_DELIVERY = "If a return cannot be delivered, it waits under Claims."',
    );
    assert.throws(() => {
      const m = planted.match(/const SVM_DELIVERY\s*=\s*"([^"]+)"/);
      assert.ok(m);
      assert.doesNotMatch(m![1]!, /Claims/i);
    });
  });
});

describe("openChallenge panel + ownership", () => {
  it("panel migrates open via writeAvail + disclosure + owner; neighbours stay on evm.ok", () => {
    const src = panelSource();
    assert.match(src, /useOpenChallenge|openChallenge/);
    assert.match(src, /challengeBondDisclosure/);
    assert.match(src, /requiresAmountKnownBeforeSubmit/);
    assert.doesNotMatch(src, /functionName:\s*"open"/);

    assert.match(src, /useChallengeBondAmount/);
    assert.doesNotMatch(src, /functionName:\s*"disputeDeposit"/);
    assert.doesNotMatch(src, /amountSource\.status === "unread"/);

    assert.match(
      src,
      /writeAvail\.available[\s\S]*?isAvailable\(actionSurface\.open\)/,
    );
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.open\)/,
    );

    // Withdraw migrated by U6.7.2 — no longer gated on evm.ok.
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.withdraw\)/,
    );
    assert.doesNotMatch(src, /functionName:\s*"withdraw"/);
    assert.match(src, /useWithdrawChallenge|withdrawChallenge/);
    assert.match(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.judge\)/,
    );
    assert.match(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.conclude\)/,
    );

    // Open chrome must not hardcode Claims — delivery comes from disclosure.
    const openBlock = src.match(
      /isAvailable\(actionSurface\.open\)[\s\S]*?Open challenge/,
    );
    assert.ok(openBlock);
    assert.doesNotMatch(openBlock![0]!, /waits under Claims/);

    assert.equal(vmBranchViolationInSource(src), false);
    assert.equal(vmBranchViolationInSource(hookSource()), false);

    const plantedOpenEvmOk =
      "passport && evm.ok && isAvailable(actionSurface.open)";
    assert.throws(() => {
      assert.doesNotMatch(
        plantedOpenEvmOk,
        /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.open\)/,
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
