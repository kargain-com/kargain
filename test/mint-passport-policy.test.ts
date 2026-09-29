/**
 * Dual-VM Create mint owner: EVM pin, SVM nine metas, plan/send + landed classifier.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AccountRole } from "@solana/kit";

import {
  assembleMintPassportAccounts,
  buildEvmMintPassportCall,
  classifyMintLandedError,
  mintPassportCauseCopy,
  planMintPassport,
  resolveMintRefusal,
  sendMintPassport,
} from "@/lib/passport/mint-passport";
import {
  writeConfirmExpiredCopy,
  writeConfirmRevertedCopy,
  writeConfirmStatusUnknownCopy,
  writeConfirmSupersededCopy,
} from "@/lib/web3/write-confirm-copy";
import {
  evmLandedRevertCopy,
  REVERT_COPY,
} from "@/lib/marketplace/tx-error-message";
import { encodeErrorResult, type Hex } from "viem";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  commercialSvmNamespaceIds,
  requireSvmCommercialActive,
} from "@/lib/web3/commercial-active";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { svmActiveAccountFromAddress } from "@/lib/web3/active-account";
import {
  mplCoreProgramId,
  systemProgramId,
} from "@/lib/svm/foreign-programs";
import { encodePassportConfigAccount } from "@/lib/svm/decode-account-state";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/mint-passport.ts";
const WIZARD_REL = "components/passport/create-passport-wizard.tsx";
const HOOK_REL = "hooks/use-mint-passport.ts";

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

function assertEvmCallPin(
  call: { functionName: string; args: readonly unknown[] },
  to: string,
  uri: string,
): void {
  assert.equal(call.functionName, "mintPassport");
  assert.deepEqual(call.args, [to, uri]);
}

describe("mintPassport EVM behavioural pin", () => {
  const uri = "ar://created";
  const to = "0x0000000000000000000000000000000000000001" as `0x${string}`;

  it("buildEvmMintPassportCall yields mintPassport with [address, uri]", () => {
    const address = karPassportAddress(84532);
    assert.ok(address);
    const call = buildEvmMintPassportCall({
      address,
      to,
      uri,
      chainId: 84532,
    });
    assertEvmCallPin(call, to, uri);
    assert.equal(call.chainId, wagmiChainId(84532));
  });

  it("planMintPassport EVM arm matches today's call for live hub", async () => {
    const planned = await planMintPassport({
      account: {
        status: "connected",
        vm: "evm",
        address: to,
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      uri,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "evm") throw new Error("expected evm plan");
    assertEvmCallPin(planned.call, to, uri);
  });

  it("planted wrong functionName is red; live builder is green", () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmMintPassportCall({
      address,
      to,
      uri,
      chainId: 84532,
    });
    assertEvmCallPin(live, to, uri);
    const planted = { ...live, functionName: "safeMint" as const };
    assert.throws(() => {
      assertEvmCallPin(planted, to, uri);
    });
  });

  it("planMintPassport + sendMintPassport EVM passes pinned call through writeEvmContract", async () => {
    let captured: unknown;
    const account = {
      status: "connected" as const,
      vm: "evm" as const,
      address: to,
      namespace: mintKargainNamespace(84532),
      chainId: 84532,
    };
    const planned = await planMintPassport({ account, chainId: 84532, uri });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "evm") throw new Error("expected evm plan");

    const result = await sendMintPassport({
      plan: planned,
      account,
      chainId: 84532,
      writeEvmContract: async (call) => {
        captured = call;
        return "0xabc" as `0x${string}`;
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.submission, "0xabc");
    assert.match(result.submission, /^0x/);
    assertEvmCallPin(
      captured as { functionName: string; args: readonly unknown[] },
      to,
      uri,
    );
  });
});

describe("mintPassport SVM metas order", () => {
  it("nine accounts in processor order", () => {
    const metas = assembleMintPassportAccounts({
      config: "Cfg111111111111111111111111111111111111111",
      asset: "Ast111111111111111111111111111111111111111",
      state: "Sta111111111111111111111111111111111111111",
      payer: "Pay111111111111111111111111111111111111111",
      owner: "Own111111111111111111111111111111111111111",
      freeze: "Frz111111111111111111111111111111111111111",
      gatewayConfig: "Gwy111111111111111111111111111111111111111",
      core: mplCoreProgramId(),
      system: systemProgramId(),
    });
    assert.equal(metas.length, 9);
    assert.equal(metas[0]!.role, AccountRole.WRITABLE);
    assert.equal(metas[3]!.role, AccountRole.WRITABLE_SIGNER);
    assert.equal(metas[4]!.role, AccountRole.READONLY);
    assert.equal(metas[7]!.address, mplCoreProgramId());
    assert.equal(metas[8]!.address, systemProgramId());
  });

  it("plan refuses registry_bridge_gateway_mismatch when chain ≠ registry config PDA", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = Number(namespaces[0]!);
    const stack = requireSvmCommercialActive(ns);
    const payer = "D87okZNVcTr7AAb9mnH6mBTwS9HRryhaq7XNLzUwxKCb";
    const configPda = await deriveSvmPda({
      recipe: "kar-passport/config",
      programId: stack.karPassport,
    });
    assert.ok(configPda.ok);
    if (!configPda.ok) return;

    const nextTokenId = tokenIdToBytes32("1");
    const foreignGateway = "11111111111111111111111111111111";
    const encoded = encodePassportConfigAccount({
      authority: payer,
      namespace: BigInt(ns),
      localEid: 40168,
      endpointProgram: foreignGateway,
      disputeDeposit: 0n,
      stakingProgram: foreignGateway,
      bridgeGateway: foreignGateway,
      forfeitRecipient: foreignGateway,
      nextTokenId,
      encumbranceSources: [],
      bump: 255,
    });

    const planned = await planMintPassport({
      account: svmActiveAccountFromAddress(payer),
      chainId: ns,
      uri: "ar://mint",
      fetchAccountData: async () => ({ ok: true, value: encoded }),
    });
    assert.equal(planned.ok, false);
    if (planned.ok) return;
    assert.equal(planned.cause, "registry_bridge_gateway_mismatch");
  });
});

describe("classifyMintLandedError", () => {
  const planned = tokenIdToBytes32("10");
  const advanced = tokenIdToBytes32("11");

  it("InvalidSeeds + advanced next → mint_sequence_advanced", () => {
    assert.equal(
      classifyMintLandedError(
        { kind: "native", name: "InvalidSeeds", index: 0 },
        planned,
        advanced,
      ),
      "mint_sequence_advanced",
    );
  });

  it("InvalidSeeds without advanced next → unmapped", () => {
    assert.equal(
      classifyMintLandedError(
        { kind: "native", name: "InvalidSeeds", index: 0 },
        planned,
        planned,
      ),
      "unmapped_program_error",
    );
  });

  it("mapped Custom → REVERT_COPY sentence; unnamed Custom path is null→unmapped", () => {
    const mapped = classifyMintLandedError(
      { kind: "custom", name: "InvalidReceiver", ordinal: 144, index: 0 },
      planned,
      advanced,
    );
    assert.deepEqual(mapped, {
      kind: "mapped",
      name: "InvalidReceiver",
      copy: REVERT_COPY.InvalidReceiver,
    });
    assert.equal(
      classifyMintLandedError(null, planned, advanced),
      "unmapped_program_error",
    );
  });

  it("mintPassportCauseCopy names concurrency without inventing retry", () => {
    const copy = mintPassportCauseCopy("mint_sequence_advanced");
    assert.match(copy, /Another mint landed first/i);
    assert.ok(!/automatic|retrying/i.test(copy));
  });

  it("wallet_rejected has a cause sentence (not send_failed)", () => {
    const copy = mintPassportCauseCopy("wallet_rejected");
    assert.match(copy, /cancelled/i);
    assert.notEqual(copy, mintPassportCauseCopy("send_failed"));
  });
});

describe("owner is plan+send only; no confirm / override / text InvalidSeeds", () => {
  it("owner source pins encode + classifier; bans confirm loop / override / isSvmInvalidSeeds", () => {
    const src = ownerSource();
    assert.match(src, /variant:\s*"MintPassport"/);
    assert.match(src, /functionName:\s*"mintPassport"/);
    assert.match(src, /mint_sequence_advanced/);
    assert.match(src, /classifyMintLandedError/);
    assert.match(src, /wallet_rejected/);
    assert.doesNotMatch(src, /plannedNextTokenIdOverride/);
    assert.doesNotMatch(src, /waitSignatureOutcome/);
    assert.doesNotMatch(src, /isSvmInvalidSeedsError/);
    assert.doesNotMatch(src, /getSignatureStatuses/);
    assert.doesNotMatch(src, /createSvmTxConfirmPort/);
  });

  it("hook wires planMintPassport + sendMintPassport only; no executeMintPassport", () => {
    const hook = readFileSync(path.join(ROOT, HOOK_REL), "utf8");
    assert.match(hook, /planMintPassport/);
    assert.match(hook, /sendMintPassport/);
    assert.doesNotMatch(hook, /executeMintPassport/);
    assert.doesNotMatch(hook, /fetchProductSvmSignatureStatuses/);
    assert.doesNotMatch(hook, /getSignatureStatuses/);
  });
});

describe("wizard consumes causes only", () => {
  it("wizard has no VM fork; send inside runTx; resolveMintRefusal on refusal", () => {
    const wizard = readFileSync(path.join(ROOT, WIZARD_REL), "utf8");
    assert.match(wizard, /useMintPassport/);
    assert.match(wizard, /runTx\s*\(/);
    assert.match(wizard, /sendMint\s*\(/);
    assert.match(wizard, /MintPassportSendRefusal/);
    assert.match(wizard, /resolveMintRefusal/);
    assert.match(wizard, /mint_sequence_advanced/);
    assert.doesNotMatch(wizard, /captureSvmConfirm/);
    assert.doesNotMatch(wizard, /isTxSyncSvmConfirmRefusal/);
    assert.doesNotMatch(wizard, /confirm_timeout/);
    assert.doesNotMatch(wizard, /resolveMintLandedConfirmRefusal/);
    assert.doesNotMatch(wizard, /\bif\s*\(\s*vm\s*\)/);
    assert.doesNotMatch(wizard, /\bavail\.vm\s*===\s*"evm"/);
    assert.doesNotMatch(wizard, /useEvmWriteContract/);
    assert.doesNotMatch(wizard, /fetchProductSvmAccountData/);
    assert.doesNotMatch(wizard, /decodePassportConfig/);
    assert.doesNotMatch(
      wizard,
      /detail\s*===\s*walletRejectionCopy\s*\(\s*\)/,
    );
    assert.doesNotMatch(
      wizard,
      /txError\s*===\s*walletRejectionCopy\s*\(\s*\)/,
    );
    // Planted sentence branch would be red:
    const planted =
      'if (detail === walletRejectionCopy()) { setFormError(detail); }';
    assert.match(planted, /detail\s*===\s*walletRejectionCopy/);
  });
});

describe("mint confirm cause copy consumes write-confirm-copy owner", () => {
  it("expired / status_unknown / reverted / superseded sentences delegate to write-confirm-copy", () => {
    assert.equal(mintPassportCauseCopy("expired"), writeConfirmExpiredCopy());
    assert.equal(
      mintPassportCauseCopy("status_unknown"),
      writeConfirmStatusUnknownCopy(),
    );
    assert.equal(mintPassportCauseCopy("reverted"), writeConfirmRevertedCopy());
    assert.equal(
      mintPassportCauseCopy("superseded"),
      writeConfirmSupersededCopy(),
    );
  });

  it("resolveMintRefusal maps confirm refusals to owner copy", async () => {
    const plan = {
      ok: true as const,
      vm: "svm" as const,
      plan: {
        programId: "prog",
        data: new Uint8Array(0),
        accounts: [],
        feePayer: "pay",
        plannedNextTokenId: new Uint8Array(32),
        plannedTokenId: "1",
        configAddress: "cfg",
      },
    };

    const expired = await resolveMintRefusal({
      plan,
      refusal: {
        kind: "expired",
        signature: "sig",
        lastValidBlockHeight: 100n,
        observedBlockHeight: 101n,
      },
    });
    assert.equal(expired.cause, "expired");
    assert.equal(expired.copy, writeConfirmExpiredCopy());

    const unknown = await resolveMintRefusal({
      plan,
      refusal: { kind: "status_unknown", writeReference: "sig" },
    });
    assert.equal(unknown.cause, "status_unknown");
    assert.equal(unknown.copy, writeConfirmStatusUnknownCopy());

    const evmPlan = {
      ok: true as const,
      vm: "evm" as const,
      call: {
        address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
        abi: [] as never,
        functionName: "mintPassport" as const,
        args: [
          "0x0000000000000000000000000000000000000002" as `0x${string}`,
          "ar://x",
        ] as [`0x${string}`, string],
        chainId: 84532,
      },
    };
    const reverted = await resolveMintRefusal({
      plan: evmPlan,
      refusal: {
        kind: "reverted",
        writeReference: "0xabc",
        blockNumber: 1n,
        revertData: null,
      },
    });
    assert.equal(reverted.cause, "reverted");
    assert.equal(reverted.copy, writeConfirmRevertedCopy());

    const sameUriData = encodeErrorResult({
      abi: KarPassportAbi,
      errorName: "SameURI",
    }) as Hex;
    const named = await resolveMintRefusal({
      plan: evmPlan,
      refusal: {
        kind: "reverted",
        writeReference: "0xabc",
        blockNumber: 1n,
        revertData: sameUriData,
      },
    });
    assert.equal(named.cause, "reverted");
    assert.equal(named.copy, REVERT_COPY.SameURI);
    assert.equal(named.copy, evmLandedRevertCopy(sameUriData));
    // URI retain is wizard-side — resolveMintRefusal never clears it.
    const superseded = await resolveMintRefusal({
      plan: evmPlan,
      refusal: {
        kind: "superseded",
        writeReference: "0xabc",
        replacementHash: `0x${"9".repeat(64)}`,
        reason: "cancelled",
      },
    });
    assert.equal(superseded.cause, "superseded");
    assert.equal(superseded.copy, writeConfirmSupersededCopy());
  });

  it("EVM write_refused never returns raw Error.message as copy (raw-text leak plant)", async () => {
    const long =
      "ContractFunctionExecutionError: execution reverted: SomeLongViemRevertDetailThatMustNotReachFormCopy";
    const plan = {
      ok: true as const,
      vm: "evm" as const,
      call: {
        address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
        abi: [] as never,
        functionName: "mintPassport" as const,
        args: [
          "0x0000000000000000000000000000000000000002" as `0x${string}`,
          "ar://x",
        ] as [`0x${string}`, string],
        chainId: 84532,
      },
    };
    const mapped = await resolveMintRefusal({
      plan,
      refusal: {
        kind: "write_refused",
        error: new Error(long),
      },
    });
    assert.equal(mapped.cause, "send_failed");
    assert.equal(mapped.copy, mintPassportCauseCopy("send_failed"));
    assert.notEqual(mapped.copy, long);
    assert.doesNotMatch(mapped.copy, /ContractFunctionExecutionError/);
  });

  it("guard_refused maps to write_guard_refused (not send_failed)", async () => {
    const { txWriteGuardRefusalCopy } = await import(
      "@/lib/web3/tx-write-availability"
    );
    const plan = {
      ok: true as const,
      vm: "evm" as const,
      call: {
        address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
        abi: [] as never,
        functionName: "mintPassport" as const,
        args: [
          "0x0000000000000000000000000000000000000002" as `0x${string}`,
          "ar://x",
        ] as [`0x${string}`, string],
        chainId: 84532,
      },
    };
    const payload = {
      guard: "write_availability" as const,
      refusal: { available: false as const, cause: "disconnected" as const },
    };
    const mapped = await resolveMintRefusal({
      plan,
      refusal: { kind: "guard_refused", refusal: payload },
    });
    assert.equal(mapped.cause, "write_guard_refused");
    assert.notEqual(mapped.cause, "send_failed");
    assert.equal(mapped.copy, txWriteGuardRefusalCopy(payload));
  });

  it("EVM landed_with_error is invariant → unmapped; no invented token ids", async () => {
    const plan = {
      ok: true as const,
      vm: "evm" as const,
      call: {
        address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
        abi: [] as never,
        functionName: "mintPassport" as const,
        args: [
          "0x0000000000000000000000000000000000000002" as `0x${string}`,
          "ar://x",
        ] as [`0x${string}`, string],
        chainId: 84532,
      },
    };
    const mapped = await resolveMintRefusal({
      plan,
      refusal: {
        kind: "landed_with_error",
        signature: "sig",
        slot: 1n,
        error: { InstructionError: [0, "InvalidSeeds"] },
        failingProgram: null,
        landed: { kind: "native", name: "InvalidSeeds", index: 0 },
      },
    });
    assert.equal(mapped.cause, "unmapped_program_error");
    assert.equal(mapped.copy, mintPassportCauseCopy("unmapped_program_error"));
  });

  it("dead exports resolveMintLandedConfirmRefusal / classifyMintLandedErrorFromRaw are absent", () => {
    const owner = readFileSync(
      path.join(ROOT, "lib/passport/mint-passport.ts"),
      "utf8",
    );
    assert.doesNotMatch(owner, /resolveMintLandedConfirmRefusal/);
    assert.doesNotMatch(owner, /classifyMintLandedErrorFromRaw/);
    assert.doesNotMatch(owner, /isMintPassportCause/);
    assert.doesNotMatch(
      owner,
      /classifyMintLandedError\s*\(\s*[^,]+,\s*new Uint8Array\s*\(\s*32\s*\)/,
    );
  });
});
