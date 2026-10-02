/**
 * Unit N1 corrective — branded Eip155ChainId doors + Result wagmi door.
 *
 * - `number` into getPublicClient / getViemChain / rpcUrlForChain /
 *   getBridgeReadClient fails isolated tsc (TS2345 on each call line).
 * - `as Eip155ChainId` outside commercial-active.ts is banned (temp-tree plant).
 * - No throw IIFE whose message embeds door Result causes.
 * - `writeUnionChainId` is module-private to supported-chains.ts.
 * - EVM-by-construction files never call resolveEvmChain / evmWagmiChain
 *   inside `stack.vm === "evm"`.
 * - Live EVM stacks succeed getViemChain(evmChainOf) + wagmiChainOfStack;
 *   planted EVM row outside kargainChains is red.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMMERCIAL_ACTIVE,
  evmChainOf,
  resolveEvmChain,
  type EvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { getBridgeReadClient } from "@/lib/web3/bridge/bridge-read-client";
import { getPublicClient } from "@/lib/web3/public-client";
import {
  evmWagmiChain,
  getViemChain,
  kargainChains,
  rpcUrlForChain,
  wagmiChainOfStack,
} from "@/lib/web3/supported-chains";
import { scanProductSources } from "./policy-scan-helpers";
import { findDoorResultThrowViolations } from "./door-result-throw-ast";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVM_NS = 2000040168;
const EVM_NS = 84532;

const EVM_BY_CONSTRUCTION = [
  "lib/passport/passport-holder.ts",
  "lib/passport/passport-commerce-facts.ts",
  "lib/storage/irys-upload-plan.ts",
] as const;

function runDoorProbe(source: string): {
  status: number | null;
  out: string;
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-eip155-door-"));
  const probe = path.join(tmp, "probe.ts");
  const tsconfigPath = path.join(tmp, "tsconfig.json");
  try {
    fs.writeFileSync(
      tsconfigPath,
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022"],
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "ESNext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            allowImportingTsExtensions: true,
            jsx: "react-jsx",
            typeRoots: [path.join(ROOT, "node_modules/@types")],
            paths: {
              "@/*": [path.join(ROOT, "*")],
            },
            baseUrl: ROOT,
          },
          files: [probe],
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(probe, source);
    const result = spawnSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "-p", tsconfigPath],
      { cwd: ROOT, encoding: "utf8" },
    );
    return {
      status: result.status,
      out: `${result.stdout}\n${result.stderr}`,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function scanTempTree(
  files: Record<string, string>,
  predicate: (relPath: string, source: string) => string | false,
): string[] {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-eip155-scan-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
    const violations: string[] = [];
    for (const [rel, body] of Object.entries(files)) {
      const reason = predicate(rel, body);
      if (reason) violations.push(`${rel}: ${reason}`);
    }
    return violations;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("eip155-chain-door-policy", () => {
  it("resolveEvmChain(SVM) is not_evm; EVM path brands and opens doors", () => {
    const svm = resolveEvmChain(SVM_NS);
    assert.deepEqual(svm, { ok: false, cause: "not_evm" });

    const evm = resolveEvmChain(EVM_NS);
    assert.equal(evm.ok, true);
    if (!evm.ok) throw new Error("unreachable");
    const chain = getViemChain(evm.chainId);
    assert.equal(chain.id, EVM_NS);
    const rpc = rpcUrlForChain(evm.chainId);
    assert.ok(typeof rpc === "string" && rpc.length > 0);
    const client = getPublicClient(evm.chainId);
    assert.equal(client.chain?.id, EVM_NS);
    const bridge = getBridgeReadClient(evm.chainId);
    assert.equal(bridge.chain?.id, EVM_NS);
  });

  it("evmWagmiChain soft-refuses SVM; EVM returns write-union id", () => {
    const svm = evmWagmiChain(SVM_NS);
    assert.deepEqual(svm, { ok: false, cause: "not_evm" });
    const nullish = evmWagmiChain(null);
    assert.deepEqual(nullish, { ok: false, cause: "unresolved_namespace" });
    const evm = evmWagmiChain(EVM_NS);
    assert.equal(evm.ok, true);
    if (!evm.ok) throw new Error("unreachable");
    assert.equal(evm.chainId, EVM_NS);
    const eth = evmWagmiChain(11155111);
    assert.equal(eth.ok, true);
    if (eth.ok) assert.equal(eth.chainId, 11155111);
  });

  it("live EVM stacks succeed getViemChain + wagmiChainOfStack; planted outsider red", () => {
    for (const stack of Object.values(COMMERCIAL_ACTIVE)) {
      if (stack.vm !== "evm") continue;
      const branded = evmChainOf(stack);
      assert.equal(getViemChain(branded).id, stack.chainId);
      assert.equal(wagmiChainOfStack(stack), stack.chainId);
    }

    const outsider = {
      ...COMMERCIAL_ACTIVE[84532],
      chainId: 999001,
    } as EvmCommercialActiveStack;
    assert.throws(
      () => getViemChain(evmChainOf(outsider)),
      /not in the Kargain write-union/,
    );
    assert.throws(
      () => wagmiChainOfStack(outsider),
      /not in the Kargain write-union/,
    );
    void kargainChains;
  });

  it("as Eip155ChainId cast — temp plant red, product green", () => {
    const CAST = "as Eip155ChainId";
    const plantViolations = scanTempTree(
      {
        "lib/web3/plant.ts": `export const x = 84532 as Eip155ChainId;\n`,
      },
      (rel, source) =>
        source.includes(CAST) && !rel.endsWith("commercial-active.ts")
          ? `forbidden ${CAST}`
          : false,
    );
    assert.deepEqual(plantViolations, [
      "lib/web3/plant.ts: forbidden as Eip155ChainId",
    ]);

    const scan = scanProductSources(
      (relPath, source) => {
        if (!source.includes(CAST)) return false;
        return `forbidden ${CAST}`;
      },
      { owners: ["lib/web3/commercial-active.ts"] },
    );
    assert.deepEqual(
      scan.violations,
      [],
      `forbidden brand cast outside mint owner:\n${scan.violations
        .map((v) => `${v.path}: ${v.reason}`)
        .join("\n")}`,
    );
  });

  it("number into branded doors fails tsc with TS2345 on each of four call lines", () => {
    const red = runDoorProbe(`
import { getViemChain, rpcUrlForChain } from "@/lib/web3/supported-chains.ts";
import { getPublicClient } from "@/lib/web3/public-client.ts";
import { getBridgeReadClient } from "@/lib/web3/bridge/bridge-read-client.ts";

export const a = getViemChain(84532);
export const b = rpcUrlForChain(84532);
export const c = getPublicClient(84532);
export const d = getBridgeReadClient(84532);
`);
    assert.notEqual(
      red.status,
      0,
      `expected tsc red for number doors; out=${red.out}`,
    );
    // Line-number pin: each of the four door call lines reports TS2345
    const callLines = [
      ...red.out.matchAll(/probe\.ts\((\d+),\d+\): error TS2345/g),
    ].map((m) => Number(m[1]));
    assert.deepEqual(
      [...new Set(callLines)].sort((a, b) => a - b),
      [6, 7, 8, 9],
      `expected TS2345 on probe lines 6–9; got ${JSON.stringify(callLines)}; out=${red.out}`,
    );

    const green = runDoorProbe(`
import { resolveEvmChain } from "@/lib/web3/commercial-active.ts";
import { getViemChain, rpcUrlForChain } from "@/lib/web3/supported-chains.ts";
import { getPublicClient } from "@/lib/web3/public-client.ts";
import { getBridgeReadClient } from "@/lib/web3/bridge/bridge-read-client.ts";

const r = resolveEvmChain(84532);
if (!r.ok) throw new Error("expected ok");
export const a = getViemChain(r.chainId);
export const b = rpcUrlForChain(r.chainId);
export const c = getPublicClient(r.chainId);
export const d = getBridgeReadClient(r.chainId);
`);
    assert.equal(
      green.status,
      0,
      `expected tsc green for branded doors; out=${green.out}`,
    );
  });

  it("ActiveAccount switchChain rejects plain number (TS2345)", () => {
    const red = runDoorProbe(`
import type { ActiveAccountSwitchChain } from "@/lib/web3/active-account-switch.ts";

declare const switchChain: ActiveAccountSwitchChain;
declare const namespace: number;
export const call = switchChain(namespace);
`);
    assert.notEqual(
      red.status,
      0,
      `expected tsc red for number switchChain; out=${red.out}`,
    );
    assert.match(
      red.out,
      /probe\.ts\(\d+,\d+\): error TS2345/,
      `expected TS2345; out=${red.out}`,
    );

    const green = runDoorProbe(`
import type { ActiveAccountSwitchChain } from "@/lib/web3/active-account-switch.ts";
import { resolveEvmChain } from "@/lib/web3/commercial-active.ts";

declare const switchChain: ActiveAccountSwitchChain;
const r = resolveEvmChain(84532);
if (!r.ok) throw new Error("expected ok");
export const call = switchChain(r.chainId);
`);
    assert.equal(
      green.status,
      0,
      `expected tsc green for branded switchChain; out=${green.out}`,
    );
  });

  it("no door-Result !ok throw (AST) / writeUnionChainId leak / EVM-by-construction resolve", () => {
    const plantCodemod = scanTempTree(
      {
        "lib/web3/plant.ts":
          "const r = resolveEvmChain(1);\nif (!r.ok) throw new Error(`resolveEvmChain: ${r.cause}`);\n",
      },
      (rel, source) => {
        const hits = findDoorResultThrowViolations(rel, source);
        return hits.length > 0 ? hits.join("; ") : false;
      },
    );
    assert.deepEqual(plantCodemod, [
      "lib/web3/plant.ts: door-result throw at line 2",
    ]);

    const plantSwitch = scanTempTree(
      {
        "lib/web3/plant.ts":
          "const wagmi = evmWagmiChain(1);\nif (!wagmi.ok) throw new Error(`switchChain: ${wagmi.cause}`);\n",
      },
      (rel, source) => {
        const hits = findDoorResultThrowViolations(rel, source);
        return hits.length > 0 ? hits.join("; ") : false;
      },
    );
    assert.deepEqual(plantSwitch, [
      "lib/web3/plant.ts: door-result throw at line 2",
    ]);

    const plantPlain = scanTempTree(
      {
        "lib/web3/plant.ts":
          'const wagmi = evmWagmiChain(1);\nif (!wagmi.ok) throw new Error("nope");\n',
      },
      (rel, source) => {
        const hits = findDoorResultThrowViolations(rel, source);
        return hits.length > 0 ? hits.join("; ") : false;
      },
    );
    assert.deepEqual(plantPlain, [
      "lib/web3/plant.ts: door-result throw at line 2",
    ]);

    const throwScan = scanProductSources((rel, source) => {
      const hits = findDoorResultThrowViolations(rel, source);
      return hits.length > 0 ? hits.join("; ") : false;
    });
    assert.deepEqual(
      throwScan.violations,
      [],
      throwScan.violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );

    const writeUnionScan = scanProductSources((rel, source) => {
      if (rel === "lib/web3/supported-chains.ts") return false;
      if (rel === "lib/architecture/chokepoints.ts") return false;
      if (/\bwriteUnionChainId\b/.test(source)) {
        return "writeUnionChainId referenced outside supported-chains.ts";
      }
      return false;
    });
    assert.deepEqual(
      writeUnionScan.violations,
      [],
      writeUnionScan.violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );

    for (const rel of EVM_BY_CONSTRUCTION) {
      const full = path.join(ROOT, rel);
      const source = fs.readFileSync(full, "utf8");
      const blocks = [
        ...source.matchAll(
          /if\s*\(\s*stack\.vm\s*===\s*"evm"\s*\)\s*\{([\s\S]*?)\n  \}/g,
        ),
      ];
      for (const m of blocks) {
        const body = m[1] ?? "";
        assert.equal(
          /\bresolveEvmChain\s*\(/.test(body),
          false,
          `${rel}: resolveEvmChain inside stack.vm === "evm"`,
        );
        assert.equal(
          /\bevmWagmiChain\s*\(/.test(body),
          false,
          `${rel}: evmWagmiChain inside stack.vm === "evm"`,
        );
      }
    }
  });
});
