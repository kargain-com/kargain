/**
 * N2 — the commercial registry is the sole runtime address source.
 *
 * Pins the rule, not one spelling:
 * - no environment path to a contract address (deleted names, env var names,
 *   dynamic `process.env[...]` in the door modules);
 * - address doors take `Eip155ChainId` (a bare number is TS2345);
 * - one protocol-address enumerator (a second function reading the same stack
 *   fields is red) and one mode-address reader (a direct read outside
 *   `commerce/mode.ts` is red);
 * - the historical owner holds no chain-id literal, and the chain-id literal
 *   exports are gone (one owner for the local id);
 * - per-consumer protocol sets are supersets of the pre-registry sets;
 * - a verifier read with a non-EVM namespace is unusable (null), not "false".
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { readActiveVerifierMemberships } from "../lib/kar-pro/is-active-verifier-commercial.ts";
import {
  COMMERCIAL_ACTIVE,
  commercialProtocolAddresses,
  evmProtocolAddresses,
  requireEvmCommercialActive,
} from "../lib/web3/commercial-active.ts";
import {
  ETHEREUM_SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
} from "../lib/web3/sepolia-addresses.ts";
import {
  BASE_SEPOLIA_AT_6C5CEBC,
  ETHEREUM_SEPOLIA_AT_6C5CEBC,
  type BaselineChain,
} from "./fixtures/n2-addresses-at-6c5cebc.ts";
import {
  assertCleanCommercialAbiEnumerationScan,
  assertCleanProductScan,
  scanCommercialAbiEnumerationSources,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVM_NS = 2000040168;
const WALLET = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;

/** Registry-stack fields that name a Kargain-owned address. */
const OWNED_FIELDS = new Set([
  "karPassport",
  "karProPass",
  "karProStaking",
  "usdc",
  "nativeFeed",
  "eurFeed",
  "bridgeGateway",
  "timelock",
  "fixedPriceConsignment",
  "ascendingConsignment",
  "layerZeroEndpoint",
  "historicalDenylist",
]);

/** A function reading this many distinct owned fields is an enumerator. */
const ENUMERATOR_THRESHOLD = 4;

const MODE_FIELDS = new Set(["fixedPriceConsignment", "ascendingConsignment"]);

/** Sole owner of the protocol-address union and of the registry rows. */
const PROTOCOL_OWNER = "lib/web3/commercial-active.ts";
/** Sole reader of a mode address (beside the registry rows themselves). */
const MODE_OWNERS = ["lib/web3/commercial-active.ts", "lib/commerce/mode.ts"];

function parse(rel: string, source: string): ts.SourceFile {
  return ts.createSourceFile(rel, source, ts.ScriptTarget.ES2022, true);
}

function accessedFieldName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  if (ts.isBindingElement(node)) {
    const key = node.propertyName ?? node.name;
    if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) return key.text;
  }
  return null;
}

/** Functions (or the module body) that read ≥ threshold distinct owned fields. */
function findSecondEnumerators(rel: string, source: string): string[] {
  const sf = parse(rel, source);
  const found: string[] = [];
  const scopes: Array<{ name: string; fields: Set<string> }> = [];
  const visit = (node: ts.Node) => {
    const isScope =
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node);
    if (isScope) {
      const name =
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        node.name != null
          ? node.name.getText(sf)
          : "<anonymous>";
      scopes.push({ name, fields: new Set() });
    }
    const field = accessedFieldName(node);
    const top = scopes.length > 0 ? scopes[scopes.length - 1] : null;
    if (field != null && OWNED_FIELDS.has(field) && top != null) {
      top.fields.add(field);
    }
    ts.forEachChild(node, visit);
    if (isScope) {
      const scope = scopes.pop();
      if (scope != null && scope.fields.size >= ENUMERATOR_THRESHOLD) {
        found.push(`${rel}: ${scope.name} reads ${scope.fields.size} owned fields`);
      }
    }
  };
  visit(sf);
  return found;
}

