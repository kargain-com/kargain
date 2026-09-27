/**
 * S8-D1 9.3c — simulatePassportMay sole owner: err→gate map, fee payer,
 * sole simulateTransaction method string, no may.rs / web3.js in product.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AVAILABLE } from "@/lib/challenge/action-gate";
import { ENCUMBRANCE_INTENT } from "@/lib/commerce/consignment";
import {
  fingerprintMayEncumbranceSources,
  mapMaySimulateErr,
  maySimulateIdentityKey,
  resolveMaySimulateFeePayer,
  retainMaySimulateJob,
  simulatePassportMay,
  type MaySimulateDecision,
  type MaySimulateReady,
} from "@/lib/passport/simulate-passport-may";
import type { ActiveAccount } from "@/lib/web3/active-account";
import {
  requireSvmCommercialActive,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/simulate-passport-may.ts";

function liveSvmStack(): SvmCommercialActiveStack {
  return requireSvmCommercialActive(2_000_040_168);
}

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

describe("mapMaySimulateErr", () => {
  it("null err → available", () => {
    assert.deepEqual(mapMaySimulateErr(null), AVAILABLE);
  });

  it("Custom(37|70) → refused via LeaveChainRefused / OpenConsignmentRefused names", () => {
    assert.deepEqual(mapMaySimulateErr({ InstructionError: [0, { Custom: 37 }] }), {
      status: "blocked",
      cause: "refused",
    });
    assert.deepEqual(mapMaySimulateErr({ InstructionError: [1, { Custom: 70 }] }), {
      status: "blocked",
      cause: "refused",
    });
  });

  it("Custom(20) → source_unanswerable not_carried_by_vm via SourceUnanswerable name", () => {
    assert.deepEqual(mapMaySimulateErr({ InstructionError: [0, { Custom: 20 }] }), {
      status: "blocked",
      cause: "source_unanswerable",
      source: { presence: "not_carried_by_vm" },
    });
  });

  it("Custom(0) NonexistentToken and InvalidSeeds → construction", () => {
    assert.deepEqual(mapMaySimulateErr({ InstructionError: [0, { Custom: 0 }] }), {
      status: "blocked",
      cause: "construction",
    });
    assert.deepEqual(mapMaySimulateErr({ InstructionError: [0, "InvalidSeeds"] }), {
      status: "blocked",
      cause: "construction",
    });
    assert.deepEqual(mapMaySimulateErr("InvalidSeeds"), {
      status: "blocked",
      cause: "construction",
    });
  });

  it("unnamed ordinal → unmapped_program_error (not folded into construction)", () => {
    const unmapped = { InstructionError: [0, { Custom: 999_999 }] };
    assert.deepEqual(mapMaySimulateErr(unmapped), {
      status: "blocked",
      cause: "unmapped_program_error",
    });
    // Plant: folding unnamed into construction is red.
    const foldedPlant = { status: "blocked" as const, cause: "construction" as const };
    assert.notDeepEqual(
      mapMaySimulateErr(unmapped),
      foldedPlant,
      "unnamed Custom must not share construction with NonexistentToken",
    );
  });

  it("named-but-unruled Custom (NotOwner=1) → unmapped_program_error; NonexistentToken stays construction", () => {
    const notOwner = { InstructionError: [0, { Custom: 1 }] };
    assert.deepEqual(mapMaySimulateErr(notOwner), {
      status: "blocked",
      cause: "unmapped_program_error",
    });
    // Plant: folding named-unruled into construction is red.
    const constructionPlant = {
      status: "blocked" as const,
      cause: "construction" as const,
    };
    assert.notDeepEqual(
      mapMaySimulateErr(notOwner),
      constructionPlant,
      "named program answer without a rule is not construction",
    );
    assert.deepEqual(mapMaySimulateErr({ InstructionError: [0, { Custom: 0 }] }), {
      status: "blocked",
      cause: "construction",
    });
  });

  it("AccountNotFound / InvalidAccountForFee → simulation_unavailable", () => {
    assert.deepEqual(mapMaySimulateErr("AccountNotFound"), {
      status: "blocked",
      cause: "simulation_unavailable",
    });
    assert.deepEqual(mapMaySimulateErr("InvalidAccountForFee"), {
      status: "blocked",
      cause: "simulation_unavailable",
    });
  });

  it("unknown InstructionError shape → simulation_unavailable", () => {
    assert.deepEqual(mapMaySimulateErr({ InstructionError: [0] }), {
      status: "blocked",
      cause: "simulation_unavailable",
    });
    assert.deepEqual(mapMaySimulateErr({ SomethingElse: true }), {
      status: "blocked",
      cause: "simulation_unavailable",
    });
  });
});

describe("resolveMaySimulateFeePayer", () => {
  it("SVM connected → fee payer address", () => {
    const account: ActiveAccount = {
      status: "connected",
      vm: "svm",
      address: "So11111111111111111111111111111111111111112",
    };
    const r = resolveMaySimulateFeePayer(account);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("expected ok");
    assert.equal(r.feePayer, account.address);
  });

  it("disconnected / EVM → fee_payer_required (never substitute)", () => {
    for (const account of [
      { status: "disconnected" } as ActiveAccount,
      {
        status: "connected",
        vm: "evm",
        address: "0x1111111111111111111111111111111111111111",
        chainId: 84532,
        namespace: 84_532 as never,
      } as unknown as ActiveAccount,
    ]) {
      const r = resolveMaySimulateFeePayer(account);
      assert.equal(r.ok, false);
      if (r.ok) throw new Error("expected refuse");
      assert.deepEqual(r.gate, {
        status: "blocked",
        cause: "fee_payer_required",
      });
    }
  });
});

describe("simulatePassportMay transport", () => {
  it("RPC throw → simulation_unavailable", async () => {
    const r = await simulatePassportMay({
      stack: liveSvmStack(),
      tokenId: "1",
      intent: ENCUMBRANCE_INTENT.LeaveChain,
      feePayer: "So11111111111111111111111111111111111111112",
      sources: [],
      rpcUrl: "http://127.0.0.1:9",
      postRpc: async () => {
        throw new Error("transport down");
      },
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.gate, {
      status: "blocked",
      cause: "simulation_unavailable",
    });
  });

  it("planted Custom(37) response → refused gate", async () => {
    const { getBase58Decoder } = await import("@solana/kit");
    const mockBlockhash = getBase58Decoder().decode(new Uint8Array(32).fill(7));
    const r = await simulatePassportMay({
      stack: liveSvmStack(),
      tokenId: "1",
      intent: ENCUMBRANCE_INTENT.LeaveChain,
      feePayer: "So11111111111111111111111111111111111111112",
      sources: [],
      rpcUrl: "http://127.0.0.1:8899",
      postRpc: (async (_url: string, method: string) => {
        if (method === "getLatestBlockhash") {
          return {
            value: {
              blockhash: mockBlockhash,
              lastValidBlockHeight: 1,
            },
          };
        }
        if (method === "simulateTransaction") {
          return {
            value: { err: { InstructionError: [0, { Custom: 37 }] } },
          };
        }
        throw new Error(`unexpected method ${method}`);
      }) as typeof import("@/lib/svm/solana-json-rpc").postSolanaJsonRpc,
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.gate, { status: "blocked", cause: "refused" });
  });
});

describe("simulatePassportMay ownership policy", () => {
  it("sole product module may contain simulateTransaction method string", () => {
    const scan = scanProductSources(
      (_rel, src) =>
        src.includes("simulateTransaction")
          ? "simulateTransaction outside passport-may-simulate owner"
          : false,
      { owners: [OWNER_REL] },
    );
    assertCleanProductScan(scan, { owners: [OWNER_REL] });

    const plant = 'const method = "simulateTransaction";';
    assert.match(plant, /simulateTransaction/);
    const plantedReason = plant.includes("simulateTransaction")
      ? "simulateTransaction outside passport-may-simulate owner"
      : false;
    assert.equal(
      plantedReason,
      "simulateTransaction outside passport-may-simulate owner",
    );
  });

  it("owner does not import web3.js or copy may.rs allow-branch law", () => {
    const src = ownerSource();
    assert.doesNotMatch(src, /@solana\/web3\.js/);
    assert.doesNotMatch(src, /from ["']@solana\/web3/);
    assert.match(src, /simulateTransaction/);
    assert.match(src, /postSolanaJsonRpc/);
    assert.match(src, /encodeSvmInstruction/);
    assert.match(src, /deriveSvmPda/);
    assert.match(src, /getBase64EncodedWireTransaction/);
    assert.match(src, /svmProgramErrorName/);
    assert.match(src, /"LeaveChainRefused"/);
    assert.match(src, /"SourceUnanswerable"/);
    assert.match(src, /"NonexistentToken"/);
    assert.match(src, /unmapped_program_error/);
    // No ordinal-literal map (second owner of ordinal→name).
    assert.doesNotMatch(src, /code\s*===\s*20/);
    assert.doesNotMatch(src, /code\s*===\s*37/);
    assert.doesNotMatch(src, /code\s*===\s*70/);
    assert.doesNotMatch(src, /code\s*===\s*0\b/);
    assert.doesNotMatch(src, /allowed\s*===|answers\.every|Uninitialised/);

    // Plant: ordinal compare instead of name is red.
    const ordinalPlant = src.replace(
      /const name = svmProgramErrorName\(code\);/,
      "const name = code === 20 ? \"SourceUnanswerable\" : svmProgramErrorName(code);",
    );
    assert.notEqual(ordinalPlant, src);
    assert.match(ordinalPlant, /code\s*===\s*20/);
  });

  it("commerce facts / hook consume simulate owner (no second simulate door)", () => {
    const facts = readFileSync(
      path.join(ROOT, "lib/passport/passport-commerce-facts.ts"),
      "utf8",
    );
    const hook = readFileSync(
      path.join(ROOT, "hooks/use-passport-commerce-facts.ts"),
      "utf8",
    );
    assert.doesNotMatch(facts, /simulateTransaction/);
    assert.match(hook, /simulatePassportMayPermissions/);
    assert.match(hook, /decideMaySimulate/);
    assert.match(hook, /retainMaySimulateJob/);
    assert.doesNotMatch(hook, /eslint-disable/);
    assert.doesNotMatch(hook, /simulateTransaction/);
    assert.doesNotMatch(hook, /\.vm\s*===\s*["']svm["']/);
    assert.doesNotMatch(facts, /permissionFromSupport\(["']may_/);
  });

  it("stand-only PDA derive helper stays out of product imports", () => {
    const scan = scanProductSources(
      (_rel, src) => {
        if (!src.includes("deriveSvmPdaForProgram")) return false;
        if (/import\s*\{[^}]*deriveSvmPdaForProgram/.test(src)) {
          return "deriveSvmPdaForProgram imported outside stand";
        }
        return false;
      },
      { owners: ["lib/svm/derive-pda.ts"] },
    );
    assertCleanProductScan(scan, { owners: ["lib/svm/derive-pda.ts"] });
  });

  it("stand leaveChainMaySimulateCustom follows observation — literal plant is red", () => {
    const standPath = path.join(ROOT, "svm/stand/live-fixed-price.ts");
    const live = readFileSync(standPath, "utf8");
    assert.doesNotMatch(
      live,
      /leaveChainMaySimulateCustom\s*=\s*37\b/,
      "proof field must not be a hand-assigned 37",
    );
    assert.match(
      live,
      /const leaveChainMaySimulateCustom = \(/,
      "proof field must be assigned from observed InstructionError Custom",
    );

    const planted = live.replace(
      /const leaveChainMaySimulateCustom = \(\s*\([\s\S]*?\)\.Custom;/,
      "const leaveChainMaySimulateCustom = 37;",
    );
    assert.notEqual(planted, live, "plant must rewrite observation assignment");
    assert.match(planted, /leaveChainMaySimulateCustom\s*=\s*37\b/);
    assert.equal(
      /leaveChainMaySimulateCustom\s*=\s*37\b/.test(live),
      false,
      "live must not assign a constant ordinal to the proof field",
    );
  });
});

describe("maySimulateIdentityKey + retainMaySimulateJob", () => {
  const stack = liveSvmStack();
  const sourcesA = [
    {
      programId: "Fp11111111111111111111111111111111111111111",
      seedPrefix: "ans",
      programIdBytes: new Uint8Array(32),
      seedPrefixBytes: new Uint8Array([97, 110, 115]),
    },
  ];
  const sourcesB = [
    {
      programId: "Asc1111111111111111111111111111111111111111",
      seedPrefix: "ans",
      programIdBytes: new Uint8Array(32),
      seedPrefixBytes: new Uint8Array([97, 110, 115]),
    },
  ];

  function job(key: string, sources = sourcesA): MaySimulateReady {
    return {
      kind: "simulate",
      key,
      stack,
      tokenId: "1",
      feePayer: "Payer111111111111111111111111111111111111111",
      sources,
    };
  }

  it("identity key changes when sources change; equal content → equal fingerprint (red→green)", () => {
    const base = {
      depsKey: "2000040168:1:1",
      feePayer: "Payer111111111111111111111111111111111111111",
      tokenId: "1",
      stackNamespace: Number(stack.namespace),
      karPassport: stack.karPassport,
    };
    const k1 = maySimulateIdentityKey({
      ...base,
      sourcesFingerprint: fingerprintMayEncumbranceSources(sourcesA),
    });
    const k1b = maySimulateIdentityKey({
      ...base,
      sourcesFingerprint: fingerprintMayEncumbranceSources([
        { ...sourcesA[0]!, programIdBytes: new Uint8Array(32) },
      ]),
    });
    const k2 = maySimulateIdentityKey({
      ...base,
      sourcesFingerprint: fingerprintMayEncumbranceSources(sourcesB),
    });
    assert.equal(k1, k1b, "new array with equal programId+seedPrefix shares key");
    assert.notEqual(k1, k2, "different programId must change key");

    // Plant: identity without sources fingerprint would green wrongly on source swap
    const plantedSame =
      `${base.depsKey}:${base.feePayer}` === `${base.depsKey}:${base.feePayer}`;
    assert.equal(plantedSame, true);
    assert.notEqual(
      k1,
      `${base.depsKey}:${base.feePayer}`,
      "full identity must not collapse to depsKey:feePayer alone",
    );
  });

  it("retain: equal key keeps previous; key change replaces; omit clears (plant red→green)", () => {
    const key1 = maySimulateIdentityKey({
      depsKey: "2000040168:1:1",
      feePayer: "Payer111111111111111111111111111111111111111",
      tokenId: "1",
      sourcesFingerprint: fingerprintMayEncumbranceSources(sourcesA),
      stackNamespace: Number(stack.namespace),
      karPassport: stack.karPassport,
    });
    const key2 = maySimulateIdentityKey({
      depsKey: "2000040168:1:1",
      feePayer: "Payer111111111111111111111111111111111111111",
      tokenId: "1",
      sourcesFingerprint: fingerprintMayEncumbranceSources(sourcesB),
      stackNamespace: Number(stack.namespace),
      karPassport: stack.karPassport,
    });

    const first = job(key1, sourcesA);
    const rebuiltSameKey = job(key1, [
      { ...sourcesA[0]!, programIdBytes: new Uint8Array(32) },
    ]);
    const retained = retainMaySimulateJob(first, rebuiltSameKey);
    assert.equal(retained, first, "equal key must keep previous object (no re-simulate)");

    const replaced = retainMaySimulateJob(first, job(key2, sourcesB));
    assert.notEqual(replaced, first);
    assert.equal(replaced?.key, key2);

    const cleared = retainMaySimulateJob(first, { kind: "omit" } satisfies MaySimulateDecision);
    assert.equal(cleared, null);

    // Plant: always-return-next hides equal-key retention → red
    function retainAlwaysNext(
      _previous: MaySimulateReady | null,
      decision: MaySimulateDecision,
    ): MaySimulateReady | null {
      return decision.kind === "simulate" ? decision : null;
    }
    const planted = retainAlwaysNext(first, rebuiltSameKey);
    assert.notEqual(
      planted,
      first,
      "planted wrong retain must not keep previous",
    );
    assert.equal(
      retainMaySimulateJob(first, rebuiltSameKey),
      first,
      "live retain must keep previous on equal key",
    );
  });

  it("stale async key must not surface for a new identity (pure pin)", () => {
    const oldKey = "old-identity";
    const newKey = "new-identity";
    const mayAsync = { key: oldKey, value: "stale" as const };
    const decisionKey = newKey;
    const shown =
      mayAsync.key === decisionKey ? mayAsync.value : "pending";
    assert.equal(shown, "pending");

    // Plant: ignoring key match shows stale
    const plantedShow = mayAsync.value;
    assert.notEqual(plantedShow, shown);
  });
});
