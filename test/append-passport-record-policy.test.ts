/**
 * §7.2 U6.3 — passport AppendRecord write owner: EVM pin, freshness, SVM metas.
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
  assembleAppendPassportRecordAccounts,
  buildEvmAppendPassportRecordCall,
  executeAppendPassportRecord,
  planAppendPassportRecord,
} from "@/lib/passport/append-passport-record";
import {
  derivePassportActionSurface,
  isAvailable,
} from "@/lib/passport/action-surface";
import {
  preparePassportRecordWrite,
} from "@/lib/passport/prepare-passport-record-write";
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
  decodeSvmProgramError,
  REVERT_COPY,
  txErrorMessage,
} from "@/lib/marketplace/tx-error-message";
import {
  vmBranchViolationInSource,
  VM_BRANCH_ALLOWLIST,
} from "./network-vm-component-policy.test.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/append-passport-record.ts";
const PREP_REL = "lib/passport/prepare-passport-record-write.ts";
const PANEL_REL = "components/passport/passport-actions-panel.tsx";
const HOOK_REL = "hooks/use-append-passport-record.ts";

const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));

/** PassportState.record_count starts at byte 83 (u32 LE). */
const RECORD_COUNT_OFFSET = 8 + 32 + 1 + 32 + 8 + 1 + 1;

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

function panelSource(): string {
  return readFileSync(path.join(ROOT, PANEL_REL), "utf8");
}

function prepSource(): string {
  return readFileSync(path.join(ROOT, PREP_REL), "utf8");
}