/**
 * Reads of a mode address field — property, string element, destructure, or
 * computed `stack[key]` when a mode-name string literal appears in-file
 * (catches CLAIMABLE_STACK_KEYS-style bypasses).
 */
function findDirectModeReads(rel: string, source: string): string[] {
  const sf = parse(rel, source);
  const found: string[] = [];
  const modeLiterals = new Set<string>();
  const collectLiterals = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) && MODE_FIELDS.has(node.text)) {
      modeLiterals.add(node.text);
    }
    ts.forEachChild(node, collectLiterals);
  };
  collectLiterals(sf);

  const visit = (node: ts.Node) => {
    const field = accessedFieldName(node);
    if (field != null && MODE_FIELDS.has(field)) {
      found.push(`${rel}: reads ${field}`);
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "stack" &&
      !ts.isStringLiteralLike(node.argumentExpression) &&
      modeLiterals.size > 0
    ) {
      // Narrow: CLAIMABLE-style tables (not SVM program-id field walks).
      const claimableShape =
        /CLAIMABLE_STACK_KEYS/.test(source) ||
        /as keyof CommercialActiveStack/.test(source) ||
        /\[\s*["']fixedPriceConsignment["']\s*,\s*["']ascendingConsignment["']/.test(
          source,
        );
      if (claimableShape) {
        found.push(
          `${rel}: computed mode key via stack[...] (${[...modeLiterals].join(",")})`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Held EVM stack + address-door re-entry (global COMMERCIAL_ACTIVE). */
function findStackHolderDoorCalls(rel: string, source: string): string[] {
  const hits: string[] = [];
  // Text plant: door(evmChainOf(stack)) is the dual-source defect.
  if (/karPassportAddress\s*\(\s*evmChainOf\s*\(\s*stack\b/.test(source)) {
    hits.push(`${rel}: karPassportAddress(evmChainOf(stack))`);
  }
  if (/karProStakingAddress\s*\(\s*evmChainOf\s*\(\s*stack\b/.test(source)) {
    hits.push(`${rel}: karProStakingAddress(evmChainOf(stack))`);
  }
  return hits;
}

function numericLiterals(source: string): number[] {
  const sf = parse("probe.ts", source);
  const out: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isNumericLiteral(node)) out.push(Number(node.text.replace(/_/g, "")));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function runProbe(source: string): { status: number | null; out: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-n2-door-"));
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
            paths: { "@/*": [path.join(ROOT, "*")] },
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
    return { status: result.status, out: `${result.stdout}\n${result.stderr}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const DOOR_IMPORT = `import {
  bridgeGatewayAddress,
  chainlinkEurUsdFeed,
  chainlinkNativeUsdFeed,
  kargainTimelockAddress,
  karPassportAddress,
  karProPassAddress,
  karProStakingAddress,
  usdcAddress,
} from "@/lib/web3/deployment-addresses.ts";
import { bridgeTokenAddress } from "@/lib/web3/bridge/bridge-config.ts";
import { resolveEvmChain } from "@/lib/web3/commercial-active.ts";
`;

describe("no environment path to a contract address", () => {
  it("deleted resolver names do not exist anywhere in product, indexer or scripts", () => {
    const banned =
      /\b(ENV_SINGLE|ENV_BY_CHAIN|parseJsonMap|resolveAddress|resolveOptionalAddress|commerceModeAddress|fixedPriceConsignmentAddress|ascendingConsignmentAddress|kargainContractDenylist|allProtocolAddresses)\b/;
    const scan = scanCommercialAbiEnumerationSources((rel, source) => {
      void rel;
      return banned.test(source) ? "deleted address resolver name" : false;
    });
    assertCleanCommercialAbiEnumerationScan(scan);
  });

  it("no address env var name and no dynamic process.env read in product or indexer", () => {
    const addressEnv =
      /NEXT_PUBLIC_(?!RPC)\w*(_ADDRESS|_FEED|_BY_CHAIN)\b/;
    const scan = scanProductSources((rel, source) => {
      if (addressEnv.test(source)) return "address env var";
      if (
        /(deployment-addresses|sepolia-addresses)\.ts$/.test(rel) &&
        /process\.env/.test(source)
      ) {
        return "door module reads process.env";
      }
      return false;
    });
    assertCleanProductScan(scan);
  });

  it("constructed: a planted env address read is detected", () => {
    const addressEnv =
      /NEXT_PUBLIC_(?!RPC)\w*(_ADDRESS|_FEED|_BY_CHAIN)\b/;
    assert.equal(
      addressEnv.test("const a = process.env.NEXT_PUBLIC_KAR_PASSPORT_BY_CHAIN;"),
      true,
    );
    assert.equal(
      addressEnv.test("const a = process.env.NEXT_PUBLIC_RPC_BY_CHAIN;"),
      false,
    );
  });
});

describe("chain-id literals have one owner each", () => {
  it("the historical owner (sepolia-addresses) holds no chain-id literal", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "lib/web3/sepolia-addresses.ts"),
      "utf8",
    );
    const literals = numericLiterals(source);
    for (const id of [84532, 11155111, 31337]) {
      assert.equal(
        literals.includes(id),
        false,
        `sepolia-addresses.ts must derive ${id} from the registry row`,
      );
    }
    assert.ok(source.includes("evmChainOf("));
  });

  it("detector: a planted literal is red", () => {
    assert.equal(
      numericLiterals("export const SEPOLIA_CHAIN_ID = 84532;").includes(84532),
      true,
    );
  });

  it("no chain-id literal export outside the local-chain owner", () => {
    const literalExport =
      /export\s+const\s+(BASE_SEPOLIA|ETHEREUM_SEPOLIA|SEPOLIA|LOCALHOST|LOCAL)_CHAIN_ID\b(\s*:\s*[\w.]+)?\s*=\s*\d[\d_]*\b/;
    const scan = scanCommercialAbiEnumerationSources((rel, source) => {
      if (rel === "lib/web3/local-chain.ts") return false;
      if (rel.startsWith("scripts/")) return false;
      return literalExport.test(source) ? "chain-id literal export" : false;
    });
    assertCleanCommercialAbiEnumerationScan(scan);
  });

  it("exactly one LOCALHOST_CHAIN_ID definition", () => {
    const defs: string[] = [];
    const scan = scanCommercialAbiEnumerationSources((rel, source) => {
      if (/export\s+const\s+LOCALHOST_CHAIN_ID\b/.test(source)) defs.push(rel);
      return false;
    });
    assertCleanCommercialAbiEnumerationScan(scan);
    assert.deepEqual(defs, ["lib/web3/local-chain.ts"]);
  });
});

describe("address doors take Eip155ChainId", () => {
  it("a bare number is TS2345 on every door; a resolved chain is green", () => {
    const red = runProbe(`${DOOR_IMPORT}
export const a = karPassportAddress(84532);
export const b = karProPassAddress(84532);
export const c = karProStakingAddress(84532);
export const d = usdcAddress(84532);
export const e = chainlinkNativeUsdFeed(84532);
export const f = kargainTimelockAddress(84532);
export const g = bridgeGatewayAddress(84532);
export const h = bridgeTokenAddress(84532);
export const i = chainlinkEurUsdFeed(84532);
`);
    assert.notEqual(red.status, 0, red.out);
    const lines = [...red.out.matchAll(/probe\.ts\((\d+),\d+\): error TS2345/g)].map(
      (m) => Number(m[1]),
    );
    const callLines = [...new Set(lines)].sort((x, y) => x - y);
    assert.equal(callLines.length, 9, `expected nine TS2345 lines; out=${red.out}`);

    const green = runProbe(`${DOOR_IMPORT}
const r = resolveEvmChain(84532);
if (!r.ok) throw new Error("expected ok");
export const a = karPassportAddress(r.chainId);
export const b = karProPassAddress(r.chainId);
export const c = karProStakingAddress(r.chainId);
export const d = usdcAddress(r.chainId);
export const e = chainlinkNativeUsdFeed(r.chainId);
export const f = kargainTimelockAddress(r.chainId);
export const g = bridgeGatewayAddress(r.chainId);
export const h = bridgeTokenAddress(r.chainId);
export const i = chainlinkEurUsdFeed(r.chainId);
`);
    assert.equal(green.status, 0, green.out);
  });
});

describe("one protocol-address enumerator", () => {
  it("no function outside the registry owner reads the owned stack fields as a set", () => {
    const scan = scanCommercialAbiEnumerationSources(
      (rel, source) => {
        if (rel.startsWith("scripts/")) return false;
        const hits = findSecondEnumerators(rel, source);
        return hits.length > 0 ? hits.join("; ") : false;
      },
      { owners: [PROTOCOL_OWNER] },
    );
    assertCleanCommercialAbiEnumerationScan(scan, { owners: [PROTOCOL_OWNER] });
  });

  it("constructed: a planted second enumerator is red; the owner is the only reader", () => {
    const planted = `
import type { EvmCommercialActiveStack } from "@/lib/web3/commercial-active";
export function mine(stack: EvmCommercialActiveStack): string[] {
  const out: string[] = [];
  out.push(stack.karPassport);
  out.push(stack.karProPass);
  out.push(stack.usdc);
  out.push(stack.bridgeGateway);
  return out;
}
`;
    assert.equal(findSecondEnumerators("lib/plant.ts", planted).length, 1);
    const owner = fs.readFileSync(path.join(ROOT, PROTOCOL_OWNER), "utf8");
    assert.ok(
      findSecondEnumerators(PROTOCOL_OWNER, owner).length >= 2,
      "owner functions are detected by the same detector",
    );
    const doors = fs.readFileSync(
      path.join(ROOT, "lib/web3/deployment-addresses.ts"),
      "utf8",
    );
    assert.deepEqual(findSecondEnumerators("lib/web3/deployment-addresses.ts", doors), []);
  });
});

describe("one mode-address reader", () => {
  it("no product or indexer file reads a mode address outside commerce/mode.ts", () => {
    const scan = scanCommercialAbiEnumerationSources(
      (rel, source) => {
        // Indexer address bundle (`ponder.config.ts`) and deploy tooling carry their
        // own manifest-shaped fields; the rule is about the registry stack.
        if (rel.startsWith("scripts/") || rel === "ponder.config.ts") return false;
        const hits = findDirectModeReads(rel, source);
        return hits.length > 0 ? hits.join("; ") : false;
      },
      { owners: MODE_OWNERS },
    );
    assertCleanCommercialAbiEnumerationScan(scan, { owners: MODE_OWNERS });
  });

  it("constructed: planted direct mode reads are red (property, element, destructure)", () => {
    for (const planted of [
      "export const a = stack.fixedPriceConsignment;",
      'export const a = stack["ascendingConsignment"];',
      "export const { fixedPriceConsignment } = stack;",
    ]) {
      assert.equal(findDirectModeReads("lib/plant.ts", planted).length, 1, planted);
    }
    assert.deepEqual(
      findDirectModeReads("lib/plant.ts", "export const a = stack.karPassport;"),
      [],
    );
  });

  it("constructed: computed stack[key] with a mode-name literal is red", () => {
    const planted = `
const CLAIMABLE_STACK_KEYS = ["fixedPriceConsignment", "ascendingConsignment"] as const;
export function read(stack: { [k: string]: string }) {
  for (const key of CLAIMABLE_STACK_KEYS) {
    void stack[key as keyof typeof stack];
  }
}
`;
    assert.ok(
      findDirectModeReads("lib/web3/claimable-contracts.ts", planted).length >= 1,
    );
  });
});

describe("held stack does not re-enter address doors", () => {
  it("no product file calls karPassportAddress(evmChainOf(stack))", () => {
    const scan = scanCommercialAbiEnumerationSources((rel, source) => {
      if (rel.startsWith("scripts/") || rel.startsWith("test/")) return false;
      const hits = findStackHolderDoorCalls(rel, source);
      return hits.length > 0 ? hits.join("; ") : false;
    });
    assertCleanCommercialAbiEnumerationScan(scan);
  });

  it("constructed: door(evmChainOf(stack)) is red", () => {
    const planted = `
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { evmChainOf } from "@/lib/web3/commercial-active";
export function plan(stack: { vm: "evm" }) {
  return karPassportAddress(evmChainOf(stack));
}
`;
    assert.equal(
      findStackHolderDoorCalls("lib/passport/plant.ts", planted).length,
      1,
    );
  });
});

function assertSuperset(
  actual: readonly string[],
  baseline: readonly string[],
  label: string,
) {
  const have = new Set(actual.map((a) => a.toLowerCase()));
  for (const addr of baseline) {
    assert.equal(have.has(addr.toLowerCase()), true, `${label}: lost ${addr}`);
  }
}

function assertConsumerSupersets(
  stack: ReturnType<typeof requireEvmCommercialActive>,
  base: BaselineChain,
) {
  assertSuperset(evmProtocolAddresses(stack), base.walletSet, "wallet / messaging");
  assertSuperset(evmProtocolAddresses(stack), base.denylistSet, "contract denylist");
  assertSuperset(
    commercialProtocolAddresses(stack),
    base.profileIdentitySet,
    "profile identity",
  );
  const set = new Set(evmProtocolAddresses(stack).map((a) => a.toLowerCase()));
  for (const excluded of [
    stack.deployer,
    stack.upgradeAuthority,
    stack.platformRecipient,
    stack.forfeitRecipient,
  ]) {
    // Where governance is the Timelock, the Timelock is a protocol address.
    if (excluded == null || excluded.toLowerCase() === stack.timelock.toLowerCase()) {
      continue;
    }
    assert.equal(
      set.has(excluded.toLowerCase()),
      false,
      `${excluded} is a subject, not a protocol address (SPEC II.4.1)`,
    );
  }
}

describe("protocol-address union is a superset of the pre-registry consumers", () => {
  it("84532", () =>
    assertConsumerSupersets(
      requireEvmCommercialActive(SEPOLIA_CHAIN_ID),
      BASE_SEPOLIA_AT_6C5CEBC,
    ));

  it("11155111", () =>
    assertConsumerSupersets(
      requireEvmCommercialActive(ETHEREUM_SEPOLIA_CHAIN_ID),
      ETHEREUM_SEPOLIA_AT_6C5CEBC,
    ));

  it("SVM stack keeps its programs and excludes the deployer", () => {
    const svm = COMMERCIAL_ACTIVE[SVM_NS];
    assert.ok(svm != null && svm.vm === "svm");
    const set = new Set(commercialProtocolAddresses(svm));
    assert.equal(set.has(svm.karPassport), true);
    assert.equal(set.has(svm.deployer), false);
  });
});

describe("verifier read on a non-EVM namespace", () => {
  it("is unusable (null → failure), never a false-for-everyone success", async () => {
    const result = await readActiveVerifierMemberships([
      { chainId: SVM_NS, address: WALLET },
    ]);
    assert.equal(result.status, "failure");
  });

  it("a mixed batch resolves only the EVM membership", async () => {
    const result = await readActiveVerifierMemberships(
      [
        { chainId: SEPOLIA_CHAIN_ID, address: WALLET },
        { chainId: SVM_NS, address: WALLET },
      ],
      {
        readChainActive: async (chainId, addresses) =>
          chainId === SEPOLIA_CHAIN_ID ? addresses.map(() => true) : null,
      },
    );
    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.equal(result.activeByMembership.size, 1);
  });
});
