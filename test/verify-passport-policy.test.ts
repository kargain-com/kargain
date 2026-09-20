/**
 * §7.2 U6.6 — passport VerifyPassport write owner: EVM 1-arg pin,
 * no freshness, five SVM metas, stake derive-only, neighbours untouched.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AccountRole, getBase58Decoder } from "@solana/kit";

import {
  VERIFICATION_INSTANCE,
  deriveChallengeSurface,
} from "@/lib/challenge";
import {
  derivePassportActionSurface,
  isAvailable,
} from "@/lib/passport/action-surface";
import {
  assembleVerifyPassportAccounts,
  buildEvmVerifyPassportCall,
  executeVerifyPassport,
  planVerifyPassport,
} from "@/lib/passport/verify-passport";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";
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
  assertBindingOrder as assertBindingsEqual,
  extractNextAccountBindings,
  locateEntrypointFnBody,
  readEntrypointFnBody,
  saveStateTargets,
} from "./svm-entrypoint-account-bindings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/verify-passport.ts";
const ATTEST_OWNER_REL = "lib/passport/append-passport-attestation.ts";
const APPEND_OWNER_REL = "lib/passport/append-passport-record.ts";
const REPORT_OWNER_REL = "lib/passport/report-passport-discrepancy.ts";
const PANEL_REL = "components/passport/passport-actions-panel.tsx";
const HOOK_REL = "hooks/use-verify-passport.ts";

const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));

const ENTRYPOINT_REL = "svm/programs/kar-passport/src/entrypoint.rs";
const EXPECTED_VERIFY_BINDINGS = [
  "config",
  "asset",
  "state",
  "stake",
  "verifier",
] as const;

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

function siblingSource(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function panelSource(): string {
  return readFileSync(path.join(ROOT, PANEL_REL), "utf8");
}

/** Suite-local wrappers — identities preserved; body from shared extraction. */
function locateVerifyPassportBody(source: string): string {
  return locateEntrypointFnBody(source, "verify_passport");
}

function readVerifyPassportProcessorBody(): string {
  return readEntrypointFnBody(ROOT, ENTRYPOINT_REL, "verify_passport");
}

function extractVerifyBindings(body: string): string[] {
  return extractNextAccountBindings(body, 5);
}

function assertBindingOrder(bindings: readonly string[]): void {
  assertBindingsEqual(
    bindings,
    EXPECTED_VERIFY_BINDINGS,
    "verify_passport next_account_info order",
  );
}

function assertLastBindingIsSigner(
  body: string,
  bindings: readonly string[],
): void {
  const last = bindings[bindings.length - 1]!;
  assertBindingIsSigner(
    body,
    last,
    `verify_passport requires last binding (${last}) to be a signer`,
  );
}

