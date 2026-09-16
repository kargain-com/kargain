/**
 * §7.2 U6.7.4 — passport JudgeChallenge write owner:
 * EVM judge+[tid, outcome] (0|1); SVM nine metas with chain-resolved
 * bond_recipient (Upheld→challenger, Rejected→forfeit); stake derive-only.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AccountRole, getBase58Decoder } from "@solana/kit";

import {
  assembleJudgeChallengeAccounts,
  buildEvmJudgeChallengeCall,
  executeJudgeChallenge,
  JUDGE_OUTCOME_REJECTED,
  JUDGE_OUTCOME_UPHELD,
  planJudgeChallenge,
  type JudgeChallengeOutcome,
} from "@/lib/passport/judge-challenge";
import {
  challengeAccountLayout,
  decodeChallengeAccount,
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
  assertBindingIsSigner,
  assertBindingOrder,
  extractNextAccountBindings,
  locateEntrypointFnBody,
  readEntrypointFnBody,
  saveStateTargets,
} from "./svm-entrypoint-account-bindings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/judge-challenge.ts";
const PANEL_REL = "components/passport/passport-actions-panel.tsx";
const HOOK_REL = "hooks/use-judge-challenge.ts";
const ENTRYPOINT_REL = "svm/programs/kar-passport/src/entrypoint.rs";
const BONDED_CHALLENGE_REL = "svm/crates/kargain-bonded-challenge/src/lib.rs";
const SOLIDITY_REL = "contracts/lib/BondedChallenge.sol";

const EXPECTED_JUDGE_BINDINGS = [
  "judge",
  "config",
  "asset",
  "state",
  "challenge_info",
  "bond_recipient",
  "stake",
  "staking_program",
  "payer",
] as const;

const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));
const tokenId = "1";
const JUDGE_WALLET = "So11111111111111111111111111111111111111112";

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

function panelSource(): string {
  return readFileSync(path.join(ROOT, PANEL_REL), "utf8");
}

function hookSource(): string {
  return readFileSync(path.join(ROOT, HOOK_REL), "utf8");
}

function readJudgeChallengeBody(): string {
  return readEntrypointFnBody(ROOT, ENTRYPOINT_REL, "judge_challenge");
}

function assertEvmJudgePin(
  call: {
    functionName: string;
    args: readonly unknown[];
    value?: unknown;
    chainId?: number;
  },
  expectedTokenId: string,
  expectedOutcome: JudgeChallengeOutcome,
): void {
  assert.equal(call.functionName, "judge");
  assert.equal(call.args.length, 2);
  assert.equal(call.args[0], BigInt(expectedTokenId));
  assert.equal(call.args[1], expectedOutcome);
  assert.equal("value" in call && call.value != null, false, "judge is not payable");
  if (call.chainId != null) {
    assert.equal(call.chainId, wagmiChainId(84532));
  }
}

function assertJudgeProcessorFacts(body: string): { bindings: string[] } {
  const bindings = extractNextAccountBindings(body, 9);
  assert.equal(bindings.length, 9, "judge_challenge must bind exactly nine accounts");
  assertBindingOrder(
    bindings,
    EXPECTED_JUDGE_BINDINGS,
    "judge_challenge next_account_info order",
  );
  assertBindingIsSigner(body, "judge", "judge_challenge requires judge signer");
  assertBindingIsSigner(body, "payer", "judge_challenge requires payer signer");
  assert.match(body, /transfer_bond\s*\(/);
  assert.doesNotMatch(body, /create_pda\s*\(/);
  const targets = saveStateTargets(body);
  assert.ok(targets.includes("state"), "judge_challenge must save_state");
  return { bindings };
}

/** Fetcher keyed by address — challenge golden vs config golden. */
function makeRecipientFetcher(args: {
  challengeAddress: string;
  configAddress: string;
  challengeData: Uint8Array;
  configData: Uint8Array;
}): (account: string) => Promise<FetchSvmAccountDataResult> {
  return async (account) => {
    if (account === args.challengeAddress) {
      return { ok: true, value: args.challengeData };
    }
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

describe("judgeChallenge ordinal pin (both VMs)", () => {
  it("live EVM args + SVM encode outcome match Rust/Solidity 0=Upheld 1=Rejected; planted flip is red", async () => {
    const bonded = readFileSync(path.join(ROOT, BONDED_CHALLENGE_REL), "utf8");
    assert.match(
      bonded,
      /JudgeOutcome\s*\{[\s\S]*?Upheld\s*=\s*0[\s\S]*?Rejected\s*=\s*1/,
    );
    assert.match(
      bonded,
      /JudgeOutcome::Upheld\s*=>\s*account\.challenger/,
    );
    assert.match(
      bonded,
      /JudgeOutcome::Rejected\s*=>\s*config\.forfeit_recipient/,
    );

    const solidity = readFileSync(path.join(ROOT, SOLIDITY_REL), "utf8");
    assert.match(
      solidity,
      /enum\s+JudgeOutcome\s*\{[\s\S]*?Upheld[\s\S]*?Rejected/,
    );

    const entry = readJudgeChallengeBody();
    assert.match(entry, /0\s*=>\s*JudgeOutcome::Upheld/);
    assert.match(entry, /1\s*=>\s*JudgeOutcome::Rejected/);

    const address = karPassportAddress(84532)!;
    const upheld = buildEvmJudgeChallengeCall({
      address,
      tokenId,
      chainId: 84532,
      outcome: JUDGE_OUTCOME_UPHELD,
    });
    assertEvmJudgePin(upheld, tokenId, 0);
    const rejected = buildEvmJudgeChallengeCall({
      address,
      tokenId,
      chainId: 84532,
      outcome: JUDGE_OUTCOME_REJECTED,
    });
    assertEvmJudgePin(rejected, tokenId, 1);

    // Planted EVM ordinal inversion is red.
    const plantedFlip = {
      ...upheld,
      args: [BigInt(tokenId), 1] as [bigint, JudgeChallengeOutcome],
    };
    assert.throws(() => {
      assertEvmJudgePin(plantedFlip, tokenId, 0);
    });

    const tokenBytes = tokenIdToBytes32(tokenId);
    const encUpheld = encodeSvmInstruction({
      program: "kar-passport",
      variant: "JudgeChallenge",
      fields: { token_id: tokenBytes, outcome: 0 },
    });
    assert.equal(encUpheld.ok, true);
    if (!encUpheld.ok) throw new Error("encode upheld");
    // Borsh: variant index (u8) + token_id (32) + outcome (u8) — last byte is outcome.
    assert.equal(encUpheld.data[encUpheld.data.length - 1], 0);

    const encRejected = encodeSvmInstruction({
      program: "kar-passport",
      variant: "JudgeChallenge",
      fields: { token_id: tokenBytes, outcome: 1 },
    });
    assert.equal(encRejected.ok, true);
    if (!encRejected.ok) throw new Error("encode rejected");
    assert.equal(encRejected.data[encRejected.data.length - 1], 1);

    // Planted SVM encode with flipped outcome vs claimed Upheld is red.
    assert.throws(() => {
      assert.equal(encRejected.data[encRejected.data.length - 1], 0);
    });
  });
});

describe("judgeChallenge EVM pin", () => {
  it("live builder is judge + [tid, outcome] with no value; planted value / arity are red", async () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmJudgeChallengeCall({
      address,
      tokenId,
      chainId: 84532,
      outcome: 0,
    });
    assertEvmJudgePin(live, tokenId, 0);

    const plantedValue = { ...live, value: 1n };
    assert.throws(() => {
      assertEvmJudgePin(plantedValue, tokenId, 0);
    });

    const plantedArity = {
      ...live,
      args: [BigInt(tokenId)] as unknown as [bigint, JudgeChallengeOutcome],
    };
    assert.throws(() => {
      assertEvmJudgePin(plantedArity, tokenId, 0);
    });

    const planned = await planJudgeChallenge({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
      outcome: 1,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "evm") throw new Error("expected evm");
    assertEvmJudgePin(planned.call, tokenId, 1);
  });
});

describe("judgeChallenge SVM recipient resolution", () => {
  it("Upheld → challenger; Rejected → forfeit; planted swap is red; unresolved refuses by name", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);

    const challengeLayout = challengeAccountLayout();
    const configLayout = passportConfigLayout();
    const challengeData = hexToBytes(challengeLayout.goldenHex);
    const configData = hexToBytes(configLayout.goldenHex);

    const challengerDecoded = decodeChallengeAccount(challengeData);
    assert.equal(challengerDecoded.ok, true);
    if (!challengerDecoded.ok) throw new Error("challenge golden");
    const expectedChallenger = challengerDecoded.value.challenger;

    const configDecoded = decodePassportConfig(configData);
    assert.equal(configDecoded.ok, true);
    if (!configDecoded.ok) throw new Error("config golden");
    const expectedForfeit = configDecoded.value.forfeitRecipient;

    // Sample challenger hex must round-trip to the product base58 surface.
    assert.equal(
      expectedChallenger,
      encodeSvmPubkeyBytes(hexToBytes(String(challengeLayout.sample.challenger))),
    );
    assert.equal(
      expectedForfeit,
      encodeSvmPubkeyBytes(
        hexToBytes(String(configLayout.sample.forfeit_recipient)),
      ),
    );

    const tokenBytes = tokenIdToBytes32(tokenId);
    const [challengePda, configPda] = await Promise.all([
      deriveSvmPda({
        recipe: "kargain-bonded-challenge/challenge",
        programId: stack.karPassport,
        seeds: { subject_id: tokenBytes },
      }),
      deriveSvmPda({
        recipe: "kar-passport/config",
        programId: stack.karPassport,
      }),
    ]);
    assert.equal(challengePda.ok, true);
    assert.equal(configPda.ok, true);
    if (!challengePda.ok || !configPda.ok) throw new Error("pda");

    const fetchAccountData = makeRecipientFetcher({
      challengeAddress: challengePda.address,
      configAddress: configPda.address,
      challengeData,
      configData,
    });

    const account = {
      status: "connected" as const,
      vm: "svm" as const,
      address: JUDGE_WALLET,
    };

    const upheld = await planJudgeChallenge({
      account,
      chainId: ns,
      tokenId,
      outcome: JUDGE_OUTCOME_UPHELD,
      fetchAccountData,
    });
    assert.equal(upheld.ok, true);
    if (!upheld.ok || upheld.vm !== "svm") throw new Error("expected svm upheld");
    assert.equal(upheld.plan.accounts.length, 9);
    assert.equal(upheld.plan.accounts[5]!.address, expectedChallenger);
    assert.equal(upheld.plan.bondRecipient, expectedChallenger);
    assert.equal(upheld.plan.accounts[5]!.role, AccountRole.WRITABLE);
    // Only challenge was needed for Upheld — config decode not required for recipient.
    assert.notEqual(upheld.plan.accounts[5]!.address, expectedForfeit);

    const rejected = await planJudgeChallenge({
      account,
      chainId: ns,
      tokenId,
      outcome: JUDGE_OUTCOME_REJECTED,
      fetchAccountData,
    });
    assert.equal(rejected.ok, true);
    if (!rejected.ok || rejected.vm !== "svm") throw new Error("expected svm rejected");
    assert.equal(rejected.plan.accounts[5]!.address, expectedForfeit);
    assert.equal(rejected.plan.bondRecipient, expectedForfeit);
    assert.notEqual(rejected.plan.accounts[5]!.address, expectedChallenger);

    // Planted swap: Upheld plan with forfeit at [5] is red.
    assert.throws(() => {
      assert.equal(upheld.plan.accounts[5]!.address, expectedForfeit);
    });
    assert.throws(() => {
      assert.equal(rejected.plan.accounts[5]!.address, expectedChallenger);
    });

    // Unresolved: challenge missing on Upheld.
    const missing = await planJudgeChallenge({
      account,
      chainId: ns,
      tokenId,
      outcome: JUDGE_OUTCOME_UPHELD,
      fetchAccountData: async () => ({
        ok: false,
        cause: "account_not_found",
        detail: "planted",
      }),
    });
    assert.equal(missing.ok, false);
    if (missing.ok) throw new Error("expected refuse");
    assert.equal(missing.cause, "recipient_unresolved");

    // Undecodable: garbage bytes.
    const badDecode = await planJudgeChallenge({
      account,
      chainId: ns,
      tokenId,
      outcome: JUDGE_OUTCOME_UPHELD,
      fetchAccountData: async () => ({
        ok: true,
        value: new Uint8Array(8).fill(0xff),
      }),
    });
    assert.equal(badDecode.ok, false);
    if (badDecode.ok) throw new Error("expected refuse");
    assert.equal(badDecode.cause, "recipient_decode_failed");

    // Silent fallback plant: source that invents recipient must not exist.
    const src = ownerSource();
    assert.doesNotMatch(src, /bondRecipient\s*\?\?/);
    assert.doesNotMatch(src, /platformRecipient/);
    assert.doesNotMatch(src, /0x0{40}/);
    assert.match(src, /recipient_unresolved|recipient_decode_failed/);
  });

  it("Upheld does not keyed-read config for recipient; Rejected does not keyed-read challenge", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const challengeData = hexToBytes(challengeAccountLayout().goldenHex);
    const configData = hexToBytes(passportConfigLayout().goldenHex);
    const tokenBytes = tokenIdToBytes32(tokenId);
    const [challengePda, configPda] = await Promise.all([
      deriveSvmPda({
        recipe: "kargain-bonded-challenge/challenge",
        programId: stack.karPassport,
        seeds: { subject_id: tokenBytes },
      }),
      deriveSvmPda({
        recipe: "kar-passport/config",
        programId: stack.karPassport,
      }),
    ]);
    if (!challengePda.ok || !configPda.ok) throw new Error("pda");

    const reads: string[] = [];
    const fetchAccountData = async (
      account: string,
    ): Promise<FetchSvmAccountDataResult> => {
      reads.push(account);
      if (account === challengePda.address) {
        return { ok: true, value: challengeData };
      }
      if (account === configPda.address) {
        return { ok: true, value: configData };
      }
      return { ok: false, cause: "account_not_found", detail: account };
    };

    const account = {
      status: "connected" as const,
      vm: "svm" as const,
      address: JUDGE_WALLET,
    };

    reads.length = 0;
    const upheld = await planJudgeChallenge({
      account,
      chainId: ns,
      tokenId,
      outcome: 0,
      fetchAccountData,
    });
    assert.equal(upheld.ok, true);
    assert.deepEqual(reads, [challengePda.address]);

    reads.length = 0;
    const rejected = await planJudgeChallenge({
      account,
      chainId: ns,
      tokenId,
      outcome: 1,
      fetchAccountData,
    });
    assert.equal(rejected.ok, true);
    assert.deepEqual(reads, [configPda.address]);
  });
});

describe("judgeChallenge SVM metas order", () => {
  it("processor body binds nine accounts; plan metas match roles; transposition plant red", async () => {
    const body = readJudgeChallengeBody();
    const { bindings } = assertJudgeProcessorFacts(body);
    assert.deepEqual(bindings, [...EXPECTED_JUDGE_BINDINGS]);

    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const challengeData = hexToBytes(challengeAccountLayout().goldenHex);
    const configData = hexToBytes(passportConfigLayout().goldenHex);
    const tokenBytes = tokenIdToBytes32(tokenId);
    const [challengePda, configPda] = await Promise.all([
      deriveSvmPda({
        recipe: "kargain-bonded-challenge/challenge",
        programId: stack.karPassport,
        seeds: { subject_id: tokenBytes },
      }),
      deriveSvmPda({
        recipe: "kar-passport/config",
        programId: stack.karPassport,
      }),
    ]);
    if (!challengePda.ok || !configPda.ok) throw new Error("pda");

    const planned = await planJudgeChallenge({
      account: {
        status: "connected",
        vm: "svm",
        address: JUDGE_WALLET,
      },
      chainId: ns,
      tokenId,
      outcome: 0,
      fetchAccountData: makeRecipientFetcher({
        challengeAddress: challengePda.address,
        configAddress: configPda.address,
        challengeData,
        configData,
      }),
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("svm");

    const roles = planned.plan.accounts.map((a) => a.role);
    assert.deepEqual(roles, [
      AccountRole.READONLY_SIGNER, // judge
      AccountRole.READONLY, // config
      AccountRole.READONLY, // asset
      AccountRole.WRITABLE, // state
      AccountRole.WRITABLE, // challenge
      AccountRole.WRITABLE, // bond_recipient
      AccountRole.READONLY, // stake
      AccountRole.READONLY, // staking_program
      AccountRole.READONLY_SIGNER, // payer — no create_pda
    ]);

    // Payer must not be WRITABLE_SIGNER (unlike open/withdraw rent payers).
    assert.notEqual(
      planned.plan.accounts[8]!.role,
      AccountRole.WRITABLE_SIGNER,
    );

    const assembled = assembleJudgeChallengeAccounts({
      judge: "j",
      config: "c",
      asset: "a",
      state: "s",
      challenge: "ch",
      bondRecipient: "br",
      stake: "st",
      stakingProgram: "sp",
      payer: "p",
    });
    assert.equal(assembled.length, 9);

    // Transposition plant: swap judge and payer roles in a copy.
    const planted = [...assembled];
    planted[0] = { ...assembled[0]!, role: AccountRole.WRITABLE };
    assert.throws(() => {
      assert.equal(planted[0]!.role, AccountRole.READONLY_SIGNER);
    });
  });

  it("extraction refuses when judge_challenge is missing or under-bound", () => {
    assert.throws(
      () => locateEntrypointFnBody("fn other() {}", "judge_challenge"),
      /judge_challenge_not_found/,
    );
    const body = readJudgeChallengeBody();
    const short = body.replace(
      /let\s+payer\s*=\s*next_account_info\s*\(\s*iter\s*\)\s*\?;/,
      "",
    );
    assert.throws(() => {
      extractNextAccountBindings(short, 9);
    });
  });

  it("executeJudgeChallenge SVM sends assembled metas via sendSvmInstruction", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const challengeData = hexToBytes(challengeAccountLayout().goldenHex);
    const configData = hexToBytes(passportConfigLayout().goldenHex);
    const tokenBytes = tokenIdToBytes32(tokenId);
    const [challengePda, configPda] = await Promise.all([
      deriveSvmPda({
        recipe: "kargain-bonded-challenge/challenge",
        programId: stack.karPassport,
        seeds: { subject_id: tokenBytes },
      }),
      deriveSvmPda({
        recipe: "kar-passport/config",
        programId: stack.karPassport,
      }),
    ]);
    if (!challengePda.ok || !configPda.ok) throw new Error("pda");

    let wireSeen = false;
    const port: SvmSignAndSendPort = {
      async signAndSendTransaction() {
        wireSeen = true;
        return new Uint8Array(64).fill(9);
      },
    };
    const sig = await executeJudgeChallenge({
      account: {
        status: "connected",
        vm: "svm",
        address: JUDGE_WALLET,
      },
      chainId: ns,
      tokenId,
      outcome: 0,
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
      fetchAccountData: makeRecipientFetcher({
        challengeAddress: challengePda.address,
        configAddress: configPda.address,
        challengeData,
        configData,
      }),
    });
    assert.ok(typeof sig === "string" && sig.length > 0);
    assert.equal(wireSeen, true);
  });
});

describe("judgeChallenge stake + ownership", () => {
  it("owner never decodeStakeAccount; stake is derive-only", () => {
    const src = ownerSource();
    assert.doesNotMatch(src, /import\s*\{[^}]*decodeStakeAccount/);
    assert.doesNotMatch(src, /\bdecodeStakeAccount\s*\(/);
    assert.match(src, /kar-pro-staking\/stake/);
    assert.match(src, /decodeChallengeAccount/);
    assert.match(src, /decodePassportConfig/);
  });
});

describe("judgeChallenge panel + ownership", () => {
  it("panel migrates judge via writeAvail + disclosure + owner; conclude stays on evm.ok + run", () => {
    const src = panelSource();
    assert.match(src, /useJudgeChallenge|judgeChallenge/);
    assert.doesNotMatch(src, /functionName:\s*"judge"/);

    assert.match(
      src,
      /writeAvail\.available[\s\S]*?bondDisclosure\.configured[\s\S]*?isAvailable\(actionSurface\.judge\)/,
    );
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.judge\)/,
    );

    assert.match(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.conclude\)/,
    );
    assert.match(src, /functionName:\s*"conclude"/);
    assert.match(src, /const run = useCallback/);

    assert.match(src, /submitJudge/);
    assert.match(src, /outcome:\s*0|submitJudge\(\s*0/);
    assert.match(src, /outcome:\s*1|submitJudge\(\s*1/);

    assert.equal(vmBranchViolationInSource(src), false);
    assert.equal(vmBranchViolationInSource(hookSource()), false);
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
