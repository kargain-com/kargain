/**
 * §7.2 U6.4 — passport ReportDiscrepancy write owner: EVM 3-arg pin,
 * freshness, SVM metas, surface unchanged, no fusion with AppendRecord.
 *
 * Reviewer rule: do not extract a shared seven-meta assembler into a third
 * file. Signer identity (author vs reporter) is the instruction. The import
 * ban cannot see a new `lib/passport/assemble-record-metas.ts` until it is
 * imported; refuse that extract at review.
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
  assembleReportPassportDiscrepancyAccounts,
  buildEvmReportPassportDiscrepancyCall,
  executeReportPassportDiscrepancy,
  planReportPassportDiscrepancy,
} from "@/lib/passport/report-passport-discrepancy";
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
const OWNER_REL = "lib/passport/report-passport-discrepancy.ts";
const APPEND_OWNER_REL = "lib/passport/append-passport-record.ts";
const PREP_REL = "lib/passport/prepare-passport-record-write.ts";
const PANEL_REL = "components/passport/passport-actions-panel.tsx";
const HOOK_REL = "hooks/use-report-passport-discrepancy.ts";

const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));

/** PassportState.record_count starts at byte 83 (u32 LE). */
const RECORD_COUNT_OFFSET = 8 + 32 + 1 + 32 + 8 + 1 + 1;

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

function appendOwnerSource(): string {
  return readFileSync(path.join(ROOT, APPEND_OWNER_REL), "utf8");
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
  assert.equal(call.functionName, "reportDiscrepancy");
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
    passportStatus: "VERIFIED",
    owner: wallet,
    recordedVerifier: "0x2222222222222222222222222222222222222222",
    opener: "",
    nowSec: 1_700_000_000,
    requireDisputedStatus: true,
  });
}