function assertPersistStateOnly(body: string): void {
  const targets = saveStateTargets(body);
  assert.ok(
    targets.length >= 1,
    "verify_passport must persist via save_state",
  );
  assert.ok(
    targets.every((t) => t === "state"),
    `verify_passport save_state must target state only; got ${targets.join(",")}`,
  );
  assert.doesNotMatch(
    body,
    /save_state\s*\(\s*(?:config|asset|stake)\s*,/,
    "verify_passport must not persist config/asset/stake",
  );
}

function assertNoAccountCreation(body: string): void {
  assert.doesNotMatch(
    body,
    /\bsystem_program\b/,
    "verify_passport must not invoke system_program",
  );
  assert.doesNotMatch(
    body,
    /\bcreate_account\b/,
    "verify_passport must not create_account",
  );
  assert.doesNotMatch(
    body,
    /\binvoke\s*\(/,
    "verify_passport must not CPI-create accounts",
  );
  assert.doesNotMatch(
    body,
    /\bpayer\b/,
    "verify_passport must not take a payer",
  );
}

/** Processor facts measured from `fn verify_passport` body text. */
function assertVerifyPassportProcessorFacts(body: string): {
  bindings: string[];
  persistTarget: string;
} {
  const bindings = extractVerifyBindings(body);
  assert.equal(bindings.length, 5, "verify_passport must bind exactly five accounts");
  assertBindingOrder(bindings);
  assertLastBindingIsSigner(body, bindings);
  assertPersistStateOnly(body);
  assertNoAccountCreation(body);
  const targets = saveStateTargets(body);
  return { bindings, persistTarget: targets[0]! };
}

function assertEvmCallPin(
  call: {
    functionName: string;
    args: readonly unknown[];
    address?: string;
  },
  tokenId: string,
): void {
  assert.equal(call.functionName, "verifyPassport");
  assert.equal(call.args.length, 1);
  assert.deepEqual(call.args, [BigInt(tokenId)]);
}

function presenceHere(viewChainId = 84532) {
  return {
    viewChainId,
    custodyLock: { status: "known", locked: false } as const,
    ponderCustodyChain: viewChainId,
    custodyUnresolved: null,
  };
}

function challengeIdle(wallet: string) {
  return deriveChallengeSurface(VERIFICATION_INSTANCE, {
    challenge: null,
    wallet,
    isActiveVerifier: false,
    passportStatus: "UNVERIFIED",
    owner: wallet,
    recordedVerifier: "0x2222222222222222222222222222222222222222",
    opener: "",
    nowSec: 1_700_000_000,
    requireDisputedStatus: true,
  });
}

describe("verifyPassport EVM behavioural pin", () => {
  const tokenId = "42";

  it("buildEvmVerifyPassportCall yields verifyPassport with exactly one argument", () => {
    const address = karPassportAddress(84532);
    assert.ok(address);
    const call = buildEvmVerifyPassportCall({
      address,
      tokenId,
      chainId: 84532,
    });
    assertEvmCallPin(call, tokenId);
    assert.equal(call.chainId, wagmiChainId(84532));
    assert.equal(call.address, address);
  });

  it("planVerifyPassport EVM arm matches today's call for live hub", async () => {
    const planned = await planVerifyPassport({
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
    if (!planned.ok || planned.vm !== "evm") throw new Error("expected evm plan");
    assertEvmCallPin(planned.call, tokenId);
  });

  it("planted second argument (fee / URI) is red; live one-arg is green", () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmVerifyPassportCall({
      address,
      tokenId,
      chainId: 84532,
    });
    assertEvmCallPin(live, tokenId);

    const plantedTwoArgs = {
      ...live,
      args: [BigInt(tokenId), "ar://fee-or-uri"] as unknown as [bigint],
    };
    assert.throws(() => {
      assertEvmCallPin(plantedTwoArgs, tokenId);
    });
    assert.equal(live.args.length, 1);
  });

  it("planted setPassportURI functionName is red; live builder is green", () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmVerifyPassportCall({
      address,
      tokenId,
      chainId: 84532,
    });
    assertEvmCallPin(live, tokenId);

    const planted = {
      ...live,
      functionName: "setPassportURI" as const,
    };
    assert.throws(() => {
      assertEvmCallPin(planted, tokenId);
    });
  });

  it("executeVerifyPassport EVM passes the pinned call through writeEvmContract", async () => {
    const address = karPassportAddress(84532)!;
    let captured: unknown;
    const hash = await executeVerifyPassport({
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
    assertEvmCallPin(
      captured as { functionName: string; args: readonly unknown[] },
      tokenId,
    );
    assert.equal((captured as { address: string }).address, address);
  });
});

describe("verifyPassport SVM no-freshness (inverse of U6.3)", () => {
  it("owner source performs zero state reads; plant decodePassportState / fetchAccountData is red", () => {
    const src = ownerSource();
    assert.doesNotMatch(src, /decodePassportState/);
    assert.doesNotMatch(src, /fetchAccountData/);
    assert.doesNotMatch(src, /fetchProductSvmAccountData/);
    assert.doesNotMatch(src, /createProductSvmKeyedAccountSource/);
    assert.doesNotMatch(src, /recordCount/);
    assert.doesNotMatch(src, /kar-passport\/record/);

    const plantedDecode = src + "\n  const d = decodePassportState(bytes);\n";
    assert.throws(() => {
      assert.doesNotMatch(plantedDecode, /decodePassportState/);
    });

    const plantedFetch =
      src + "\n  const fetched = await fetchAccountData(statePda.address);\n";
    assert.throws(() => {
      assert.doesNotMatch(plantedFetch, /fetchAccountData/);
    });
  });

  it("two plan assemblies still perform zero account-data fetches", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0, "live SVM commercial row required");
    const ns = namespaces[0]!;
    const verifier = "So11111111111111111111111111111111111111112";

    const first = await planVerifyPassport({
      account: { status: "connected", vm: "svm", address: verifier },
      chainId: ns,
      tokenId: "1",
    });
    const second = await planVerifyPassport({
      account: { status: "connected", vm: "svm", address: verifier },
      chainId: ns,
      tokenId: "1",
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || first.vm !== "svm") throw new Error("expected svm");
    if (!second.ok || second.vm !== "svm") throw new Error("expected svm");
    assert.equal(first.plan.accounts.length, 5);
    assert.equal(second.plan.accounts.length, 5);
    // Addresses are pure derives — identical across assemblies without a read.
    assert.equal(first.plan.accounts[2]!.address, second.plan.accounts[2]!.address);
  });
});

describe("verifyPassport SVM no stake-data decode", () => {
  it("owner source never calls decodeStakeAccount; plant is red", () => {
    const src = ownerSource();
    assert.doesNotMatch(src, /decodeStakeAccount/);
    assert.match(src, /kar-pro-staking\/stake/);

    const plantedStakeDecode = src + "\n  await decodeStakeAccount(stakeBytes);\n";
    assert.throws(() => {
      assert.doesNotMatch(plantedStakeDecode, /decodeStakeAccount/);
    });
  });
});

describe("verifyPassport SVM metas order", () => {
  // Processor facts measured from entrypoint.rs `fn verify_passport` — not line cites.
  it("processor body binds five accounts; plan metas match roles; plants go through extraction", async () => {
    const body = readVerifyPassportProcessorBody();
    const liveFacts = assertVerifyPassportProcessorFacts(body);
    assert.deepEqual(liveFacts.bindings, [...EXPECTED_VERIFY_BINDINGS]);
    assert.equal(liveFacts.persistTarget, "state");

    // Plant: transpose state ↔ stake bindings — order assertion red.
    const plantedOrderBody = body
      .replace(
        /let\s+state\s*=\s*next_account_info\s*\(\s*iter\s*\)\s*\?/,
        "let __tmp_state_binding = next_account_info(iter)?",
      )
      .replace(
        /let\s+stake\s*=\s*next_account_info\s*\(\s*iter\s*\)\s*\?/,
        "let state = next_account_info(iter)?",
      )
      .replace(
        /let\s+__tmp_state_binding\s*=\s*next_account_info\s*\(\s*iter\s*\)\s*\?/,
        "let stake = next_account_info(iter)?",
      );
    assert.throws(
      () => {
        assertVerifyPassportProcessorFacts(plantedOrderBody);
      },
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        return true;
      },
      "planted transposed bindings must turn order assertion red",
    );
    // Live green after plant red.
    assertVerifyPassportProcessorFacts(body);

    // Plant: save_state targets stake — writable-set assertion red.
    const plantedPersistBody = body.replace(
      /save_state\s*\(\s*state\s*,/,
      "save_state(stake,",
    );
    assert.throws(
      () => {
        assertVerifyPassportProcessorFacts(plantedPersistBody);
      },
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        return true;
      },
      "planted save_state(stake) must turn persist assertion red",
    );
    assertVerifyPassportProcessorFacts(body);

    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const verifier = "So11111111111111111111111111111111111111112";
    const tokenId = "1";
    const tokenBytes = tokenIdToBytes32(tokenId);

    const planned = await planVerifyPassport({
      account: { status: "connected", vm: "svm", address: verifier },
      chainId: ns,
      tokenId,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("expected svm");

    const accounts = planned.plan.accounts;
    assert.equal(accounts.length, 5);
    // Same five positions the processor binds: config, asset, state, stake, verifier.
    assert.equal(accounts[0]!.role, AccountRole.READONLY);
    assert.equal(accounts[1]!.role, AccountRole.READONLY);
    assert.equal(accounts[2]!.role, AccountRole.WRITABLE);
    assert.equal(accounts[3]!.role, AccountRole.READONLY);
    assert.equal(accounts[4]!.role, AccountRole.READONLY_SIGNER);
    assert.equal(accounts[4]!.address, verifier);
    assert.equal(planned.plan.programId, stack.karPassport);
    assert.equal(planned.plan.feePayer, verifier);

    const [expectedConfig, expectedAsset, expectedState, expectedStake] =
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
          recipe: "kar-pro-staking/stake",
          programId: stack.karProStaking,
          seeds: { verifier },
        }),
      ]);
    assert.equal(expectedConfig.ok, true);
    assert.equal(expectedAsset.ok, true);
    assert.equal(expectedState.ok, true);
    assert.equal(expectedStake.ok, true);
    if (
      !expectedConfig.ok ||
      !expectedAsset.ok ||
      !expectedState.ok ||
      !expectedStake.ok
    ) {
      return;
    }
    assert.equal(accounts[0]!.address, expectedConfig.address);
    assert.equal(accounts[1]!.address, expectedAsset.address);
    assert.equal(accounts[2]!.address, expectedState.address);
    assert.equal(accounts[3]!.address, expectedStake.address);

    const plantedConstant = assembleVerifyPassportAccounts({
      config: accounts[0]!.address,
      asset: accounts[1]!.address,
      state: accounts[0]!.address,
      stake: accounts[3]!.address,
      verifier,
    });
    assert.throws(() => {
      assert.equal(plantedConstant[2]!.address, expectedState.address);
    });
  });

  it("extraction refuses when verify_passport is missing or under-bound", () => {
    assert.throws(
      () => extractVerifyBindings("fn other() { Ok(()) }"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /binding_count_below_five/);
        return true;
      },
    );

    assert.throws(
      () =>
        locateVerifyPassportBody(
          "pub fn something_else() -> ProgramResult { Ok(()) }\n",
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "verify_passport_not_found");
        return true;
      },
    );

    // Live entrypoint locates and yields five bindings.
    const live = extractVerifyBindings(readVerifyPassportProcessorBody());
    assert.deepEqual(live, [...EXPECTED_VERIFY_BINDINGS]);
  });

  it("executeVerifyPassport SVM sends assembled metas via sendSvmInstruction", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const verifier = "So11111111111111111111111111111111111111112";
    let wireSeen = false;
    const port: SvmSignAndSendPort = {
      async signAndSendTransaction() {
        wireSeen = true;
        return new Uint8Array(64).fill(9);
      },
    };
    const sig = await executeVerifyPassport({
      account: { status: "connected", vm: "svm", address: verifier },
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
    assert.equal(typeof sig, "string");
    assert.equal(sig.length > 0, true);
    assert.equal(wireSeen, true);
  });
});

