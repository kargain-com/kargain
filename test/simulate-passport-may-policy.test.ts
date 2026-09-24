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
  mapMaySimulateErr,
  resolveMaySimulateFeePayer,
  simulatePassportMay,
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

  it("Custom(37|70) → refused", () => {
    assert.deepEqual(mapMaySimulateErr({ InstructionError: [0, { Custom: 37 }] }), {
      status: "blocked",
      cause: "refused",
    });
    assert.deepEqual(mapMaySimulateErr({ InstructionError: [1, { Custom: 70 }] }), {
      status: "blocked",
      cause: "refused",
    });
  });

  it("Custom(20) → source_unanswerable not_carried_by_vm", () => {
    assert.deepEqual(mapMaySimulateErr({ InstructionError: [0, { Custom: 20 }] }), {
      status: "blocked",
      cause: "source_unanswerable",
      source: { presence: "not_carried_by_vm" },
    });
  });

  it("Custom(0) and InvalidSeeds → construction", () => {
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
    assert.match(src, /code === 37 \|\| code === 70/);
    assert.match(src, /code === 20/);
    assert.doesNotMatch(src, /allowed\s*===|answers\.every|Uninitialised/);
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
});