describe("reportPassportDiscrepancy EVM behavioural pin", () => {
  const tokenId = "42";
  const description = "Scratch found on bumper";
  const evidenceCid = "ar://evidence";

  it("buildEvmReportPassportDiscrepancyCall yields reportDiscrepancy with three args", () => {
    const address = karPassportAddress(84532);
    assert.ok(address);
    const call = buildEvmReportPassportDiscrepancyCall({
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

  it("planReportPassportDiscrepancy EVM arm matches today's call for live hub", async () => {
    const planned = await planReportPassportDiscrepancy({
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
    const live = buildEvmReportPassportDiscrepancyCall({
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
        "discrepancy",
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
    const live = buildEvmReportPassportDiscrepancyCall({
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

  it("executeReportPassportDiscrepancy EVM passes the pinned call through writeEvmContract", async () => {
    const address = karPassportAddress(84532)!;
    let captured: unknown;
    const hash = await executeReportPassportDiscrepancy({
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

describe("reportPassportDiscrepancy SVM freshness", () => {
  it("every assembly re-reads state; plant cached recordCount is red", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0, "live SVM commercial row required");
    const ns = namespaces[0]!;
    const reporter = "So11111111111111111111111111111111111111112";
    const tokenId = "1";
    let fetchCount = 0;
    const fetchAccountData = async () => {
      fetchCount += 1;
      return { ok: true as const, value: stateBytesWithRecordCount(7) };
    };

    const first = await planReportPassportDiscrepancy({
      account: { status: "connected", vm: "svm", address: reporter },
      chainId: ns,
      tokenId,
      description: "first",
      evidenceCid: "",
      fetchAccountData,
    });
    const second = await planReportPassportDiscrepancy({
      account: { status: "connected", vm: "svm", address: reporter },
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
    const reporter = "So11111111111111111111111111111111111111112";
    const tokenId = "1";
    const tokenBytes = tokenIdToBytes32(tokenId);
    const freshCount = 7;
    const staleCount = 3;

    const planned = await planReportPassportDiscrepancy({
      account: { status: "connected", vm: "svm", address: reporter },
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

describe("reportPassportDiscrepancy SVM metas order", () => {
  // Processor: entrypoint.rs report_discrepancy
  // :793 config, :794 asset (READONLY — gate_and_read_owner then discard),
  // :795 state, :796 record, :797 reporter (signer), :798 payer, :799 system.
  it("seven accounts in processor order; reporter in signer position; asset read-only", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const reporter = "So11111111111111111111111111111111111111112";
    const tokenId = "1";
    const recordCount = 11;

    const planned = await planReportPassportDiscrepancy({
      account: { status: "connected", vm: "svm", address: reporter },
      chainId: ns,
      tokenId,
      description: "metas",
      evidenceCid: "ar://x",
      fetchAccountData: async () => ({
        ok: true,
        value: stateBytesWithRecordCount(recordCount),
      }),
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("expected svm");

    const accounts = planned.plan.accounts;
    assert.equal(accounts.length, 7);
    assert.equal(accounts[0]!.role, AccountRole.READONLY); // config :793
    assert.equal(accounts[1]!.role, AccountRole.READONLY); // asset :794
    assert.equal(accounts[2]!.role, AccountRole.WRITABLE); // state :795
    assert.equal(accounts[3]!.role, AccountRole.WRITABLE); // record :796
    assert.equal(accounts[4]!.role, AccountRole.READONLY_SIGNER); // reporter :797
    assert.equal(accounts[5]!.role, AccountRole.WRITABLE_SIGNER); // payer :798
    assert.equal(accounts[6]!.role, AccountRole.READONLY); // system :799
    assert.equal(accounts[4]!.address, reporter);
    assert.equal(accounts[5]!.address, reporter);
    assert.equal(accounts[6]!.address, systemProgramId());
    assert.equal(planned.plan.programId, stack.karPassport);
    assert.equal(planned.plan.feePayer, reporter);
    assert.equal(planned.plan.recordCount, recordCount);

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

    // Adjacent reporter↔payer role swap fails the pin.
    const swapped = [...accounts];
    const tmp = swapped[4]!;
    swapped[4] = swapped[5]!;
    swapped[5] = tmp;
    assert.throws(() => {
      assert.equal(swapped[4]!.role, AccountRole.READONLY_SIGNER);
      assert.equal(swapped[5]!.role, AccountRole.WRITABLE_SIGNER);
    });

    const plantedConstant = assembleReportPassportDiscrepancyAccounts({
      config: accounts[0]!.address,
      asset: accounts[1]!.address,
      state: accounts[2]!.address,
      record: accounts[0]!.address,
      reporter,
      payer: reporter,
      system: systemProgramId(),
    });
    assert.throws(() => {
      assert.equal(plantedConstant[3]!.address, expectedRecord.address);
    });
  });

  it("executeReportPassportDiscrepancy SVM sends assembled metas via sendSvmInstruction", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const reporter = "So11111111111111111111111111111111111111112";
    let wireSeen = false;
    const port: SvmSignAndSendPort = {
      async signAndSendTransaction() {
        wireSeen = true;
        return new Uint8Array(64).fill(9);
      },
    };
    const sig = await executeReportPassportDiscrepancy({
      account: { status: "connected", vm: "svm", address: reporter },
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

describe("reportPassportDiscrepancy action-surface gates unchanged", () => {
  it("holder unavailable; stranger available; DISPUTED and listing do not block", () => {
    const holderWallet = "0x0000000000000000000000000000000000000001";
    const strangerWallet = "0x00000000000000000000000000000000000000aa";

    const holder = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(holderWallet),
      wallet: holderWallet,
      isOwner: true,
      holder: true,
      isActiveVerifier: false,
      status: "VERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(holder.reportDiscrepancy), false);
    assert.equal(
      holder.reportDiscrepancy.status === "blocked" &&
        holder.reportDiscrepancy.cause,
      "is_holder",
    );

    const stranger = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(strangerWallet),
      wallet: strangerWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: false,
      status: "VERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(stranger.reportDiscrepancy), true);

    const disputed = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(strangerWallet),
      wallet: strangerWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: false,
      status: "DISPUTED",
      listingActive: false,
    });
    assert.equal(isAvailable(disputed.reportDiscrepancy), true);

    const listed = derivePassportActionSurface({
      presenceFacts: presenceHere(),
      challenge: challengeIdle(strangerWallet),
      wallet: strangerWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: false,
      status: "VERIFIED",
      listingActive: true,
    });
    assert.equal(isAvailable(listed.reportDiscrepancy), true);

    // Planted: treat DISPUTED as blocking discrepancy — red against live law.
    assert.throws(() => {
      assert.equal(isAvailable(disputed.reportDiscrepancy), false);
    });
  });
});

describe("reportPassportDiscrepancy no fusion with AppendRecord", () => {
  it("owners do not import each other; assemblers and variants stay distinct", () => {
    const report = ownerSource();
    const append = appendOwnerSource();

    // Import ban (path literals in import/require) — docstring cross-refs are fine.
    assert.doesNotMatch(
      report,
      /from\s+["'][^"']*append-passport-record["']/,
    );
    assert.doesNotMatch(
      append,
      /from\s+["'][^"']*report-passport-discrepancy["']/,
    );

    assert.match(report, /assembleReportPassportDiscrepancyAccounts/);
    assert.match(report, /variant:\s*"ReportDiscrepancy"/);
    assert.doesNotMatch(report, /assembleAppendPassportRecordAccounts/);
    assert.doesNotMatch(report, /variant:\s*"AppendRecord"/);
    assert.doesNotMatch(report, /functionName:\s*"appendRecord"/);

    assert.match(append, /assembleAppendPassportRecordAccounts/);
    assert.match(append, /variant:\s*"AppendRecord"/);
    assert.doesNotMatch(append, /assembleReportPassportDiscrepancyAccounts/);
    assert.doesNotMatch(append, /variant:\s*"ReportDiscrepancy"/);

    // Planted: re-export append assembler as the discrepancy assembler — red.
    const plantedFusion = [
      'import { assembleAppendPassportRecordAccounts as assembleReportPassportDiscrepancyAccounts } from "@/lib/passport/append-passport-record";',
      "export { assembleReportPassportDiscrepancyAccounts };",
    ].join("\n");
    assert.match(plantedFusion, /assembleAppendPassportRecordAccounts/);
    assert.match(
      plantedFusion,
      /from\s+["'][^"']*append-passport-record["']/,
    );
    assert.throws(() => {
      assert.doesNotMatch(
        plantedFusion,
        /from\s+["'][^"']*append-passport-record["']/,
      );
    });
    assert.doesNotMatch(
      report,
      /from\s+["'][^"']*append-passport-record["']/,
    );
  });
});

describe("reportPassportDiscrepancy ownership + panel surface", () => {
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

  it("panel migrates discrepancy; verify + challenge owners; conclude stays; no if(vm)", () => {
    const src = panelSource();
    assert.match(src, /useReportPassportDiscrepancy|reportPassportDiscrepancy/);
    assert.match(src, /preparePassportRecordWrite/);
    assert.match(src, /TxWriteRefusal/);
    assert.match(src, /txWriteAvailability/);
    assert.doesNotMatch(src, /functionName:\s*"reportDiscrepancy"/);
    // Attestation migrated in U6.5 — no inline appendAttestation ABI path.
    assert.doesNotMatch(src, /functionName:\s*"appendAttestation"/);
    assert.match(src, /useAppendPassportAttestation|appendPassportAttestation/);
    // U6.6 moved verifyPassport off writeContractAsync.
    assert.doesNotMatch(src, /functionName:\s*"verifyPassport"/);
    assert.match(src, /useVerifyPassport|verifyPassport/);
    // U6.7.1 moved open; U6.7.4 moved judge; U6.7.5 moved conclude.
    assert.doesNotMatch(src, /functionName:\s*"open"/);
    assert.match(src, /useOpenChallenge|openChallenge/);
    assert.doesNotMatch(src, /functionName:\s*"judge"/);
    assert.match(src, /useJudgeChallenge|judgeChallenge/);
    assert.doesNotMatch(src, /functionName:\s*"conclude"/);
    assert.match(src, /useConcludeChallenge|concludeChallenge/);
    assert.equal(vmBranchViolationInSource(src), false);

    const discSubmit = src.match(
      /const submitDiscrepancy = useCallback\(async \(\) => \{[\s\S]*?\}, \[/,
    );
    assert.ok(discSubmit);
    assert.doesNotMatch(discSubmit![0]!, /\bensureSiweSession\b/);
    assert.match(discSubmit![0]!, /preparePassportRecordWrite/);
    assert.match(discSubmit![0]!, /reportPassportDiscrepancy/);
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