describe("verifyPassport action-surface gates unchanged", () => {
  it("active verifier + not owner + UNVERIFIED offered; inactive / owner / wrong status blocked", () => {
    const ownerWallet = "0x0000000000000000000000000000000000000001";
    const verifierWallet = "0x00000000000000000000000000000000000000aa";

    const inactive = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(verifierWallet),
      wallet: verifierWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: false,
      status: "UNVERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(inactive.verify), false);
    assert.equal(
      inactive.verify.status === "blocked" && inactive.verify.cause,
      "not_verifier",
    );

    const unresolved = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(verifierWallet),
      wallet: verifierWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: undefined,
      status: "UNVERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(unresolved.verify), false);
    assert.equal(
      unresolved.verify.status === "blocked" && unresolved.verify.cause,
      "verifier_unresolved",
    );

    const active = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(verifierWallet),
      wallet: verifierWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: true,
      status: "UNVERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(active.verify), true);

    const ownerActive = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(ownerWallet),
      wallet: ownerWallet,
      isOwner: true,
      holder: true,
      isActiveVerifier: true,
      status: "UNVERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(ownerActive.verify), false);
    assert.equal(
      ownerActive.verify.status === "blocked" && ownerActive.verify.cause,
      "is_owner",
    );

    const wrongStatus = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(verifierWallet),
      wallet: verifierWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: true,
      status: "VERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(wrongStatus.verify), false);
    assert.equal(
      wrongStatus.verify.status === "blocked" && wrongStatus.verify.cause,
      "wrong_status",
    );
  });
});

