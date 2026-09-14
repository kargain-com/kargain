/**
 * §7.2 U6.2 — KarPro setVerificationFee owner: EVM pin, unit honesty,
 * named SVM current-fee absence, metas order.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AccountRole, getBase58Decoder } from "@solana/kit";

import { admitKarProHub } from "@/lib/kar-pro/kar-pro-hub-admit";
import {
  assembleSetVerificationFeeAccounts,
  buildEvmSetVerificationFeeCall,
  executeSetVerificationFee,
  planSetVerificationFee,
  VERIFICATION_FEE_SVM_CURRENT_UNREAD,
} from "@/lib/verifier/set-verification-fee";
import {
  composeEvmVerificationFeeWei,
  composeSvmVerificationFeeLamports,
  parseSvmFeeMarginNative,
} from "@/lib/verifier/verification-fee-composition";
import { verificationFeeSurface } from "@/lib/verifier/verification-fee-surface";
import {
  commercialSvmNamespaceIds,
  requireSvmCommercialActive,
} from "@/lib/web3/commercial-active";
import { mintCommercialNativeUnit } from "@/lib/web3/commercial-native-unit";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  vmBranchViolationInSource,
  VM_BRANCH_ALLOWLIST,
} from "./network-vm-component-policy.test.ts";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/verifier/set-verification-fee.ts";
const COMPOSE_REL = "lib/verifier/verification-fee-composition.ts";
const SURFACE_REL = "lib/verifier/verification-fee-surface.ts";
const ADMIT_REL = "lib/kar-pro/kar-pro-hub-admit.ts";
const PANEL_REL = "components/kar-pro/kar-pro-fee-section.tsx";
const CLIENT_REL = "components/kar-pro/kar-pro-client.tsx";
const HOOK_REL = "hooks/use-set-verification-fee.ts";

const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));

function readRel(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("U6.2 pin 1 — EVM setVerificationFee behaviour", () => {
  it("buildEvmSetVerificationFeeCall pins functionName + args shape", () => {
    const address = karProStakingAddress(84532)!;
    const feeWei = 12_345_678_901_234_567n;
    const call = buildEvmSetVerificationFeeCall({
      address,
      feeWei,
      chainId: 84532,
    });
    assert.equal(call.functionName, "setVerificationFee");
    assert.deepEqual(call.args, [feeWei]);
    assert.equal(call.address, address);
    assert.equal(call.chainId, wagmiChainId(84532));
  });

  it("plan + execute compose margin+gas and pass pinned call", async () => {
    const margin = 1_000_000_000_000_000n; // 0.001 ETH
    const gas = 2_000_000_000_000_000n;
    const expected = composeEvmVerificationFeeWei(margin, gas);
    assert.equal(expected, margin + gas);

    let captured: unknown;
    const hash = await executeSetVerificationFee({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      marginNative: margin,
      gasWei: gas,
      writeEvmContract: async (call) => {
        captured = call;
        return "0xfee" as `0x${string}`;
      },
    });
    assert.equal(hash, "0xfee");
    assert.ok(captured);
    const call = captured as {
      functionName: string;
      args: readonly bigint[];
      address: string;
    };
    assert.equal(call.functionName, "setVerificationFee");
    assert.deepEqual(call.args, [expected]);
    assert.equal(call.address, karProStakingAddress(84532));
  });

  it("planted wrong functionName is red against live pin", () => {
    const live = readRel(OWNER_REL);
    assert.match(live, /functionName:\s*"setVerificationFee"/);
    function pinsSetVerificationFee(source: string): boolean {
      return /functionName:\s*"setVerificationFee"/.test(source);
    }
    assert.equal(pinsSetVerificationFee(live), true);
    const planted = live.replaceAll(
      'functionName: "setVerificationFee"',
      'functionName: "setMinStake"',
    );
    assert.equal(
      pinsSetVerificationFee(planted),
      false,
      "planted rename must clear the setVerificationFee pin",
    );
    assert.match(planted, /functionName:\s*"setMinStake"/);
  });
});

describe("U6.2 pin 2 — unit honesty (wei/18 vs lamports/9; no gas in SVM)", () => {
  it("EVM composition adds gas; SVM composition is margin-only", () => {
    const marginWei = 10n ** 18n; // 1 ETH
    const gasWei = 5n * 10n ** 16n; // 0.05 ETH
    assert.equal(
      composeEvmVerificationFeeWei(marginWei, gasWei),
      marginWei + gasWei,
    );

    const marginLamports = 10n ** 9n; // 1 SOL
    assert.equal(
      composeSvmVerificationFeeLamports(marginLamports),
      marginLamports,
    );
    assert.equal(composeSvmVerificationFeeLamports(0n), 0n);
  });

  it("SVM compose arity refuses gas by construction (RED plant → GREEN live)", () => {
    const live = readRel(COMPOSE_REL);
    // Live SVM function takes exactly one parameter.
    assert.match(
      live,
      /export function composeSvmVerificationFeeLamports\(\s*marginLamports:\s*bigint\s*\)/,
    );
    assert.doesNotMatch(
      live,
      /composeSvmVerificationFeeLamports\([^)]*gas/i,
    );

    // Plant: add a gas parameter — pin turns red.
    const planted = live.replace(
      "export function composeSvmVerificationFeeLamports(marginLamports: bigint)",
      "export function composeSvmVerificationFeeLamports(marginLamports: bigint, gasLamports: bigint)",
    );
    assert.match(
      planted,
      /composeSvmVerificationFeeLamports\(\s*marginLamports:\s*bigint\s*,\s*gasLamports/,
    );
    assert.equal(
      /export function composeSvmVerificationFeeLamports\(\s*marginLamports:\s*bigint\s*\)/.test(
        planted,
      ),
      false,
      "planted gas arity must fail the live one-arg pin",
    );
  });

  it("native parse uses 9-decimal SOL unit — not 18", () => {
    const sol9 = mintCommercialNativeUnit("SOL", 9);
    const eth18 = mintCommercialNativeUnit("ETH", 18);
    assert.equal(parseSvmFeeMarginNative("1", sol9), 10n ** 9n);
    assert.equal(parseSvmFeeMarginNative("1", eth18), 10n ** 18n);
    assert.notEqual(
      parseSvmFeeMarginNative("1", sol9),
      parseSvmFeeMarginNative("1", eth18),
    );
  });

  it("planSetVerificationFee SVM fee equals margin (no gas fold)", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = namespaces[0]!;
    const margin = 50_000_000n;
    const planned = await planSetVerificationFee({
      account: {
        status: "connected",
        vm: "svm",
        address: "So11111111111111111111111111111111111111112",
      },
      chainId: ns,
      marginNative: margin,
      gasWei: 999_999_999n, // must be ignored — SVM arm never reads gasWei
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("expected svm");
    assert.equal(planned.fee, margin);
  });
});

describe("U6.2 pin 3 — named absence (SVM current-fee readout)", () => {
  it("surface exposes named unread — never invents 0", () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const surface = verificationFeeSurface(ns);
    assert.equal(surface.kind, "svm");
    if (surface.kind !== "svm") throw new Error("expected svm surface");
    assert.equal(surface.currentFeeAbsence, VERIFICATION_FEE_SVM_CURRENT_UNREAD);
    assert.doesNotMatch(surface.currentFeeAbsence, /\b0\s*SOL\b/i);
    assert.doesNotMatch(VERIFICATION_FEE_SVM_CURRENT_UNREAD, /^0$/);
  });

  it("fee panel quotes named absence; planted 0 fallback is red", () => {
    const live = readRel(PANEL_REL);
    assert.match(live, /currentFeeAbsence|VERIFICATION_FEE_SVM_CURRENT_UNREAD/);
    assert.doesNotMatch(
      live,
      /currentFeeAbsence\s*\?\?\s*["']0/,
    );
    assert.doesNotMatch(live, /formatNativeAmountLabeled\(\s*0n/);

    function inventsZeroFeeFallback(source: string): boolean {
      return (
        /currentFeeAbsence\s*\?\?\s*["']0/.test(source) ||
        /SVM.*\?\?\s*["']0\s*SOL["']/.test(source) ||
        /currentFee\s*=\s*0n/.test(source)
      );
    }
    assert.equal(inventsZeroFeeFallback(live), false);

    const planted = `${live}\nconst shown = surface.currentFeeAbsence ?? "0 SOL";\n`;
    assert.equal(
      inventsZeroFeeFallback(planted),
      true,
      "planted 0 SOL fallback must turn the named-absence pin red",
    );
  });
});

describe("U6.2 pin 4 — SetVerificationFee metas order (entrypoint.rs:397)", () => {
  it("three accounts: config READONLY → stake WRITABLE → verifier READONLY_SIGNER", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const verifier = "So11111111111111111111111111111111111111112";

    const planned = await planSetVerificationFee({
      account: { status: "connected", vm: "svm", address: verifier },
      chainId: ns,
      marginNative: 1n,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("expected svm");

    const accounts = planned.plan.accounts;
    assert.equal(accounts.length, 3);
    assert.equal(accounts[0]!.role, AccountRole.READONLY); // config
    assert.equal(accounts[1]!.role, AccountRole.WRITABLE); // stake
    assert.equal(accounts[2]!.role, AccountRole.READONLY_SIGNER); // verifier
    assert.equal(accounts[2]!.address, verifier);
    assert.equal(planned.plan.programId, stack.karProStaking);
    assert.equal(planned.plan.feePayer, verifier);

    // Adjacent stake↔verifier swap fails role pin (processor order).
    const swapped = [...accounts];
    const tmp = swapped[1]!;
    swapped[1] = swapped[2]!;
    swapped[2] = tmp;
    assert.throws(() => {
      assert.equal(swapped[1]!.role, AccountRole.WRITABLE);
      assert.equal(swapped[2]!.role, AccountRole.READONLY_SIGNER);
    });
  });

  it("assembleSetVerificationFeeAccounts is the sole meta constructor", () => {
    const assembled = assembleSetVerificationFeeAccounts({
      config: "Config1111111111111111111111111111111111111",
      stake: "Stake11111111111111111111111111111111111111",
      verifier: "So11111111111111111111111111111111111111112",
    });
    assert.equal(assembled.length, 3);
    assert.equal(assembled[0]!.role, AccountRole.READONLY);
    assert.equal(assembled[1]!.role, AccountRole.WRITABLE);
    assert.equal(assembled[2]!.role, AccountRole.READONLY_SIGNER);

    const owner = readRel(OWNER_REL);
    assert.match(owner, /assembleSetVerificationFeeAccounts/);
  });

  it("executeSetVerificationFee SVM sends via port", async () => {
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
    const sig = await executeSetVerificationFee({
      account: { status: "connected", vm: "svm", address: verifier },
      chainId: ns,
      marginNative: 42n,
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
    assert.equal(wireSeen, true);
  });
});

describe("U6.2 ownership + panel + hub admit", () => {
  it("owner composes encode / derive / send; panel has no ABI write path", () => {
    const owner = readRel(OWNER_REL);
    assert.match(owner, /encodeSvmInstruction/);
    assert.match(owner, /deriveSvmPda/);
    assert.match(owner, /sendSvmInstruction/);
    assert.match(owner, /kar-pro-staking\/config/);
    assert.match(owner, /kar-pro-staking\/stake/);
    assert.doesNotMatch(owner, /@solana\/web3\.js/);

    const panel = readRel(PANEL_REL);
    // Write path must not invent setVerificationFee / writeContract — EVM current-fee
    // readout may still use useReadContract(verificationFee) until U7.
    assert.doesNotMatch(panel, /functionName:\s*"setVerificationFee"/);
    assert.doesNotMatch(panel, /writeContract/);
    assert.doesNotMatch(panel, /useEvmWriteContract/);
    assert.doesNotMatch(panel, /\bstaking=\{/);
    assert.match(panel, /useSetVerificationFee/);
    assert.match(panel, /setVerificationFee\(/);
    assert.match(panel, /TxWriteRefusal/);
    assert.match(panel, /txWriteAvailability/);
    assert.equal(vmBranchViolationInSource(panel), false);

    const hook = readRel(HOOK_REL);
    assert.match(hook, /executeSetVerificationFee/);
    assert.equal(vmBranchViolationInSource(hook), false);
  });

  it("hub no longer gates entire surface on requireEvmSession — SVM reaches fee", () => {
    function hubGatesEntirelyOnEvm(source: string): boolean {
      return (
        /\brequireEvmSession\s*\(\s*account\s*\)/.test(source) &&
        /if\s*\(\s*!evm\.ok\s*\)\s*\{[\s\S]*?\bEvmSessionRefusal\b/.test(source) &&
        !/\badmitKarProHub\b/.test(source)
      );
    }

    const live = readRel(CLIENT_REL);
    assert.equal(hubGatesEntirelyOnEvm(live), false);
    assert.match(live, /\badmitKarProHub\b/);
    assert.match(live, /svm_fee_island/);
    assert.match(live, /<KarProFeeSection\s+chainId=\{/);
    assert.doesNotMatch(live, /staking=\{staking\}/);
    assert.doesNotMatch(live, /address=\{address!\}\s+staking=/);

    const planted = `import { requireEvmSession } from "@/hooks/use-active-account";
const evm = requireEvmSession(account);
if (!evm.ok) {
  return <EvmSessionRefusal cause={evm.cause} />;
}
`;
    assert.equal(hubGatesEntirelyOnEvm(planted), true);
  });

  it("admitKarProHub: SVM → fee island; EVM → hub; disconnected refuses", () => {
    const svm = admitKarProHub({
      status: "connected",
      vm: "svm",
      address: "So11111111111111111111111111111111111111112",
    });
    assert.equal(svm.kind, "svm_fee_island");
    if (svm.kind === "svm_fee_island") {
      assert.ok(svm.chainId > 0);
    }

    const evm = admitKarProHub({
      status: "connected",
      vm: "evm",
      address: "0x0000000000000000000000000000000000000001",
      namespace: mintKargainNamespace(84532),
      chainId: 84532,
    });
    assert.equal(evm.kind, "evm");

    const disc = admitKarProHub({ status: "disconnected" });
    assert.equal(disc.kind, "refusal");
    if (disc.kind === "refusal") assert.equal(disc.cause, "disconnected");
  });

  it("write owners are on VM allowlist; panel/client/compose are not", () => {
    const allow = VM_BRANCH_ALLOWLIST as readonly string[];
    assert.ok(allow.includes(OWNER_REL));
    assert.ok(allow.includes(SURFACE_REL));
    assert.ok(allow.includes(ADMIT_REL));
    assert.equal(allow.includes(PANEL_REL), false);
    assert.equal(allow.includes(CLIENT_REL), false);
    assert.equal(allow.includes(COMPOSE_REL), false);
    assert.equal(vmBranchViolationInSource(readRel(COMPOSE_REL)), false);

    assert.equal(vmBranchViolationInSource(readRel(PANEL_REL)), false);
    assert.equal(vmBranchViolationInSource(readRel(CLIENT_REL)), false);
    assert.equal(vmBranchViolationInSource(readRel(OWNER_REL)), true);
    assert.equal(vmBranchViolationInSource(readRel(SURFACE_REL)), true);
    assert.equal(vmBranchViolationInSource(readRel(ADMIT_REL)), true);

    const scan = scanProductSources((rel, source) => {
      if (allow.includes(rel)) return false;
      if (!vmBranchViolationInSource(source)) return false;
      return `vm branch outside allowlist (${rel})`;
    }, { owners: VM_BRANCH_ALLOWLIST });
    assertCleanProductScan(scan, { owners: VM_BRANCH_ALLOWLIST });
  });
});
