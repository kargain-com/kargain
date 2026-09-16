/**
 * §7.2 U6.5 — passport AppendAttestation write owner: EVM 3-arg pin,
 * freshness, eight SVM metas, stake derive-only, no fusion with siblings.
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
  assembleAppendPassportAttestationAccounts,
  buildEvmAppendPassportAttestationCall,
  executeAppendPassportAttestation,
  planAppendPassportAttestation,
} from "@/lib/passport/append-passport-attestation";
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/append-passport-attestation.ts";
const APPEND_OWNER_REL = "lib/passport/append-passport-record.ts";
const REPORT_OWNER_REL = "lib/passport/report-passport-discrepancy.ts";
const PREP_REL = "lib/passport/prepare-passport-record-write.ts";
const PANEL_REL = "components/passport/passport-actions-panel.tsx";
const HOOK_REL = "hooks/use-append-passport-attestation.ts";

const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));

/** PassportState.record_count starts at byte 83 (u32 LE). */
const RECORD_COUNT_OFFSET = 8 + 32 + 1 + 32 + 8 + 1 + 1;

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

function siblingSource(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function panelSource(): string {
  return readFileSync(path.join(ROOT, PANEL_REL), "utf8");
}

function assertEvmCallPin(
  call: {
    functionName: string;
    args: readonly unknown[];
    address?: string;
  },
  tokenId: string,
  description: string,
  evidenceCid: string,
): void {
  assert.equal(call.functionName, "appendAttestation");
  assert.equal(call.args.length, 3);
  assert.deepEqual(call.args, [
    BigInt(tokenId),
    description,
    evidenceCid,
  ]);
}

function stateBytesWithRecordCount(count: number): Uint8Array {
  const layout = passportStateLayout();
  const bytes = hexToBytes(layout.goldenHex);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(RECORD_COUNT_OFFSET, count >>> 0, true);
  return bytes;
}

function presenceHere(viewChainId = 84532) {
  return {
    viewChainId,
    custodyLocked: false as const,
    ponderCustodyChain: viewChainId,
    custodyUnresolved: null,
  };
}

function challengeIdle(wallet: string) {
  return deriveChallengeSurface(VERIFICATION_INSTANCE, {
    challenge: null,
    wallet,
    isActiveVerifier: false,
    passportStatus: "VERIFIED",
    owner: wallet,
    recordedVerifier: "0x2222222222222222222222222222222222222222",
    opener: "",
    nowSec: 1_700_000_000,
    requireDisputedStatus: true,
  });
}

describe("appendPassportAttestation EVM behavioural pin", () => {
  const tokenId = "42";
  const description = "Mileage confirmed at inspection";
  const evidenceCid = "ar://attestation";

  it("buildEvmAppendPassportAttestationCall yields appendAttestation with three args", () => {
    const address = karPassportAddress(84532);
    assert.ok(address);
    const call = buildEvmAppendPassportAttestationCall({
      address,
      tokenId,
      description,
      evidenceCid,
      chainId: 84532,
    });
    assertEvmCallPin(call, tokenId, description, evidenceCid);
    assert.equal(call.chainId, wagmiChainId(84532));
    assert.equal(call.address, address);
  });

  it("planAppendPassportAttestation EVM arm matches today's call for live hub", async () => {
    const planned = await planAppendPassportAttestation({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
      description,
      evidenceCid,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "evm") throw new Error("expected evm plan");
    assertEvmCallPin(planned.call, tokenId, description, evidenceCid);
  });

  it("planted fourth argument (appendRecord shape) is red; live three-arg is green", () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmAppendPassportAttestationCall({
      address,
      tokenId,
      description,
      evidenceCid,
      chainId: 84532,
    });
    assertEvmCallPin(live, tokenId, description, evidenceCid);

    const plantedFourArgs = {
      ...live,
      args: [
        BigInt(tokenId),
        "attestation",
        description,
        evidenceCid,
      ] as unknown as [bigint, string, string],
    };
    assert.throws(() => {
      assertEvmCallPin(
        plantedFourArgs,
        tokenId,
        description,
        evidenceCid,
      );
    });
    assert.equal(live.args.length, 3);
  });

  it("planted appendRecord functionName is red; live builder is green", () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmAppendPassportAttestationCall({
      address,
      tokenId,
      description,
      evidenceCid,
      chainId: 84532,
    });
    assertEvmCallPin(live, tokenId, description, evidenceCid);

    const planted = {
      ...live,
      functionName: "appendRecord" as const,
    };
    assert.throws(() => {
      assertEvmCallPin(planted, tokenId, description, evidenceCid);
    });
  });

  it("executeAppendPassportAttestation EVM passes the pinned call through writeEvmContract", async () => {
    const address = karPassportAddress(84532)!;
    let captured: unknown;
    const hash = await executeAppendPassportAttestation({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
      description,
      evidenceCid,
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
      description,
      evidenceCid,
    );
    assert.equal((captured as { address: string }).address, address);
  });
});

describe("appendPassportAttestation SVM freshness", () => {
  it("every assembly re-reads state; plant cached recordCount is red", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0, "live SVM commercial row required");
    const ns = namespaces[0]!;
    const attester = "So11111111111111111111111111111111111111112";
    const tokenId = "1";
    let fetchCount = 0;
    const fetchAccountData = async () => {
      fetchCount += 1;
      return { ok: true as const, value: stateBytesWithRecordCount(7) };
    };

    const first = await planAppendPassportAttestation({
      account: { status: "connected", vm: "svm", address: attester },
      chainId: ns,
      tokenId,
      description: "first",
      evidenceCid: "",
      fetchAccountData,
    });
    const second = await planAppendPassportAttestation({
      account: { status: "connected", vm: "svm", address: attester },
      chainId: ns,
      tokenId,
      description: "second",
      evidenceCid: "",
      fetchAccountData,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(fetchCount, 2, "live owner must fetch on every assembly");

    if (!first.ok || first.vm !== "svm") throw new Error("expected svm");
    if (!second.ok || second.vm !== "svm") throw new Error("expected svm");
    assert.equal(second.plan.recordCount, first.plan.recordCount);
    assert.throws(() => {
      assert.equal(
        fetchCount,
        1,
        "planted single-fetch across two assemblies",
      );
    });
  });

  it("planted stale count yields a different record PDA than the fresh decode", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const attester = "So11111111111111111111111111111111111111112";
    const tokenId = "1";
    const tokenBytes = tokenIdToBytes32(tokenId);
    const freshCount = 7;
    const staleCount = 3;

    const planned = await planAppendPassportAttestation({
      account: { status: "connected", vm: "svm", address: attester },
      chainId: ns,
      tokenId,
      description: "fresh",
      evidenceCid: "",
      fetchAccountData: async () => ({
        ok: true,
        value: stateBytesWithRecordCount(freshCount),
      }),
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("expected svm");
    assert.equal(planned.plan.recordCount, freshCount);

    const freshPda = await deriveSvmPda({
      recipe: "kar-passport/record",
      programId: stack.karPassport,
      seeds: { token_id: tokenBytes, index: freshCount },
    });
    const stalePda = await deriveSvmPda({
      recipe: "kar-passport/record",
      programId: stack.karPassport,
      seeds: { token_id: tokenBytes, index: staleCount },
    });
    assert.equal(freshPda.ok, true);
    assert.equal(stalePda.ok, true);
    if (!freshPda.ok || !stalePda.ok) return;
    assert.equal(planned.plan.accounts[3]!.address, freshPda.address);
    assert.notEqual(freshPda.address, stalePda.address);

    assert.throws(() => {
      assert.equal(
        planned.plan.accounts[3]!.address,
        stalePda.address,
        "planted stale record PDA",
      );
    });
  });
});

describe("appendPassportAttestation SVM metas order", () => {
  // Processor: entrypoint.rs append_attestation
  // :835 config (READONLY — load_config :847), :836 asset (READONLY),
  // :837 state, :838 record, :839 attester (signer), :840 stake (READONLY),
  // :841 payer, :842 system.
  it("eight accounts in processor order; asset read-only; stake derived not read", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const attester = "So11111111111111111111111111111111111111112";
    const tokenId = "1";
    const recordCount = 11;
    const fetchedAccounts: string[] = [];

    const planned = await planAppendPassportAttestation({
      account: { status: "connected", vm: "svm", address: attester },
      chainId: ns,
      tokenId,
      description: "metas",
      evidenceCid: "ar://x",
      fetchAccountData: async (account) => {
        fetchedAccounts.push(account);
        return {
          ok: true,
          value: stateBytesWithRecordCount(recordCount),
        };
      },
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("expected svm");

    const accounts = planned.plan.accounts;
    assert.equal(accounts.length, 8);
    assert.equal(accounts[0]!.role, AccountRole.READONLY); // config :835/:847
    assert.equal(accounts[1]!.role, AccountRole.READONLY); // asset :836
    assert.equal(accounts[2]!.role, AccountRole.WRITABLE); // state :837
    assert.equal(accounts[3]!.role, AccountRole.WRITABLE); // record :838
    assert.equal(accounts[4]!.role, AccountRole.READONLY_SIGNER); // attester :839
    assert.equal(accounts[5]!.role, AccountRole.READONLY); // stake :840
    assert.equal(accounts[6]!.role, AccountRole.WRITABLE_SIGNER); // payer :841
    assert.equal(accounts[7]!.role, AccountRole.READONLY); // system :842
    assert.equal(accounts[4]!.address, attester);
    assert.equal(accounts[6]!.address, attester);
    assert.equal(accounts[7]!.address, systemProgramId());
    assert.equal(planned.plan.programId, stack.karPassport);
    assert.equal(planned.plan.feePayer, attester);
    assert.equal(planned.plan.recordCount, recordCount);

    const expectedStake = await deriveSvmPda({
      recipe: "kar-pro-staking/stake",
      programId: stack.karProStaking,
      seeds: { verifier: attester },
    });
    assert.equal(expectedStake.ok, true);
    if (!expectedStake.ok) return;
    assert.equal(accounts[5]!.address, expectedStake.address);

    // Freshness fetch is state only — stake data must not be read to assemble.
    assert.equal(fetchedAccounts.length, 1);
    assert.equal(fetchedAccounts[0], accounts[2]!.address);
    assert.notEqual(fetchedAccounts[0], accounts[5]!.address);

    // Plant: assembler reads stake data — red against live law.
    const plantedStakeRead = [...fetchedAccounts, accounts[5]!.address];
    assert.throws(() => {
      assert.equal(
        plantedStakeRead.length,
        1,
        "planted stake-data read in assembler",
      );
      assert.ok(!plantedStakeRead.includes(accounts[5]!.address));
    });

    const plantedWritableAsset = {
      ...accounts[1]!,
      role: AccountRole.WRITABLE,
    };
    assert.throws(() => {
      assert.equal(
        plantedWritableAsset.role,
        AccountRole.READONLY,
        "planted writable asset role",
      );
    });
    assert.equal(accounts[1]!.role, AccountRole.READONLY);

    const expectedRecord = await deriveSvmPda({
      recipe: "kar-passport/record",
      programId: stack.karPassport,
      seeds: { token_id: tokenIdToBytes32(tokenId), index: recordCount },
    });
    assert.equal(expectedRecord.ok, true);
    if (!expectedRecord.ok) return;
    assert.equal(accounts[3]!.address, expectedRecord.address);

    const plantedConstant = assembleAppendPassportAttestationAccounts({
      config: accounts[0]!.address,
      asset: accounts[1]!.address,
      state: accounts[2]!.address,
      record: accounts[0]!.address,
      attester,
      stake: accounts[5]!.address,
      payer: attester,
      system: systemProgramId(),
    });
    assert.throws(() => {
      assert.equal(plantedConstant[3]!.address, expectedRecord.address);
    });
  });

  it("owner source never fetches stake account data inside the assembler", () => {
    const src = ownerSource();
    // Only one fetchAccountData call site — for state.
    const fetchMatches = src.match(/fetchAccountData\(/g) ?? [];
    assert.ok(fetchMatches.length >= 1);
    // No decodeStakeAccount in the write owner (admission fact owns that).
    assert.doesNotMatch(src, /decodeStakeAccount/);
    assert.match(src, /kar-pro-staking\/stake/);
    assert.match(src, /decodePassportState/);

    const plantedStakeDecode = src + "\n  await decodeStakeAccount(stakeBytes);\n";
    assert.throws(() => {
      assert.doesNotMatch(plantedStakeDecode, /decodeStakeAccount/);
    });
  });

  it("executeAppendPassportAttestation SVM sends assembled metas via sendSvmInstruction", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const attester = "So11111111111111111111111111111111111111112";
    let wireSeen = false;
    const port: SvmSignAndSendPort = {
      async signAndSendTransaction() {
        wireSeen = true;
        return new Uint8Array(64).fill(9);
      },
    };
    const sig = await executeAppendPassportAttestation({
      account: { status: "connected", vm: "svm", address: attester },
      chainId: ns,
      tokenId: "1",
      description: "send",
      evidenceCid: "",
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
    assert.equal(typeof sig, "string");
    assert.equal(sig.length > 0, true);
    assert.equal(wireSeen, true);
  });
});

describe("appendPassportAttestation action-surface gates unchanged", () => {
  it("active verifier + not owner offered; inactive / owner blocked", () => {
    const ownerWallet = "0x0000000000000000000000000000000000000001";
    const verifierWallet = "0x00000000000000000000000000000000000000aa";

    const inactive = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(verifierWallet),
      wallet: verifierWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: false,
      status: "VERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(inactive.appendAttestation), false);
    assert.equal(
      inactive.appendAttestation.status === "blocked" &&
        inactive.appendAttestation.cause,
      "not_verifier",
    );

    const unresolved = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(verifierWallet),
      wallet: verifierWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: undefined,
      status: "VERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(unresolved.appendAttestation), false);
    assert.equal(
      unresolved.appendAttestation.status === "blocked" &&
        unresolved.appendAttestation.cause,
      "verifier_unresolved",
    );

    const active = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(verifierWallet),
      wallet: verifierWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: true,
      status: "VERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(active.appendAttestation), true);

    const ownerActive = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(ownerWallet),
      wallet: ownerWallet,
      isOwner: true,
      holder: true,
      isActiveVerifier: true,
      status: "VERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(ownerActive.appendAttestation), false);
  });
});

describe("appendPassportAttestation no fusion with siblings", () => {
  it("owners do not import each other; assemblers and variants stay distinct", () => {
    const attest = ownerSource();
    const append = siblingSource(APPEND_OWNER_REL);
    const report = siblingSource(REPORT_OWNER_REL);

    assert.doesNotMatch(
      attest,
      /from\s+["'][^"']*append-passport-record["']/,
    );
    assert.doesNotMatch(
      attest,
      /from\s+["'][^"']*report-passport-discrepancy["']/,
    );
    assert.doesNotMatch(
      append,
      /from\s+["'][^"']*append-passport-attestation["']/,
    );
    assert.doesNotMatch(
      report,
      /from\s+["'][^"']*append-passport-attestation["']/,
    );

    assert.match(attest, /assembleAppendPassportAttestationAccounts/);
    assert.match(attest, /variant:\s*"AppendAttestation"/);
    assert.doesNotMatch(attest, /assembleAppendPassportRecordAccounts/);
    assert.doesNotMatch(attest, /assembleReportPassportDiscrepancyAccounts/);
    assert.doesNotMatch(attest, /variant:\s*"AppendRecord"/);
    assert.doesNotMatch(attest, /variant:\s*"ReportDiscrepancy"/);

    const plantedFusion = [
      'import { assembleAppendPassportRecordAccounts as assembleAppendPassportAttestationAccounts } from "@/lib/passport/append-passport-record";',
      "export { assembleAppendPassportAttestationAccounts };",
    ].join("\n");
    assert.throws(() => {
      assert.doesNotMatch(
        plantedFusion,
        /from\s+["'][^"']*append-passport-record["']/,
      );
    });
  });
});

describe("appendPassportAttestation ownership + panel surface", () => {
  it("owner composes encode / derive / decode / send / system / tokenIdToBytes32", () => {
    const src = ownerSource();
    assert.match(src, /encodeSvmInstruction/);
    assert.match(src, /deriveSvmPda/);
    assert.match(src, /decodePassportState/);
    assert.match(src, /sendSvmInstruction/);
    assert.match(src, /systemProgramId/);
    assert.match(src, /tokenIdToBytes32/);
    assert.doesNotMatch(src, /@solana\/web3\.js/);
    assert.doesNotMatch(src, /mplCoreProgramId/);
  });

  it("panel migrates attestation via writeAvail + prep; verify + challenge owners; conclude stays; no if(vm)", () => {
    const src = panelSource();
    assert.match(src, /useAppendPassportAttestation|appendPassportAttestation/);
    assert.match(src, /useActiveVerifierFact/);
    assert.match(src, /preparePassportRecordWrite/);
    assert.match(src, /TxWriteRefusal/);
    assert.match(src, /txWriteAvailability/);
    assert.doesNotMatch(src, /functionName:\s*"appendAttestation"/);
    // U6.6 moved verifyPassport off writeContractAsync; U6.7.1 moved open.
    assert.doesNotMatch(src, /functionName:\s*"verifyPassport"/);
    assert.match(src, /useVerifyPassport|verifyPassport/);
    assert.doesNotMatch(src, /functionName:\s*"open"/);
    assert.match(src, /useOpenChallenge|openChallenge/);
    // U6.7.4 moved judge; conclude remains on ABI until its unit.
    assert.doesNotMatch(src, /functionName:\s*"judge"/);
    assert.match(src, /useJudgeChallenge|judgeChallenge/);
    assert.doesNotMatch(src, /functionName:\s*"withdraw"/);
    assert.match(src, /useWithdrawChallenge|withdrawChallenge/);
    assert.match(src, /functionName:\s*"conclude"/);
    assert.equal(vmBranchViolationInSource(src), false);

    const attSubmit = src.match(
      /const submitAttestation = useCallback\(async \(\) => \{[\s\S]*?\}, \[/,
    );
    assert.ok(attSubmit);
    assert.doesNotMatch(attSubmit![0]!, /\bensureSiweSession\b/);
    assert.match(attSubmit![0]!, /preparePassportRecordWrite/);
    assert.match(attSubmit![0]!, /appendPassportAttestation/);

    // Chrome gate is writeAvail, not evm.ok.
    assert.match(
      src,
      /writeAvail\.available[\s\S]*?isAvailable\(actionSurface\.appendAttestation\)/,
    );
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.appendAttestation\)/,
    );

    // Planted old evm.ok gate — red.
    const plantedEvmOkGate =
      "passport && evm.ok && isAvailable(actionSurface.appendAttestation)";
    assert.throws(() => {
      assert.doesNotMatch(
        plantedEvmOkGate,
        /passport\s*&&\s*evm\.ok\s*&&\s*isAvailable\(actionSurface\.appendAttestation\)/,
      );
    });
  });

  it("owner + prep are on the VM branch allowlist; panel and hook are not", () => {
    assert.ok(
      (VM_BRANCH_ALLOWLIST as readonly string[]).includes(OWNER_REL),
    );
    assert.ok((VM_BRANCH_ALLOWLIST as readonly string[]).includes(PREP_REL));
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
