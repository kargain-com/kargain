/**
 * S1 network-class policies: one commercial definition, eip155 accessor,
 * protocol address compare owner, declared weights, namespace∩EIP-155.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMMERCIAL_ACTIVE,
  commercialEip155Ids,
  eip155Of,
  isCommercialEip155Id,
} from "../lib/web3/commercial-active.ts";
import {
  DECLARED_ASCENDING_CHALLENGE_BOND_WEI,
  DECLARED_DISPUTE_DEPOSIT_WEI,
  DECLARED_MIN_STAKE_FLOOR_WEI,
  DECLARED_MIN_STAKE_NATIVE_WEI,
} from "../lib/web3/declared-weights.ts";
import { protocolAddressesEqual } from "../lib/web3/protocol-address.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_DIRS = [
  path.join(ROOT, "app"),
  path.join(ROOT, "components"),
  path.join(ROOT, "hooks"),
  path.join(ROOT, "lib"),
  path.join(ROOT, "scripts"),
  path.join(ROOT, "src"),
  path.join(ROOT, "test"),
] as const;

const COMMERCIAL_OWNER = path.join(ROOT, "lib/web3/commercial-active.ts");
const WEIGHT_OWNER = path.join(ROOT, "lib/web3/declared-weights.ts");
const ADDRESS_OWNER = path.join(ROOT, "lib/web3/protocol-address.ts");
const WAGMI_OWNER = path.join(ROOT, "lib/web3/supported-chains.ts");

/** Second definition of the commercial predicate (function body with OR literals). */
const SECOND_IS_COMMERCIAL =
  /function\s+isCommercialEip155Id\s*\([^)]*\)\s*(?::[^{]+)?\{[^}]*chainId\s*===\s*84532/;

/** Weight wei literals that must live only in declared-weights. */
const WEIGHT_LITERALS = [
  /50_000_000_000_000_000n/,
  /10_000_000_000_000_000n/,
  /1_000_000_000_000_000n/,
] as const;

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(ROOT, file);
}