describe("verifyPassport no fusion with record-writing siblings", () => {
  it("owners do not import each other; assemblers and variants stay distinct", () => {
    const verify = ownerSource();
    const attest = siblingSource(ATTEST_OWNER_REL);
    const append = siblingSource(APPEND_OWNER_REL);
    const report = siblingSource(REPORT_OWNER_REL);

    assert.doesNotMatch(
      verify,
      /from\s+["'][^"']*append-passport-attestation["']/,
    );
    assert.doesNotMatch(
      verify,
      /from\s+["'][^"']*append-passport-record["']/,
    );
    assert.doesNotMatch(
      verify,
      /from\s+["'][^"']*report-passport-discrepancy["']/,
    );
    assert.doesNotMatch(
      attest,
      /from\s+["'][^"']*verify-passport["']/,
    );
    assert.doesNotMatch(
      append,
      /from\s+["'][^"']*verify-passport["']/,
    );
    assert.doesNotMatch(
      report,
      /from\s+["'][^"']*verify-passport["']/,
    );

    assert.match(verify, /assembleVerifyPassportAccounts/);
    assert.match(verify, /variant:\s*"VerifyPassport"/);
    assert.doesNotMatch(verify, /assembleAppendPassportAttestationAccounts/);
    assert.doesNotMatch(verify, /assembleAppendPassportRecordAccounts/);
    assert.doesNotMatch(verify, /assembleReportPassportDiscrepancyAccounts/);
    assert.doesNotMatch(verify, /variant:\s*"AppendAttestation"/);
    assert.doesNotMatch(verify, /variant:\s*"AppendRecord"/);
    assert.doesNotMatch(verify, /variant:\s*"ReportDiscrepancy"/);
    assert.doesNotMatch(verify, /preparePassportRecordWrite/);

    const plantedFusion = [
      'import { assembleAppendPassportAttestationAccounts as assembleVerifyPassportAccounts } from "@/lib/passport/append-passport-attestation";',
      "export { assembleVerifyPassportAccounts };",
    ].join("\n");
    assert.throws(() => {
      assert.doesNotMatch(
        plantedFusion,
        /from\s+["'][^"']*append-passport-attestation["']/,
      );
    });
  });
});

