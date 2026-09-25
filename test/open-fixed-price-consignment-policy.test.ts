/**
 * S8-D4 unit 3 — FixedPrice OpenDirect dual-VM owner:
 * EVM openDirect four-arg pin; SVM native-only; lib/commerce send door;
 * listing-edit / sell-panel session chrome; missing-value refusals.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AccountRole, getBase58Decoder } from "@solana/kit";

import {
  DENOMINATION_KIND,
  ZERO_CURRENCY_CODE,
} from "@/lib/commerce/denomination";
import { ZERO_ADDRESS } from "@/lib/commerce/consignment";
import {
  assembleOpenFixedPriceConsignmentAccounts,
  buildEvmOpenFixedPriceConsignmentCall,
  encumbranceSeedPrefixForMode,
  executeOpenFixedPriceConsignment,
  planOpenFixedPriceConsignment,
} from "@/lib/commerce/open-fixed-price-consignment";
import { commerceFactKnown } from "@/lib/passport/commerce-fact";
import { deriveSellSurface } from "@/lib/passport/sell-surface";
import type { EncumbranceSourceDecoded } from "@/lib/svm/decode-account-state";
import {
  deriveSvmPdaForProgram,
} from "@/lib/svm/derive-pda";
import {
  mplCoreProgramId,
  systemProgramId,
} from "@/lib/svm/foreign-programs";
import {
  DISCONNECTED_ACCOUNT,
  svmActiveAccountFromAddress,
  wrongVmActionCopy,
} from "@/lib/web3/active-account";
import {
  commercialSvmNamespaceIds,
  requireSvmCommercialActive,
  type CommercialRegistry,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  txWriteAvailabilityForCapability,
  txWriteRefusalMessage,
  txWriteRefusalTitle,
} from "@/lib/web3/tx-write-availability";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";
import {
  vmBranchViolationInSource,
  VM_BRANCH_ALLOWLIST,
} from "./network-vm-component-policy.test.ts";

const SOLANA_NS = 2_000_040_168;
/** Stand-shaped program id — not in COMMERCIAL_ACTIVE registry gate. */
const STAND_FP_PROGRAM = "3LrpJXEKoLgxaVfvKwSFnu7nTQYhU7mMjZohN7jLmtvT";
const SELL_DISCONNECTED_TITLE =
  "Connect your wallet to list or authorize a sale.";
const EDIT_DISCONNECTED_TITLE = "Connect wallet to manage this listing.";