describe("commercial stack registry policy", () => {
  it("isCommercialEip155Id is defined only in commercial-active.ts", () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (file === COMMERCIAL_OWNER) continue;
        const text = fs.readFileSync(file, "utf8");
        if (SECOND_IS_COMMERCIAL.test(text)) {
          violations.push(rel(file));
        }
        // Ban local allowlist OR that redefines commercial set
        if (
          /chainId\s*===\s*84532\s*\|\|\s*chainId\s*===\s*11155111/.test(text) &&
          !file.endsWith("network-class-policy.test.ts")
        ) {
          violations.push(rel(file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("nuclear and feeds import the registry owner; feeds does not re-export it", () => {
    const nuclear = fs.readFileSync(
      path.join(ROOT, "scripts/lib/nuclear-deploy-plan.ts"),
      "utf8",
    );
    const feeds = fs.readFileSync(
      path.join(ROOT, "scripts/lib/chainlink-feeds.ts"),
      "utf8",
    );
    assert.match(nuclear, /commercialEip155Ids/);
    assert.match(nuclear, /from\s+["'].*commercial-active/);
    assert.doesNotMatch(nuclear, /export\s+const\s+COMMERCIAL_CHAIN_IDS/);
    assert.match(feeds, /from\s+["'].*commercial-active/);
    assert.match(feeds, /isCommercialEip155Id/);
    assert.doesNotMatch(
      feeds,
      /export\s+(?:type\s+)?\{[^}]*(?:CommercialChainId|isCommercialEip155Id|commercialEip155Ids)/,
    );
    assert.ok(!/chainId === 84532 \|\| chainId === 11155111/.test(feeds));
  });

  it("registry symbols are not re-exported outside commercial-active.ts", () => {
    const violations: string[] = [];
    /** Re-export of registry predicate / type / id list from a non-owner module. */
    const REEXPORT =
      /export\s+(?:type\s+)?\{[^}]*(?:\bisCommercialEip155Id\b|\bCommercialChainId\b|\bcommercialEip155Ids\b)[^}]*\}\s*from\s*["'][^"']+["']/;
    const REEXPORT_VALUE =
      /export\s*\{[^}]*(?:\bisCommercialEip155Id\b|\bcommercialEip155Ids\b)[^}]*\}/;
    const ALIAS_LIST = /export\s+const\s+COMMERCIAL_CHAIN_IDS\b/;
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (file === COMMERCIAL_OWNER) continue;
        if (file.endsWith("network-class-policy.test.ts")) continue;
        const text = fs.readFileSync(file, "utf8");
        if (REEXPORT.test(text) || REEXPORT_VALUE.test(text) || ALIAS_LIST.test(text)) {
          violations.push(rel(file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("app/hooks do not re-derive commercial ids via Object.keys(COMMERCIAL_ACTIVE)", () => {
    const violations: string[] = [];
    const DERIVE = /Object\.keys\s*\(\s*COMMERCIAL_ACTIVE\s*\)/;
    for (const dir of [
      path.join(ROOT, "hooks"),
      path.join(ROOT, "components"),
      path.join(ROOT, "app"),
    ]) {
      for (const file of listTsFiles(dir)) {
        const text = fs.readFileSync(file, "utf8");
        if (DERIVE.test(text)) violations.push(rel(file));
      }
    }
    assert.deepEqual(violations, []);
  });

  it("registry exports type guard and two EVM stacks", () => {
    assert.equal(isCommercialEip155Id(84532), true);
    assert.equal(isCommercialEip155Id(11155111), true);
    assert.equal(isCommercialEip155Id(1), false);
    assert.deepEqual(commercialEip155Ids(), [84532, 11155111]);
    for (const id of commercialEip155Ids()) {
      const stack = COMMERCIAL_ACTIVE[id];
      assert.equal(stack.vm, "evm");
      assert.equal(stack.nativeUnit.symbol, "ETH");
      assert.equal(stack.nativeUnit.decimals, 18);
      assert.equal(eip155Of(id), id);
      assert.equal(Number(stack.namespace), stack.chainId);
    }
  });
});

describe("eip155 accessor policy", () => {
  it("wagmiChainId consumes eip155Of for commercial ids", () => {
    const text = fs.readFileSync(WAGMI_OWNER, "utf8");
    assert.match(text, /eip155Of/);
    assert.match(text, /isCommercialEip155Id/);
    assert.ok(
      !/return chainId as KargainChainId/.test(text),
      "blind cast removed",
    );
  });
});

describe("protocol address compare policy", () => {
  it("protocol toLowerCase for address compare lives only in protocol-address.ts", () => {
    const violations: string[] = [];
    const wallet = path.join(ROOT, "lib/web3/wallet-account.ts");
    for (const file of [wallet]) {
      const text = fs.readFileSync(file, "utf8");
      // Ban direct case-fold compare on protocol addresses outside owner
      if (
        /\.toLowerCase\(\)\s*===\s*\w+\.toLowerCase\(\)/.test(text) ||
        /addr\.toLowerCase\(\)/.test(text)
      ) {
        violations.push(rel(file));
      }
    }
    assert.deepEqual(violations, []);
    const owner = fs.readFileSync(ADDRESS_OWNER, "utf8");
    assert.match(owner, /toLowerCase/);
    assert.equal(
      protocolAddressesEqual(
        84532,
        "0x8354697d0DdCe6a3AA9aD33DDc1585e4b60CbC76",
        "0x8354697d0ddce6a3aa9ad33ddc1585e4b60cbc76",
      ),
      true,
    );
  });
});

describe("declared weights policy", () => {
  it("weight wei literals exist only in declared-weights.ts under lib/ and scripts/", () => {
    const violations: string[] = [];
    for (const dir of [path.join(ROOT, "lib"), path.join(ROOT, "scripts")]) {
      for (const file of listTsFiles(dir)) {
        if (file === WEIGHT_OWNER) continue;
        const text = fs.readFileSync(file, "utf8");
        for (const lit of WEIGHT_LITERALS) {
          if (lit.test(text)) {
            violations.push(`${rel(file)} (${lit})`);
          }
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("verify-constructor-args and local-stack import declared weights", () => {
    const verify = fs.readFileSync(
      path.join(ROOT, "scripts/lib/verify-constructor-args.ts"),
      "utf8",
    );
    const local = fs.readFileSync(
      path.join(ROOT, "scripts/lib/local-stack.ts"),
      "utf8",
    );
    assert.match(verify, /declared-weights/);
    assert.match(local, /declared-weights/);
    assert.equal(DECLARED_MIN_STAKE_NATIVE_WEI, 50_000_000_000_000_000n);
    assert.equal(DECLARED_MIN_STAKE_FLOOR_WEI, 1_000_000_000_000_000n);
    assert.equal(DECLARED_DISPUTE_DEPOSIT_WEI, 10_000_000_000_000_000n);
    assert.equal(
      DECLARED_ASCENDING_CHALLENGE_BOND_WEI,
      DECLARED_DISPUTE_DEPOSIT_WEI,
    );
  });
});

describe("namespace ∩ EIP-155 non-collision (SPEC §13.1)", () => {
  it("every commercial EVM namespace equals its EIP-155", () => {
    const eip155Set = new Set<number>([...commercialEip155Ids()]);
    for (const id of commercialEip155Ids()) {
      const stack = COMMERCIAL_ACTIVE[id];
      assert.equal(stack.vm, "evm");
      assert.equal(Number(stack.namespace), stack.chainId);
      assert.equal(eip155Of(stack.namespace), stack.chainId);
      assert.ok(eip155Set.has(stack.chainId));
    }
    for (const key of Object.keys(COMMERCIAL_ACTIVE).map(Number)) {
      const stack = COMMERCIAL_ACTIVE[key]!;
      if (stack.vm === "evm") {
        assert.ok(eip155Set.has(key), `registry key ${key} is not a commercial EIP-155`);
        assert.equal(eip155Of(key), key);
        continue;
      }
      assert.equal(key, Number(stack.namespace));
      assert.equal(eip155Set.has(key), false);
    }
  });
});
