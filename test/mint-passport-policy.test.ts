/**
 * Dual-VM Create mint owner: EVM pin, SVM nine metas, concurrency seam.
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
  executeMintPassport,
  isSvmInvalidSeedsError,
  mintPassportCauseCopy,
  planMintPassport,
} from "@/lib/passport/mint-passport";
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

  it("executeMintPassport EVM passes the pinned call through writeEvmContract", async () => {
    let captured: unknown;
    const result = await executeMintPassport({
      account: {
        status: "connected",
        vm: "evm",
        address: to,
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      uri,
      writeEvmContract: async (call) => {
        captured = call;
        return "0xabc" as `0x${string}`;
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.signature, "0xabc");
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

describe("mint_sequence_advanced classification", () => {
  it("isSvmInvalidSeedsError detects InstructionError shapes", () => {
    assert.equal(isSvmInvalidSeedsError("InvalidSeeds"), true);
    assert.equal(
      isSvmInvalidSeedsError({ InstructionError: [0, "InvalidSeeds"] }),
      true,
    );
    assert.equal(isSvmInvalidSeedsError({ Custom: 1 }), false);
  });

  it("mintPassportCauseCopy names concurrency without inventing retry", () => {
    const copy = mintPassportCauseCopy("mint_sequence_advanced");
    assert.match(copy, /Another mint landed first/i);
    assert.ok(!/automatic|retrying/i.test(copy));
  });
});

describe("wizard + hook consume owner", () => {
  it("wizard has no VM fork and uses useMintPassport", () => {
    const wizard = readFileSync(path.join(ROOT, WIZARD_REL), "utf8");
    assert.ok(/useMintPassport/.test(wizard));
    assert.ok(!/\bif\s*\(\s*vm\s*\)/.test(wizard));
    assert.ok(!/\bavail\.vm\s*===\s*"evm"/.test(wizard));
    assert.ok(!/useEvmWriteContract/.test(wizard));
    const hook = readFileSync(path.join(ROOT, HOOK_REL), "utf8");
    assert.ok(/executeMintPassport/.test(hook));
  });

  it("owner source pins MintPassport encode variant", () => {
    const src = ownerSource();
    assert.match(src, /variant:\s*"MintPassport"/);
    assert.match(src, /functionName:\s*"mintPassport"/);
    assert.match(src, /mint_sequence_advanced/);
  });
});