function assertEvmCallPin(
  call: {
    functionName: string;
    args: readonly unknown[];
  },
  tokenId: string,
  recordType: string,
  description: string,
  evidenceCid: string,
): void {
  assert.equal(call.functionName, "appendRecord");
  assert.deepEqual(call.args, [
    BigInt(tokenId),
    recordType,
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

describe("appendPassportRecord EVM behavioural pin", () => {
  const tokenId = "42";
  const recordType = "service";
  const description = "Oil change and filter";
  const evidenceCid = "ar://evidence";

  it("buildEvmAppendPassportRecordCall yields appendRecord with four args", () => {
    const address = karPassportAddress(84532);
    assert.ok(address);
    const call = buildEvmAppendPassportRecordCall({
      address,
      tokenId,
      recordType,
      description,
      evidenceCid,
      chainId: 84532,
    });
    assertEvmCallPin(call, tokenId, recordType, description, evidenceCid);
    assert.equal(call.chainId, wagmiChainId(84532));
    assert.equal(call.address, address);
  });

  it("planAppendPassportRecord EVM arm matches today's call for live hub", async () => {
    const planned = await planAppendPassportRecord({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
      recordType,
      description,
      evidenceCid,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "evm") throw new Error("expected evm plan");
    assertEvmCallPin(planned.call, tokenId, recordType, description, evidenceCid);
  });

  it("clarification uses the same builder with dispute-clarification type", async () => {
    const planned = await planAppendPassportRecord({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
      recordType: "dispute-clarification",
      description: "Owner reply",
      evidenceCid: "",
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "evm") throw new Error("expected evm plan");
    assertEvmCallPin(
      planned.call,
      tokenId,
      "dispute-clarification",
      "Owner reply",
      "",
    );
  });

  it("planted wrong functionName is red; live builder is green", () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmAppendPassportRecordCall({
      address,
      tokenId,
      recordType,
      description,
      evidenceCid,
      chainId: 84532,
    });
    assertEvmCallPin(live, tokenId, recordType, description, evidenceCid);

    const planted = {
      ...live,
      functionName: "addRecord" as const,
    };
    assert.throws(() => {
      assertEvmCallPin(planted, tokenId, recordType, description, evidenceCid);
    });
  });

  it("planted deleted EVM arm is red; live owner source is green", () => {
    const live = ownerSource();
    assert.match(live, /buildEvmAppendPassportRecordCall/);
    assert.match(live, /functionName:\s*"appendRecord"/);
    assert.match(live, /avail\.vm === "evm"/);

    const planted = live
      .split("\n")
      .filter(
        (line) =>
          !line.includes("buildEvmAppendPassportRecordCall") &&
          !line.includes('functionName: "appendRecord"') &&
          !line.includes('avail.vm === "evm"'),
      )
      .join("\n");
    assert.equal(/buildEvmAppendPassportRecordCall/.test(planted), false);
    assert.equal(/functionName:\s*"appendRecord"/.test(planted), false);
    assert.equal(/avail\.vm === "evm"/.test(planted), false);
    assert.equal(/buildEvmAppendPassportRecordCall/.test(live), true);
  });

  it("executeAppendPassportRecord EVM passes the pinned call through writeEvmContract", async () => {
    const address = karPassportAddress(84532)!;
    let captured: unknown;
    const hash = await executeAppendPassportRecord({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
      recordType,
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
      recordType,
      description,
      evidenceCid,
    );
    assert.equal((captured as { address: string }).address, address);
  });
});

describe("appendPassportRecord SVM freshness", () => {
  it("every assembly re-reads state; plant cached recordCount is red", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0, "live SVM commercial row required");
    const ns = namespaces[0]!;
    const owner = "So11111111111111111111111111111111111111112";
    const tokenId = "1";
    let fetchCount = 0;
    const fetchAccountData = async () => {
      fetchCount += 1;
      return { ok: true as const, value: stateBytesWithRecordCount(7) };
    };

    const first = await planAppendPassportRecord({
      account: { status: "connected", vm: "svm", address: owner },
      chainId: ns,
      tokenId,
      recordType: "service",
      description: "first",
      evidenceCid: "",
      fetchAccountData,
    });
    const second = await planAppendPassportRecord({
      account: { status: "connected", vm: "svm", address: owner },
      chainId: ns,
      tokenId,
      recordType: "service",
      description: "second",
      evidenceCid: "",
      fetchAccountData,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(fetchCount, 2, "live owner must fetch on every assembly");

    // Planted: reuse first plan's recordCount without a second fetch.
    if (!first.ok || first.vm !== "svm") throw new Error("expected svm");
    if (!second.ok || second.vm !== "svm") throw new Error("expected svm");
    const plantedReuse = first.plan.recordCount;
    assert.equal(second.plan.recordCount, plantedReuse);
    // Control: a plant that skips the second fetch must fail the freshness pin.
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
    const owner = "So11111111111111111111111111111111111111112";
    const tokenId = "1";
    const tokenBytes = tokenIdToBytes32(tokenId);
    const freshCount = 7;
    const staleCount = 3;

    const planned = await planAppendPassportRecord({
      account: { status: "connected", vm: "svm", address: owner },
      chainId: ns,
      tokenId,
      recordType: "service",
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

describe("appendPassportRecord SVM metas order", () => {
  it("seven accounts in processor order; record from decoded recordCount", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const owner = "So11111111111111111111111111111111111111112";
    const tokenId = "1";
    const recordCount = 11;

    const planned = await planAppendPassportRecord({
      account: { status: "connected", vm: "svm", address: owner },
      chainId: ns,
      tokenId,
      recordType: "service",
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
    assert.equal(accounts[0]!.role, AccountRole.READONLY); // config
    assert.equal(accounts[1]!.role, AccountRole.READONLY); // asset — read-only in AppendRecord
    assert.equal(accounts[2]!.role, AccountRole.WRITABLE); // state
    assert.equal(accounts[3]!.role, AccountRole.WRITABLE); // record
    assert.equal(accounts[4]!.role, AccountRole.READONLY_SIGNER); // author
    assert.equal(accounts[5]!.role, AccountRole.WRITABLE_SIGNER); // payer
    assert.equal(accounts[6]!.role, AccountRole.READONLY); // system
    assert.equal(accounts[4]!.address, owner);
    assert.equal(accounts[5]!.address, owner);
    assert.equal(accounts[6]!.address, systemProgramId());
    assert.equal(planned.plan.programId, stack.karPassport);
    assert.equal(planned.plan.feePayer, owner);
    assert.equal(planned.plan.recordCount, recordCount);

    // Planted over-writable asset role is red; live pin is green.
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

    // Adjacent author↔payer role swap fails the pin.
    const swapped = [...accounts];
    const tmp = swapped[4]!;
    swapped[4] = swapped[5]!;
    swapped[5] = tmp;
    assert.throws(() => {
      assert.equal(swapped[4]!.role, AccountRole.READONLY_SIGNER);
      assert.equal(swapped[5]!.role, AccountRole.WRITABLE_SIGNER);
    });

    // Planted constant record address (not derived from count) is red.
    const plantedConstant = assembleAppendPassportRecordAccounts({
      config: accounts[0]!.address,
      asset: accounts[1]!.address,
      state: accounts[2]!.address,
      record: accounts[0]!.address, // wrong — reused config
      author: owner,
      payer: owner,
      system: systemProgramId(),
    });
    assert.throws(() => {
      assert.equal(plantedConstant[3]!.address, expectedRecord.address);
    });
  });

  it("executeAppendPassportRecord SVM sends assembled metas via sendSvmInstruction", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const owner = "So11111111111111111111111111111111111111112";
    let wireSeen = false;
    const port: SvmSignAndSendPort = {
      async signAndSendTransaction() {
        wireSeen = true;
        return new Uint8Array(64).fill(9);
      },
    };
    const sig = await executeAppendPassportRecord({
      account: { status: "connected", vm: "svm", address: owner },
      chainId: ns,
      tokenId: "1",
      recordType: "service",
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

describe("appendPassportRecord no compensating patch + named refusal", () => {
  it("owner source has no retry loop, local increment, or index search", () => {
    const src = ownerSource();
    assert.doesNotMatch(src, /recordCount\s*\+\+/);
    assert.doesNotMatch(src, /record_count\s*\+\+/);
    assert.doesNotMatch(src, /for\s*\([^)]*recordCount/);
    assert.doesNotMatch(src, /while\s*\([^)]*AccountAlreadyInitialized/);
    assert.doesNotMatch(src, /free.?index|nextIndex|findFree/i);
    assert.match(src, /fetchAccountData|fetchProductSvmAccountData/);
    assert.match(src, /decodePassportState/);
  });

  it("EmptyField still surfaces through existing SVM error owners", () => {
    const err = new Error("Transaction failed: custom program error: 0x5");
    const decoded = decodeSvmProgramError(err);
    assert.ok(decoded);
    assert.equal(decoded!.name, "EmptyField");
    assert.equal(REVERT_COPY.EmptyField, "A required field is empty.");
    assert.equal(txErrorMessage(err), REVERT_COPY.EmptyField);
  });
});

describe("appendPassportRecord action-surface gates unchanged", () => {
  it("append admitted when owner + not DISPUTED + not listed; clarification opposite status", () => {
    const wallet = "0x0000000000000000000000000000000000000001";
    const base = {
      presenceFacts: presenceHere(),
      challenge: challengeIdle(wallet),
      wallet,
      isOwner: true,
      holder: true,
      isActiveVerifier: false as boolean | undefined,
      listingActive: false,
    };

    const appendOk = derivePassportActionSurface({
      ...base,
      status: "UNVERIFIED",
    });
    assert.equal(isAvailable(appendOk.appendRecord), true);
    assert.equal(isAvailable(appendOk.ownerClarification), false);

    const clarificationOk = derivePassportActionSurface({
      ...base,
      status: "DISPUTED",
    });
    assert.equal(isAvailable(clarificationOk.appendRecord), false);
    assert.equal(isAvailable(clarificationOk.ownerClarification), true);

    // Planted flip: treat DISPUTED as append-allowed — red against live law.
    assert.throws(() => {
      assert.equal(isAvailable(clarificationOk.appendRecord), true);
    });
    assert.throws(() => {
      assert.equal(isAvailable(appendOk.ownerClarification), true);
    });
  });
});

describe("appendPassportRecord ownership + panel surface", () => {
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

  it("panel migrates append/clarification; leaves other writes; no if(vm)", () => {
    const src = panelSource();
    assert.match(src, /useAppendPassportRecord|appendPassportRecord/);
    assert.match(src, /preparePassportRecordWrite/);
    assert.match(src, /TxWriteRefusal/);
    assert.match(src, /txWriteAvailability/);
    assert.doesNotMatch(src, /functionName:\s*"appendRecord"/);
    // Attestation / discrepancy / challenge still use writeContractAsync.
    assert.match(src, /functionName:\s*"reportDiscrepancy"/);
    assert.match(src, /functionName:\s*"appendAttestation"/);
    assert.match(src, /functionName:\s*"verifyPassport"/);
    assert.equal(vmBranchViolationInSource(src), false);

    // Append/clarification paths must not call ensureSiweSession inline.
    const withoutAttestation = src
      .replace(/resolveAttestationEvidence[\s\S]*?\],\s*\[/, "")
      .replace(/uploadEvidenceFromInput[\s\S]*?\],\s*\[/, "");
    // Safer: submitOwnerRecord / submitClarification blocks lack ensureSiweSession.
    const ownerSubmit = src.match(
      /const submitOwnerRecord = useCallback\(async \(\) => \{[\s\S]*?\}, \[/,
    );
    const clarSubmit = src.match(
      /const submitClarification = useCallback\(async \(\) => \{[\s\S]*?\}, \[/,
    );
    assert.ok(ownerSubmit);
    assert.ok(clarSubmit);
    assert.doesNotMatch(ownerSubmit![0]!, /\bensureSiweSession\b/);
    assert.doesNotMatch(clarSubmit![0]!, /\bensureSiweSession\b/);
    assert.match(prepSource(), /\bensureSiweSession\b/);
    // Attestation still has inline SIWE.
    assert.match(src, /resolveAttestationEvidence[\s\S]*?ensureSiweSession/);
  });

  it("prep: SVM named none-required; EVM+file runs SIWE; paste skips SIWE", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const svmAccount = {
      status: "connected" as const,
      vm: "svm" as const,
      address: "So11111111111111111111111111111111111111112",
    };
    const svmOrder: string[] = [];
    const svmPrep = await preparePassportRecordWrite({
      account: svmAccount,
      targetChainId: ns,
      evidenceFile: new File(["x"], "e.bin"),
      signMessageAsync: async () => {
        svmOrder.push("sign");
        return "0x" as `0x${string}`;
      },
      ensureSiweSession: async () => {
        svmOrder.push("siwe");
      },
    });
    assert.deepEqual(svmPrep, { ok: true, prep: "svm_none_required" });
    assert.equal(svmOrder.length, 0);

    const evmAccount = {
      status: "connected" as const,
      vm: "evm" as const,
      address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      namespace: mintKargainNamespace(84532),
      chainId: 84532,
    };
    const pasteOrder: string[] = [];
    const pastePrep = await preparePassportRecordWrite({
      account: evmAccount,
      targetChainId: 84532,
      evidenceFile: null,
      signMessageAsync: async () => {
        pasteOrder.push("sign");
        return "0x" as `0x${string}`;
      },
      ensureSiweSession: async () => {
        pasteOrder.push("siwe");
      },
    });
    assert.deepEqual(pastePrep, { ok: true, prep: "none_required" });
    assert.equal(pasteOrder.length, 0);

    const fileOrder: string[] = [];
    const filePrep = await preparePassportRecordWrite({
      account: evmAccount,
      targetChainId: 84532,
      evidenceFile: new File(["x"], "e.bin"),
      signMessageAsync: async () => {
        fileOrder.push("sign");
        return "0x" as `0x${string}`;
      },
      ensureSiweSession: async () => {
        fileOrder.push("siwe");
      },
    });
    assert.deepEqual(filePrep, { ok: true, prep: "evm_prepared" });
    assert.deepEqual(fileOrder, ["siwe"]);
  });

  it("owner + prep are on the VM branch allowlist; panel is not", () => {
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
