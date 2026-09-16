/**
 * §7.2 U6.7.5 — passport ConcludeChallenge write owner:
 * EVM conclude+[tid] (no value); SVM six metas; forfeit-only recipient from
 * config decode; permissionless (payer signer only — no judge/stake).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AccountRole, getBase58Decoder } from "@solana/kit";

import {
  assembleConcludeChallengeAccounts,
  buildEvmConcludeChallengeCall,
  executeConcludeChallenge,
  planConcludeChallenge,
} from "@/lib/passport/conclude-challenge";
import {
  challengeAccountLayout,
  decodePassportConfig,
  hexToBytes,
  passportConfigLayout,
} from "@/lib/svm/decode-account-state";
import { encodeSvmInstruction } from "@/lib/svm/encode-instruction";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";
import { encodeSvmPubkeyBytes } from "@/lib/web3/protocol-address";
import {
  commercialSvmNamespaceIds,
  requireSvmCommercialActive,
} from "@/lib/web3/commercial-active";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import type { FetchSvmAccountDataResult } from "@/lib/web3/svm-rpc";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  vmBranchViolationInSource,
  VM_BRANCH_ALLOWLIST,
} from "./network-vm-component-policy.test.ts";
import {
  assertBondDisclosureAdmission,
  assertAllBondDisclosureAdmissions,
} from "./withdraw-challenge-policy.test.ts";
import {
  assertBindingIsSigner,
  assertBindingOrder,
  extractNextAccountBindings,
  locateEntrypointFnBody,
  readEntrypointFnBody,
  saveStateTargets,
} from "./svm-entrypoint-account-bindings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/conclude-challenge.ts";
const PANEL_REL = "components/passport/passport-actions-panel.tsx";
const HOOK_REL = "hooks/use-conclude-challenge.ts";
const ENTRYPOINT_REL = "svm/programs/kar-passport/src/entrypoint.rs";
const BONDED_CHALLENGE_REL = "svm/crates/kargain-bonded-challenge/src/lib.rs";

const EXPECTED_CONCLUDE_BINDINGS = [
  "config",
  "asset",
  "state",
  "challenge_info",
  "bond_recipient",
  "payer",
] as const;

const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));
const tokenId = "1";
const PAYER_WALLET = "So11111111111111111111111111111111111111112";

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

function panelSource(): string {
  return readFileSync(path.join(ROOT, PANEL_REL), "utf8");
}

function hookSource(): string {
  return readFileSync(path.join(ROOT, HOOK_REL), "utf8");
}

function readConcludeChallengeBody(): string {
  return readEntrypointFnBody(ROOT, ENTRYPOINT_REL, "conclude_challenge");
}

function assertEvmConcludePin(
  call: {
    functionName: string;
    args: readonly unknown[];
    value?: unknown;
    chainId?: number;
  },
  expectedTokenId: string,
): void {
  assert.equal(call.functionName, "conclude");
  assert.equal(call.args.length, 1);
  assert.equal(call.args[0], BigInt(expectedTokenId));
  assert.equal("value" in call && call.value != null, false, "conclude is not payable");
  if (call.chainId != null) {
    assert.equal(call.chainId, wagmiChainId(84532));
  }
}

function assertConcludeProcessorFacts(body: string): { bindings: string[] } {
  const bindings = extractNextAccountBindings(body, 6);
  assert.equal(bindings.length, 6, "conclude_challenge must bind exactly six accounts");
  assertBindingOrder(
    bindings,
    EXPECTED_CONCLUDE_BINDINGS,
    "conclude_challenge next_account_info order",
  );
  assertBindingIsSigner(body, "payer", "conclude_challenge requires payer signer");
  // Permissionless: only payer is checked — no judge / challenger signer.
  assert.doesNotMatch(body, /\bjudge\.is_signer\b/);
  assert.doesNotMatch(body, /\bchallenger\.is_signer\b/);
  assert.equal(
    [...body.matchAll(/\w+\.is_signer\b/g)].length,
    1,
    "conclude_challenge must have exactly one is_signer check (payer)",
  );
  assert.doesNotMatch(body, /\bstake\b/);
  assert.doesNotMatch(body, /create_pda\s*\(/);
  assert.match(body, /transfer_bond\s*\(/);
  const targets = saveStateTargets(body);
  assert.ok(targets.includes("state"), "conclude_challenge must save_state");
  return { bindings };
}

function makeConfigFetcher(args: {
  configAddress: string;
  configData: Uint8Array;
}): (account: string) => Promise<FetchSvmAccountDataResult> {
  return async (account) => {
    if (account === args.configAddress) {
      return { ok: true, value: args.configData };
    }
    return {
      ok: false,
      cause: "account_not_found",
      detail: account,
    };
  };
}

describe("concludeChallenge EVM arity pin", () => {
  it("live conclude+[tid] with no value; planted second arg / value are red", async () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmConcludeChallengeCall({
      address,
      tokenId,
      chainId: 84532,
    });
    assertEvmConcludePin(live, tokenId);

    const plantedSecond = {
      ...live,
      args: [BigInt(tokenId), 0n] as unknown as [bigint],
    };
    assert.throws(() => {
      assertEvmConcludePin(plantedSecond, tokenId);
    });

    const plantedValue = {
      ...live,
      value: 1n,
    };
    assert.throws(() => {
      assertEvmConcludePin(plantedValue, tokenId);
    });

    const planned = await planConcludeChallenge({
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
    assertEvmConcludePin(planned.call, tokenId);
  });
});

describe("concludeChallenge SVM recipient resolution", () => {
  it("forfeit from config only; challenge read for recipient is red; unresolved refuses by name", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);

    const bonded = readFileSync(path.join(ROOT, BONDED_CHALLENGE_REL), "utf8");
    assert.match(
      bonded,
      /fn\s+conclude_challenge[\s\S]*?let\s+recipient\s*=\s*config\.forfeit_recipient/,
    );

    const configLayout = passportConfigLayout();
    const configData = hexToBytes(configLayout.goldenHex);
    const configDecoded = decodePassportConfig(configData);
    assert.equal(configDecoded.ok, true);
    if (!configDecoded.ok) throw new Error("config golden");
    const expectedForfeit = configDecoded.value.forfeitRecipient;
    assert.equal(
      expectedForfeit,
      encodeSvmPubkeyBytes(
        hexToBytes(String(configLayout.sample.forfeit_recipient)),
      ),
    );

    const tokenBytes = tokenIdToBytes32(tokenId);
    const configPda = await deriveSvmPda({
      recipe: "kar-passport/config",
      programId: stack.karPassport,
    });
    assert.equal(configPda.ok, true);
    if (!configPda.ok) throw new Error("pda");

    const account = {
      status: "connected" as const,
      vm: "svm" as const,
      address: PAYER_WALLET,
    };

    const planned = await planConcludeChallenge({
      account,
      chainId: ns,
      tokenId,
      fetchAccountData: makeConfigFetcher({
        configAddress: configPda.address,
        configData,
      }),
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("expected svm");
    assert.equal(planned.plan.accounts.length, 6);
    assert.equal(planned.plan.accounts[4]!.address, expectedForfeit);
    assert.equal(planned.plan.bondRecipient, expectedForfeit);
    assert.equal(planned.plan.accounts[4]!.role, AccountRole.WRITABLE);

    // Config-only read for recipient.
    const reads: string[] = [];
    const challengePda = await deriveSvmPda({
      recipe: "kargain-bonded-challenge/challenge",
      programId: stack.karPassport,
      seeds: { subject_id: tokenBytes },
    });
    if (!challengePda.ok) throw new Error("challenge pda");
    const challengeData = hexToBytes(challengeAccountLayout().goldenHex);

    const tracked = await planConcludeChallenge({
      account,
      chainId: ns,
      tokenId,
      fetchAccountData: async (addr) => {
        reads.push(addr);
        if (addr === configPda.address) {
          return { ok: true, value: configData };
        }
        if (addr === challengePda.address) {
          return { ok: true, value: challengeData };
        }
        return { ok: false, cause: "account_not_found", detail: addr };
      },
    });
    assert.equal(tracked.ok, true);
    assert.deepEqual(reads, [configPda.address]);

    // Plant: a recipient resolution that keyed-reads challenge is red vs live.
    assert.throws(() => {
      assert.deepEqual(reads, [challengePda.address]);
    });

    const missing = await planConcludeChallenge({
      account,
      chainId: ns,
      tokenId,
      fetchAccountData: async () => ({
        ok: false,
        cause: "account_not_found",
        detail: "planted",
      }),
    });
    assert.equal(missing.ok, false);
    if (missing.ok) throw new Error("expected refuse");
    assert.equal(missing.cause, "recipient_unresolved");

    const badDecode = await planConcludeChallenge({
      account,
      chainId: ns,
      tokenId,
      fetchAccountData: async () => ({
        ok: true,
        value: new Uint8Array(8).fill(0xff),
      }),
    });
    assert.equal(badDecode.ok, false);
    if (badDecode.ok) throw new Error("expected refuse");
    assert.equal(badDecode.cause, "recipient_decode_failed");

    const src = ownerSource();
    assert.doesNotMatch(src, /bondRecipient\s*\?\?/);
    assert.doesNotMatch(src, /platformRecipient/);
    assert.doesNotMatch(src, /0x0{40}/);
    assert.doesNotMatch(src, /decodeChallengeAccount/);
    assert.match(src, /recipient_unresolved|recipient_decode_failed/);
    assert.match(src, /decodePassportConfig/);
  });
});

describe("concludeChallenge permissionless + SVM metas", () => {
  it("processor binds six accounts; no judge/stake; payer READONLY_SIGNER; stake plant red", async () => {
    const body = readConcludeChallengeBody();
    const { bindings } = assertConcludeProcessorFacts(body);
    assert.deepEqual(bindings, [...EXPECTED_CONCLUDE_BINDINGS]);
    const bindingSet = new Set<string>(bindings);
    assert.equal(bindingSet.has("judge"), false);
    assert.equal(bindingSet.has("stake"), false);
    assert.equal(bindingSet.has("staking_program"), false);

    // Planted second signer check in body is red against live one-signer fact.
    const plantedSecondSigner = body.replace(
      /if\s*!payer\.is_signer/,
      "if !judge.is_signer { return Err(ProgramError::MissingRequiredSignature); }\n    if !payer.is_signer",
    );
    assert.throws(() => {
      assertConcludeProcessorFacts(plantedSecondSigner);
    });

    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const configData = hexToBytes(passportConfigLayout().goldenHex);
    const configPda = await deriveSvmPda({
      recipe: "kar-passport/config",
      programId: stack.karPassport,
    });
    if (!configPda.ok) throw new Error("pda");

    const planned = await planConcludeChallenge({
      account: {
        status: "connected",
        vm: "svm",
        address: PAYER_WALLET,
      },
      chainId: ns,
      tokenId,
      fetchAccountData: makeConfigFetcher({
        configAddress: configPda.address,
        configData,
      }),
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("svm");

    const roles = planned.plan.accounts.map((a) => a.role);
    assert.deepEqual(roles, [
      AccountRole.READONLY, // config
      AccountRole.READONLY, // asset
      AccountRole.WRITABLE, // state
      AccountRole.WRITABLE, // challenge
      AccountRole.WRITABLE, // bond_recipient
      AccountRole.READONLY_SIGNER, // payer — no create_pda
    ]);
    assert.notEqual(
      planned.plan.accounts[5]!.role,
      AccountRole.WRITABLE_SIGNER,
    );

    const assembled = assembleConcludeChallengeAccounts({
      config: "c",
      asset: "a",
      state: "s",
      challenge: "ch",
      bondRecipient: "br",
      payer: "p",
    });
    assert.equal(assembled.length, 6);

    // Plant: adding a stake meta is red against six-meta permissionless shape.
    const plantedStake = [
      ...assembled,
      { address: "stake", role: AccountRole.READONLY },
    ];
    assert.throws(() => {
      assert.equal(plantedStake.length, 6);
    });

    // Transposition plant: payer role flipped to WRITABLE.
    const planted = [...assembled];
    planted[5] = { ...assembled[5]!, role: AccountRole.WRITABLE };
    assert.throws(() => {
      assert.equal(planted[5]!.role, AccountRole.READONLY_SIGNER);
    });
  });

  it("extraction refuses when conclude_challenge is missing or under-bound", () => {
    assert.throws(
      () => locateEntrypointFnBody("fn other() {}", "conclude_challenge"),
      /conclude_challenge_not_found/,
    );
    const body = readConcludeChallengeBody();
    const short = body.replace(
      /let\s+payer\s*=\s*next_account_info\s*\(\s*iter\s*\)\s*\?;/,
      "",
    );
    assert.throws(() => {
      extractNextAccountBindings(short, 6);
    });
  });

  it("executeConcludeChallenge SVM sends assembled metas via sendSvmInstruction", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const configData = hexToBytes(passportConfigLayout().goldenHex);
    const configPda = await deriveSvmPda({
      recipe: "kar-passport/config",
      programId: stack.karPassport,
    });
    if (!configPda.ok) throw new Error("pda");

    let wireSeen = false;
    const port: SvmSignAndSendPort = {
      async signAndSendTransaction() {
        wireSeen = true;
        return new Uint8Array(64).fill(9);
      },
    };
    const sig = await executeConcludeChallenge({
      account: {
        status: "connected",
        vm: "svm",
        address: PAYER_WALLET,
      },
      chainId: ns,
      tokenId,
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
      fetchAccountData: makeConfigFetcher({
        configAddress: configPda.address,
        configData,
      }),
    });
    assert.ok(typeof sig === "string" && sig.length > 0);
    assert.equal(wireSeen, true);
  });
});

describe("concludeChallenge panel + ownership", () => {
  it("panel migrates conclude via writeAvail + disclosure + owner; run helper deleted", () => {
    const src = panelSource();
    assert.match(src, /useConcludeChallenge|concludeChallenge/);
    assert.doesNotMatch(src, /functionName:\s*"conclude"/);
    assert.doesNotMatch(src, /const run = useCallback/);
    assert.doesNotMatch(src, /void run\s*\(/);
    assert.doesNotMatch(src, /writeContractAsync/);
    assert.doesNotMatch(src, /useEvmWriteContract/);

    assert.match(
      src,
      /writeAvail\.available[\s\S]*?bondDisclosure\.configured[\s\S]*?isAvailable\(actionSurface\.conclude\)/,
    );
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.conclude\)/,
    );

    assert.match(src, /submitConclude/);
    assert.equal(vmBranchViolationInSource(src), false);
    assert.equal(vmBranchViolationInSource(hookSource()), false);
  });

  it("admission sweep includes conclude among all four challenge writes", () => {
    const src = panelSource();
    const derived = assertAllBondDisclosureAdmissions(src);
    assert.deepEqual(
      derived,
      ["conclude", "judge", "open", "withdraw"],
      "live panel writeAvail challenge gates",
    );
    assertBondDisclosureAdmission(src, "conclude");
  });

  it("owner is on the VM allowlist; panel and hook are not", () => {
    assert.ok((VM_BRANCH_ALLOWLIST as readonly string[]).includes(OWNER_REL));
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