describe("verifyPassport ownership + panel surface + neighbours", () => {
  it("owner composes encode / derive / send / tokenIdToBytes32; no decode / system / core", () => {
    const src = ownerSource();
    assert.match(src, /encodeSvmInstruction/);
    assert.match(src, /deriveSvmPda/);
    assert.match(src, /sendSvmInstruction/);
    assert.match(src, /tokenIdToBytes32/);
    assert.doesNotMatch(src, /decodePassportState/);
    assert.doesNotMatch(src, /decodeStakeAccount/);
    assert.doesNotMatch(src, /systemProgramId/);
    assert.doesNotMatch(src, /mplCoreProgramId/);
    assert.doesNotMatch(src, /@solana\/web3\.js/);
  });

  it("panel migrates verify via writeAvail + owner; conclude stays on evm.ok; no if(vm)", () => {
    const src = panelSource();
    assert.match(src, /useVerifyPassport|verifyPassport/);
    assert.match(src, /useActiveVerifierFact/);
    assert.match(src, /TxWriteRefusal/);
    assert.match(src, /txWriteAvailability/);
    assert.doesNotMatch(src, /functionName:\s*"verifyPassport"/);

    const verifySubmit = src.match(
      /const submitVerify = useCallback\(async \(\) => \{[\s\S]*?\}, \[/,
    );
    assert.ok(verifySubmit);
    assert.doesNotMatch(verifySubmit![0]!, /preparePassportRecordWrite/);
    assert.match(verifySubmit![0]!, /verifyPassport/);

    // Chrome gate is writeAvail, not evm.ok.
    assert.match(
      src,
      /writeAvail\.available[\s\S]*?isAvailable\(actionSurface\.verify\)/,
    );
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.verify\)/,
    );

    // Open + withdraw migrated — no longer gated on evm.ok.
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.open\)/,
    );
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.withdraw\)/,
    );
    assert.doesNotMatch(src, /functionName:\s*"withdraw"/);
    assert.match(src, /useWithdrawChallenge|withdrawChallenge/);
    // Judge + conclude migrated; no legacy run helper.
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.judge\)/,
    );
    assert.doesNotMatch(src, /functionName:\s*"judge"/);
    assert.match(src, /useJudgeChallenge|judgeChallenge/);
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.conclude\)/,
    );
    assert.doesNotMatch(src, /functionName:\s*"conclude"/);
    assert.match(src, /useConcludeChallenge|concludeChallenge/);
    assert.doesNotMatch(src, /const run = useCallback/);

    assert.equal(vmBranchViolationInSource(src), false);

    // Planted old verify evm.ok gate — red.
    const plantedVerifyEvmOk =
      "passport && evm.ok && isAvailable(actionSurface.verify)";
    assert.throws(() => {
      assert.doesNotMatch(
        plantedVerifyEvmOk,
        /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.verify\)/,
      );
    });
  });

  it("owner is on the VM branch allowlist; panel and hook are not", () => {
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