/** Adapter-door scan: parallel hand-roll / web3.js are red. */
function commerceOpenAdapterViolations(source: string): string[] {
  const hits: string[] = [];
  if (/@solana\/web3\.js/.test(source)) hits.push("web3.js import");
  if (/\bConnection\b/.test(source)) hits.push("Connection");
  if (/\bTransactionInstruction\b/.test(source)) hits.push("TransactionInstruction");
  if (/Buffer\.from\(\[7/.test(source)) hits.push("hand-rolled OpenDirect buffer");
  if (!/sendSvmInstruction/.test(source)) hits.push("missing sendSvmInstruction");
  if (!/writeEvmContract/.test(source)) hits.push("missing writeEvmContract");
  return hits;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/commerce/open-fixed-price-consignment.ts";
const HOOK_REL = "hooks/use-open-fixed-price-consignment.ts";
const EDIT_REL = "components/marketplace/listing-edit-client.tsx";
const SELL_REL = "components/passport/passport-sell-panel.tsx";

const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));
const tokenId = "42";

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

function editSource(): string {
  return readFileSync(path.join(ROOT, EDIT_REL), "utf8");
}

function sellSource(): string {
  return readFileSync(path.join(ROOT, SELL_REL), "utf8");
}

function assertEvmCallPin(
  call: {
    functionName: string;
    args: readonly unknown[];
  },
  tid: string,
  kind: number,
  currency: `0x${string}`,
  asset: `0x${string}`,
  price: bigint,
): void {
  assert.equal(call.functionName, "openDirect");
  assert.equal(call.args.length, 4);
  assert.equal(call.args[0], BigInt(tid));
  assert.deepEqual(call.args[1], { kind, currencyCode: currency });
  assert.equal(call.args[2], asset);
  assert.equal(call.args[3], price);
}

describe("open-fixed-price-consignment policy", () => {
  it("EVM pin: openDirect + four-arg shape", () => {
    const call = buildEvmOpenFixedPriceConsignmentCall({
      address: "0xEc97fC815055CBD51746F7D6966340a1318Ac6F8",
      tokenId,
      denominationKind: DENOMINATION_KIND.Fiat,
      currencyCode: ZERO_CURRENCY_CODE,
      settlementAsset: ZERO_ADDRESS,
      price: 1_000_000n,
      chainId: 84532,
    });
    assertEvmCallPin(
      call,
      tokenId,
      DENOMINATION_KIND.Fiat,
      ZERO_CURRENCY_CODE,
      ZERO_ADDRESS,
      1_000_000n,
    );
    assert.equal(call.chainId, wagmiChainId(84532));
    assert.equal(call.abi.length > 0, true);
  });

  it("planted wrong arity / rename is red against pin helper", () => {
    assert.throws(() => {
      assertEvmCallPin(
        {
          functionName: "openDirect",
          args: [BigInt(tokenId), { kind: 0, currencyCode: ZERO_CURRENCY_CODE }],
        },
        tokenId,
        0,
        ZERO_CURRENCY_CODE,
        ZERO_ADDRESS,
        1n,
      );
    });
    assert.throws(() => {
      assertEvmCallPin(
        {
          functionName: "openFromMandate",
          args: [
            BigInt(tokenId),
            { kind: 0, currencyCode: ZERO_CURRENCY_CODE },
            ZERO_ADDRESS,
            1n,
          ],
        },
        tokenId,
        0,
        ZERO_CURRENCY_CODE,
        ZERO_ADDRESS,
        1n,
      );
    });
  });

  it("assemble metas: seller + 13 slots; Open answer duplicated mid/end", () => {
    const open = "OpenAnswer1111111111111111111111111111111";
    const metas = assembleOpenFixedPriceConsignmentAccounts({
      seller: "Seller111111111111111111111111111111111",
      config: "Config111111111111111111111111111111111",
      binding: "Binding1111111111111111111111111111111",
      passportConfig: "PassCfg1111111111111111111111111111111",
      asset: "Asset1111111111111111111111111111111111",
      challenge: "Challenge11111111111111111111111111111",
      mayAnswerOpen: open,
      consign: "Consign1111111111111111111111111111111",
      custody: "Custody111111111111111111111111111111",
      system: systemProgramId(),
      payer: "Seller111111111111111111111111111111111",
      core: mplCoreProgramId(),
      answerLeave: "Leave111111111111111111111111111111111",
      answerOpen: open,
    });
    assert.equal(metas.length, 14);
    assert.equal(metas[0]!.role, AccountRole.READONLY_SIGNER);
    assert.equal(metas[6]!.address, open);
    assert.equal(metas[6]!.role, AccountRole.READONLY);
    assert.equal(metas[13]!.address, open);
    assert.equal(metas[13]!.role, AccountRole.WRITABLE);
    assert.equal(metas[10]!.role, AccountRole.WRITABLE_SIGNER);
  });

  it("encumbranceSeedPrefixForMode matches program id — never invents", () => {
    const sources: EncumbranceSourceDecoded[] = [
      {
        programId: "ModeAaa111111111111111111111111111111111",
        seedPrefix: "fp-ans",
        programIdBytes: new Uint8Array(32),
        seedPrefixBytes: new TextEncoder().encode("fp-ans"),
      },
    ];
    const hit = encumbranceSeedPrefixForMode(
      sources,
      "ModeAaa111111111111111111111111111111111",
    );
    assert.ok(hit);
    assert.equal(new TextDecoder().decode(hit!), "fp-ans");
    assert.equal(
      encumbranceSeedPrefixForMode(sources, "Other1111111111111111111111111111111111"),
      null,
    );
  });

  it("missing price / fiat / non-native refuse without send", async () => {
    const ns = commercialSvmNamespaceIds()[0];
    assert.ok(ns != null);
    const stack = requireSvmCommercialActive(ns!);
    const account = svmActiveAccountFromAddress(
      "Seller111111111111111111111111111111111",
    );
    const base = {
      account,
      chainId: Number(stack.namespace),
      tokenId,
      denominationKind: DENOMINATION_KIND.Asset,
      currencyCode: ZERO_CURRENCY_CODE,
      settlementAsset: ZERO_ADDRESS,
      encumbranceSeedPrefix: new TextEncoder().encode("ans"),
    };

    const zero = await planOpenFixedPriceConsignment({
      ...base,
      price: 0n,
    });
    assert.equal(zero.ok, false);
    if (!zero.ok) assert.equal(zero.cause, "invalid_price");

    const fiat = await planOpenFixedPriceConsignment({
      ...base,
      denominationKind: DENOMINATION_KIND.Fiat,
      price: 1n,
    });
    assert.equal(fiat.ok, false);
    if (!fiat.ok) assert.equal(fiat.cause, "fiat_not_supported");

    const spl = await planOpenFixedPriceConsignment({
      ...base,
      settlementAsset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      price: 1n,
    });
    assert.equal(spl.ok, false);
    if (!spl.ok) assert.equal(spl.cause, "settlement_not_native");

    let sent = false;
    await assert.rejects(
      () =>
        executeOpenFixedPriceConsignment({
          ...base,
          price: 0n,
          writeEvmContract: async () => {
            sent = true;
            return "0xabc" as `0x${string}`;
          },
          svmPort: {
            signAndSendTransaction: async () => {
              sent = true;
              return new Uint8Array(64);
            },
          } satisfies SvmSignAndSendPort,
          fetchBlockhash: async () =>
            ({
              ok: true as const,
              value: {
                blockhash: MOCK_BLOCKHASH,
                lastValidBlockHeight: 1_000_000n,
              },
            }) as const,
        }),
      /price|invalid_price/i,
    );
    assert.equal(sent, false);
  });

  it("SVM plan encodes OpenDirect with injected seed (no RPC)", async () => {
    const ns = commercialSvmNamespaceIds()[0];
    assert.ok(ns != null);
    const stack = requireSvmCommercialActive(ns!);
    const account = svmActiveAccountFromAddress(stack.deployer);
    const planned = await planOpenFixedPriceConsignment({
      account,
      chainId: Number(stack.namespace),
      tokenId,
      denominationKind: DENOMINATION_KIND.Asset,
      currencyCode: ZERO_CURRENCY_CODE,
      settlementAsset: ZERO_ADDRESS,
      price: 2_000_000n,
      encumbranceSeedPrefix: new TextEncoder().encode("fp-ans"),
    });
    assert.equal(planned.ok, true, JSON.stringify(planned));
    if (!planned.ok || planned.vm !== "svm") return;
    assert.equal(planned.plan.programId, stack.fixedPriceConsignment);
    assert.equal(planned.plan.data[0], 7); // OpenDirect index
    assert.equal(planned.plan.accounts.length, 14);
    assert.equal(planned.plan.feePayer, stack.deployer);
  });

  it("listing-edit + sell-panel: TxWriteRefusal, no requireEvmSession, owner consume", () => {
    const edit = editSource();
    const sell = sellSource();
    assert.match(edit, /TxWriteRefusal/);
    assert.match(edit, /txWriteAvailability/);
    assert.match(edit, /openFixedPriceConsignment|useOpenFixedPriceConsignment/);
    assert.doesNotMatch(edit, /requireEvmSession/);
    assert.doesNotMatch(edit, /functionName:\s*["']openDirect["']/);
    assert.match(edit, /SETTLEMENT_NOTE_SVM_REFUSAL|Payment instructions are not available/);

    assert.match(sell, /TxWriteRefusal/);
    assert.match(sell, /txWriteAvailability/);
    assert.doesNotMatch(sell, /requireEvmSession/);
    assert.doesNotMatch(sell, /EvmSessionRefusal/);
  });

  it("lib/commerce OpenDirect sends only via adapters (scan)", () => {
    const src = ownerSource();
    assert.deepEqual(commerceOpenAdapterViolations(src), []);
    const plantedHandRoll = `${src}\nconst data = Buffer.from([7, 0]);\n`;
    assert.ok(
      commerceOpenAdapterViolations(plantedHandRoll).includes(
        "hand-rolled OpenDirect buffer",
      ),
      "planted Buffer.from([7 must be red",
    );
    const plantedWeb3 = `import { Connection } from "@solana/web3.js";\n${src}`;
    assert.ok(
      commerceOpenAdapterViolations(plantedWeb3).includes("web3.js import"),
      "planted web3.js import must be red",
    );
  });

  it("blocked openConsignmentPermission offers no FixedPrice CTA (red→green)", () => {
    const available = deriveSellSurface({
      isOwner: true,
      hasLiveConsignment: commerceFactKnown(false),
      fixedPriceConfigured: true,
      ascendingConfigured: false,
      openConsignmentPermission: { status: "available" },
      isActiveVerifier: false,
      passportStatus: "UNVERIFIED",
      fixedPriceMandate: commerceFactKnown(null),
      ascendingMandate: commerceFactKnown(null),
      now: 2_000_000_000,
    });
    assert.equal(available.showFixedPriceOpen, true);

    const blocked = deriveSellSurface({
      isOwner: true,
      hasLiveConsignment: commerceFactKnown(false),
      fixedPriceConfigured: true,
      ascendingConfigured: false,
      openConsignmentPermission: { status: "blocked", cause: "refused" },
      isActiveVerifier: false,
      passportStatus: "UNVERIFIED",
      fixedPriceMandate: commerceFactKnown(null),
      ascendingMandate: commerceFactKnown(null),
      now: 2_000_000_000,
    });
    assert.equal(blocked.showFixedPriceOpen, false);
    assert.equal(blocked.closedCause, "permission_blocked");

    // Planted defect: closedCause permission_blocked but List still offered.
    const plantedOffersWhileBlocked = (s: typeof blocked) =>
      s.closedCause === "permission_blocked" && s.showFixedPriceOpen === true;
    assert.equal(plantedOffersWhileBlocked(blocked), false);
    assert.equal(
      plantedOffersWhileBlocked({ ...blocked, showFixedPriceOpen: true }),
      true,
      "control: planted offer-while-blocked must be detectable as red",
    );
  });

  it("stand-shaped unregistered FixedPrice: derivePda inject red→green", async () => {
    const live = requireSvmCommercialActive(SOLANA_NS);
    const standStack: SvmCommercialActiveStack = {
      ...live,
      fixedPriceConsignment: STAND_FP_PROGRAM,
    };
    const registry: CommercialRegistry = { [SOLANA_NS]: standStack };
    const account = svmActiveAccountFromAddress(live.deployer);
    const base = {
      account,
      chainId: SOLANA_NS,
      tokenId,
      denominationKind: DENOMINATION_KIND.Asset,
      currencyCode: ZERO_CURRENCY_CODE,
      settlementAsset: ZERO_ADDRESS,
      price: 1_000_000n,
      registry,
      encumbranceSeedPrefix: new TextEncoder().encode("fp-ans"),
    };

    const red = await planOpenFixedPriceConsignment(base);
    assert.equal(red.ok, false, "registry gate must refuse stand program id");
    if (!red.ok) {
      assert.equal(red.cause, "pda_failed");
      assert.match(red.detail, /unregistered_program/);
    }

    const green = await planOpenFixedPriceConsignment({
      ...base,
      derivePda: deriveSvmPdaForProgram,
    });
    assert.equal(green.ok, true, JSON.stringify(green));
    if (!green.ok || green.vm !== "svm") return;
    assert.equal(green.plan.programId, STAND_FP_PROGRAM);
    assert.equal(green.plan.accounts.length, 14);
    assert.equal(green.plan.data[0], 7);
  });

  it("2000040168 chrome: disconnected / wrong_vm / available (observed)", () => {
    const ns = SOLANA_NS;
    const cap = "fixed_price_open_direct" as const;

    const disconnected = txWriteAvailabilityForCapability(
      DISCONNECTED_ACCOUNT,
      cap,
      ns,
    );
    assert.equal(disconnected.available, false);
    if (!disconnected.available) {
      assert.equal(disconnected.cause, "disconnected");
      assert.equal(
        txWriteRefusalTitle(disconnected, SELL_DISCONNECTED_TITLE),
        SELL_DISCONNECTED_TITLE,
      );
      assert.equal(
        txWriteRefusalTitle(disconnected, EDIT_DISCONNECTED_TITLE),
        EDIT_DISCONNECTED_TITLE,
      );
      assert.equal(
        txWriteRefusalMessage(disconnected),
        "Connect a wallet to send this transaction.",
      );
    }

    const liveEvm = requireSvmCommercialActive(ns);
    const wrongVm = txWriteAvailabilityForCapability(
      {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: liveEvm.namespace,
        chainId: 84532,
      },
      cap,
      ns,
    );
    assert.equal(wrongVm.available, false);
    if (!wrongVm.available) {
      assert.equal(wrongVm.cause, "wrong_vm");
      if (wrongVm.cause === "wrong_vm") {
        assert.equal(wrongVm.wanted, "svm");
        assert.equal(
          txWriteRefusalTitle(wrongVm, SELL_DISCONNECTED_TITLE),
          wrongVmActionCopy("svm"),
        );
        assert.equal(
          txWriteRefusalMessage(wrongVm),
          "Connect a Solana wallet to act on this network",
        );
      }
    }

    const available = txWriteAvailabilityForCapability(
      svmActiveAccountFromAddress(liveEvm.deployer),
      cap,
      ns,
    );
    assert.equal(available.available, true);
    if (available.available) {
      assert.equal(available.vm, "svm");
      assert.equal(available.namespace, ns);
    }

    // Panels consume the same chrome owners (source pin).
    assert.match(sellSource(), /TxWriteRefusal/);
    assert.match(editSource(), /TxWriteRefusal/);
    assert.match(sellSource(), /Connect your wallet to list or authorize a sale/);
    assert.match(editSource(), /Connect wallet to manage this listing/);
  });

  it("owner is on VM allowlist; panels stay blind", () => {
    assert.ok(
      (VM_BRANCH_ALLOWLIST as readonly string[]).includes(OWNER_REL),
      "owner must be allowlisted for vm fork",
    );
    assert.equal(vmBranchViolationInSource(editSource()), false);
    assert.equal(vmBranchViolationInSource(sellSource()), false);
    assert.equal(vmBranchViolationInSource(ownerSource()), true); // has vm fork by design
  });

  it("hook is thin port wiring only", () => {
    const hook = readFileSync(path.join(ROOT, HOOK_REL), "utf8");
    assert.match(hook, /executeOpenFixedPriceConsignment/);
    assert.match(hook, /createSvmSignAndSendPort/);
    assert.doesNotMatch(hook, /encodeSvmInstruction/);
    assert.doesNotMatch(hook, /deriveSvmPda/);
  });

  it("product scan: commerce open owner is the sole openDirect functionName site in lib/commerce", () => {
    const scan = scanProductSources((rel, source) => {
      if (!rel.startsWith("lib/commerce/")) return false;
      if (rel === OWNER_REL) return false;
      if (/functionName:\s*["']openDirect["']/.test(source)) {
        return `parallel openDirect in ${rel}`;
      }
      return false;
    });
    assertCleanProductScan(scan);
  });
});
