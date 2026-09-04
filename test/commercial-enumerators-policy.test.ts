/**
 * S9 Unit1 — commercialEip155Ids never leaks reserved-band SVM namespaces.
 * Planted control injects a mixed registry into the **product** enumerator.
 * Chain-context custody/origin must use isCommercialNamespace (not EIP-155).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  COMMERCIAL_ACTIVE,
  commercialEip155Ids,
  commercialSvmNamespaceIds,
  isCommercialEip155Id,
  isCommercialNamespace,
  registeredCommercialNamespaceIds,
  type CommercialRegistry,
} from "../lib/web3/commercial-active.ts";
import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.ts";
import { POLICY_SCAN_ROOT } from "./policy-scan-helpers.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";

const SOLANA_NS = namespaceFromLayerZeroEid(40168);
const CHAIN_CONTEXT = "lib/web3/chain-context.ts";

/**
 * Custody / origin resolvers must gate on isCommercialNamespace.
 * Using isCommercialEip155Id there would treat a future SVM row as non-commercial.
 */
function custodyOriginPredicateUse(source: string): string[] {
  const reasons: string[] = [];
  const custody = source.match(
    /export function resolveCustodyCommerceChainId\([\s\S]*?\n\}/,
  );
  const origin = source.match(
    /export function resolveOriginChainId\([\s\S]*?\n\}/,
  );
  for (const [name, block] of [
    ["resolveCustodyCommerceChainId", custody?.[0]],
    ["resolveOriginChainId", origin?.[0]],
  ] as const) {
    if (!block) {
      reasons.push(`${name}: function body not found`);
      continue;
    }
    if (!/\bisCommercialNamespace\b/.test(block)) {
      reasons.push(`${name}: missing isCommercialNamespace`);
    }
    if (/\bisCommercialEip155Id\b/.test(block)) {
      reasons.push(`${name}: uses isCommercialEip155Id (wrong predicate)`);
    }
  }
  return reasons;
}

describe("commercial enumerators (S9 Unit1)", () => {
  it("commercialEip155Ids lists only live EVM chain ids", () => {
    assert.deepEqual([...commercialEip155Ids()], [84532, 11155111]);
    for (const id of commercialEip155Ids()) {
      const stack = COMMERCIAL_ACTIVE[id];
      assert.ok(stack);
      assert.equal(stack.vm, "evm");
      assert.ok(isCommercialEip155Id(id));
      assert.ok(isCommercialNamespace(id));
    }
  });

  it("commercialSvmNamespaceIds empty while registry is EVM-only", () => {
    assert.deepEqual([...commercialSvmNamespaceIds()], []);
  });

  it("registeredCommercialNamespaceIds equals EVM namespaces today", () => {
    assert.deepEqual([...registeredCommercialNamespaceIds()], [84532, 11155111]);
  });

  it("isCommercialEip155Id is false for reserved SVM namespace; isCommercialNamespace needs a row", () => {
    assert.equal(isCommercialEip155Id(SOLANA_NS), false);
    assert.equal(isCommercialNamespace(SOLANA_NS), false);
  });

  it("planted (a)(b): product commercialEip155Ids filters SVM; predicates diverge", () => {
    const mixed: CommercialRegistry = {
      84532: COMMERCIAL_ACTIVE[84532]!,
      [SOLANA_NS]: FIXTURE_SVM_STACK,
    };
    const naiveKeys = Object.keys(mixed).map(Number).sort((a, b) => a - b);
    assert.ok(naiveKeys.includes(SOLANA_NS), "fixture: naive keys include SVM ns");

    const productEip155 = commercialEip155Ids(mixed);
    assert.deepEqual([...productEip155], [84532]);
    assert.ok(!productEip155.includes(SOLANA_NS as never));

    assert.deepEqual([...commercialSvmNamespaceIds(mixed)], [SOLANA_NS]);
    assert.deepEqual(
      [...registeredCommercialNamespaceIds(mixed)].sort((a, b) => a - b),
      [84532, SOLANA_NS].sort((a, b) => a - b),
    );
    // (b) one input, two answers
    assert.equal(isCommercialEip155Id(SOLANA_NS, mixed), false);
    assert.equal(isCommercialNamespace(SOLANA_NS, mixed), true);
  });

  it("planted (c): custody/origin wrong predicate is red; live chain-context is green", () => {
    const dirty = `
export function resolveCustodyCommerceChainId(custodyChain: number | null | undefined): number | null {
  if (custodyChain == null || !Number.isFinite(custodyChain)) return null;
  if (!isCommercialEip155Id(custodyChain)) return null;
  return custodyChain;
}
export function resolveOriginChainId(originChain: number | null | undefined): number | null {
  if (originChain == null || !Number.isFinite(originChain)) return null;
  if (!isCommercialEip155Id(originChain)) return null;
  return originChain;
}
`;
    const dirtyReasons = custodyOriginPredicateUse(dirty);
    assert.ok(
      dirtyReasons.some((r) => r.includes("wrong predicate")),
      `expected planted red, got: ${dirtyReasons.join("; ") || "(none)"}`,
    );

    const live = readFileSync(`${POLICY_SCAN_ROOT}/${CHAIN_CONTEXT}`, "utf8");
    assert.deepEqual(
      custodyOriginPredicateUse(live),
      [],
      custodyOriginPredicateUse(live).join("\n"),
    );
  });
});
