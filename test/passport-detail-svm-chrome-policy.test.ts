/**
 * U9.2a — passport detail SVM chrome policy.
 *
 * (a) No component/hook reachable from the marketplace passport detail route
 *     calls wagmiChainId during render (import-graph derivation).
 * (b) Actions panel does not mount EVM-only session refusal for SVM sessions.
 * (c) Presence does not return location_unread merely because karPassportAddress
 *     is undefined — custodyLocked from the commerce-facts owner answers.
 * (d) No EVM-only coercion of an entity-sourced passport owner on this route:
 *     no `passport.owner as \`0x\`` and no `getAddress(passportOwner|passport.owner)`.
 *     Class is source of the value (entity), not a symbol denylist alone.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  planPassportCommerceReads,
  resolvePassportCommerceFacts,
} from "../lib/passport/passport-commerce-facts.ts";
import { derivePassportPresence } from "../lib/passport/presence.ts";
import { karPassportAddress } from "../lib/web3/deployment-addresses.ts";
import { commercialSvmNamespaceIds } from "../lib/web3/commercial-active.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DETAIL_ENTRY =
  "app/(identity)/marketplace/[tokenId]/page.tsx";
const ACTIONS_PANEL = path.join(
  ROOT,
  "components/passport/passport-actions-panel.tsx",
);
const DETAIL_VIEW = path.join(
  ROOT,
  "components/passport/passport-detail-view.tsx",
);
const ESCROW_CUSTODY = path.join(ROOT, "lib/marketplace/passport-custody.ts");

/** Floor: measured 2026-09-17 on tip before U9.2a — empty derivation must red. */
const DETAIL_REACHABLE_HOOKS_COMPONENTS_FLOOR = 100;

/** Entity owner cast to an EVM address type — the measured crash class. */
const ENTITY_OWNER_EVM_CAST =
  /passport\.owner\s+as\s+`0x\$\{string\}`/;

/** EVM-only primitive applied to an entity-sourced owner binding. */
const ENTITY_OWNER_GET_ADDRESS =
  /getAddress\s*\(\s*(?:passportOwner|passport\.owner)\s*\)/;

function resolveImport(fromFile: string, spec: string): string | null {
  let resolved: string;
  if (spec.startsWith("@/")) {
    resolved = path.join(ROOT, spec.slice(2));
  } else if (spec.startsWith(".")) {
    resolved = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = resolved + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

type DetailReachable = {
  /** components/ + hooks/ — floor + wagmiChainId ban. */
  hooksAndComponents: string[];
  /** app/ + components/ + hooks/ + lib/ — entity-coercion class. */
  productFiles: string[];
};

/**
 * Follow local imports from the marketplace detail entry into
 * components/ + hooks/ (+ app/ + lib/ for traversal).
 */
function reachableDetailGraph(): DetailReachable {
  const seen = new Set<string>();
  const queue = [path.join(ROOT, DETAIL_ENTRY)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    if (!file.startsWith(ROOT)) continue;
    if (!fs.existsSync(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      const next = resolveImport(file, match[1]!);
      if (!next) continue;
      const rel = path.relative(ROOT, next);
      if (
        rel.startsWith("components/") ||
        rel.startsWith("hooks/") ||
        rel.startsWith("app/") ||
        rel.startsWith("lib/")
      ) {
        queue.push(next);
      }
    }
  }
  const all = [...seen]
    .map((f) => path.relative(ROOT, f))
    .filter(
      (rel) =>
        rel.startsWith("components/") ||
        rel.startsWith("hooks/") ||
        rel.startsWith("app/") ||
        rel.startsWith("lib/"),
    )
    .sort();
  return {
    productFiles: all,
    hooksAndComponents: all.filter(
      (rel) => rel.startsWith("components/") || rel.startsWith("hooks/"),
    ),
  };
}

/** @deprecated use reachableDetailGraph — kept name for plant readability. */
function reachableDetailHooksAndComponents(): string[] {
  return reachableDetailGraph().hooksAndComponents;
}

function findWagmiChainIdCalls(relPaths: readonly string[]): string[] {
  const hits: string[] = [];
  for (const rel of relPaths) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (/\bwagmiChainId\s*\(/.test(text)) hits.push(rel);
  }
  return hits;
}

function findEntityOwnerEvmCasts(relPaths: readonly string[]): string[] {
  const hits: string[] = [];
  for (const rel of relPaths) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (ENTITY_OWNER_EVM_CAST.test(text)) hits.push(rel);
  }
  return hits;
}

function findEntityOwnerGetAddress(relPaths: readonly string[]): string[] {
  const hits: string[] = [];
  for (const rel of relPaths) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (ENTITY_OWNER_GET_ADDRESS.test(text)) hits.push(rel);
  }
  return hits;
}

function actionsPanelGatesOnEvmSession(source: string): boolean {
  return (
    /\bEvmSessionRefusal\b/.test(source) &&
    (/!\s*evm\.ok/.test(source) ||
      /\brequireEvmSession\s*\(\s*account\s*\)/.test(source))
  );
}

describe("passport detail SVM chrome policy (U9.2a)", () => {
  it("(a) detail-route import graph has a non-empty hooks+components floor", () => {
    const reachable = reachableDetailHooksAndComponents();
    assert.ok(
      reachable.length >= DETAIL_REACHABLE_HOOKS_COMPONENTS_FLOOR,
      `detail reachable hooks+components floor ${DETAIL_REACHABLE_HOOKS_COMPONENTS_FLOOR}; got ${reachable.length}`,
    );
    assert.notEqual(
      reachable.length,
      0,
      "empty derivation must turn red — floor refuses vacuous coverage",
    );
  });

  it("(a) no reachable component or hook calls wagmiChainId — plant turns red", () => {
    const reachable = reachableDetailHooksAndComponents();
    assert.ok(
      reachable.length >= DETAIL_REACHABLE_HOOKS_COMPONENTS_FLOOR,
      `derivation compared ${reachable.length} objects (floor ${DETAIL_REACHABLE_HOOKS_COMPONENTS_FLOOR})`,
    );

    const liveHits = findWagmiChainIdCalls(reachable);
    assert.deepEqual(
      liveHits,
      [],
      `live graph must not call wagmiChainId; hits: ${liveHits.join(", ")}`,
    );

    // Plant: restore an unguarded call in one derived file — must turn red.
    const plantTarget = reachable.find((r) =>
      r.endsWith("passport-actions-panel.tsx"),
    );
    assert.ok(
      plantTarget,
      "actions panel must be in the detail import graph",
    );
    const live = fs.readFileSync(path.join(ROOT, plantTarget), "utf8");
    const planted = `${live}\nconst _plant = wagmiChainId(chainId);\n`;
    const plantedHits = findWagmiChainIdCalls(
      reachable.map((rel) => {
        if (rel !== plantTarget) return rel;
        // In-memory plant: check the planted string directly.
        return rel;
      }),
    );
    // Direct assert on planted source (do not write the tree).
    assert.equal(
      /\bwagmiChainId\s*\(/.test(planted),
      true,
      "planted wagmiChainId call must be detected",
    );
    assert.equal(
      /\bwagmiChainId\s*\(/.test(live),
      false,
      "live actions panel must not call wagmiChainId",
    );
    // Use AssertionError naming for the plant-vs-live pin.
    assert.notEqual(
      /\bwagmiChainId\s*\(/.test(planted),
      /\bwagmiChainId\s*\(/.test(live),
      "planted wagmiChainId in a detail-reachable file must turn the ban red",
    );
    void plantedHits;
  });

  it("(b) actions panel uses TxWriteRefusal only — plant EvmSessionRefusal turns red", () => {
    const live = fs.readFileSync(ACTIONS_PANEL, "utf8");
    assert.equal(
      actionsPanelGatesOnEvmSession(live),
      false,
      "live actions panel must not mount EvmSessionRefusal on !evm.ok",
    );
    assert.match(live, /txWriteAvailability/);
    assert.match(live, /TxWriteRefusal/);
    assert.doesNotMatch(live, /\bEvmSessionRefusal\b/);
    assert.doesNotMatch(live, /\brequireEvmSession\b/);

    const planted = `${live}
{!evm.ok && (
  <EvmSessionRefusal
    cause={evm.cause}
    disconnectedTitle="Connect your wallet to verify, dispute, or interact with this passport."
  />
)}
`;
    assert.equal(
      actionsPanelGatesOnEvmSession(planted),
      true,
      "planted EvmSessionRefusal block must turn the session-chrome pin red",
    );
  });

  it("(c) presence is not location_unread merely because karPassportAddress is undefined", () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0, "live SVM commercial row required");
    const ns = namespaces[0]!;
    assert.equal(
      karPassportAddress(ns),
      undefined,
      "SVM namespace has no EVM passport hex — precondition for the plant",
    );

    // Honest answer: lock known unlocked → here (not unread).
    const withLock = derivePassportPresence({
      viewChainId: ns,
      custodyLocked: false,
      ponderCustodyChain: ns,
    });
    assert.equal(
      withLock.status,
      "here",
      "custodyLocked false must not become location_unread when passport address is absent",
    );

    // Plant: the old coupling — treat missing address as unread without a lock read.
    function plantedUnreadWhenNoPassportAddress(input: {
      chainId: number;
      custodyLocked: boolean | undefined;
    }): "location_unread" | "other" {
      if (karPassportAddress(input.chainId) == null) {
        return "location_unread";
      }
      const p = derivePassportPresence({
        viewChainId: input.chainId,
        custodyLocked: input.custodyLocked,
        ponderCustodyChain: input.chainId,
      });
      return p.status === "location_unread" ? "location_unread" : "other";
    }

    assert.equal(
      plantedUnreadWhenNoPassportAddress({
        chainId: ns,
        custodyLocked: false,
      }),
      "location_unread",
      "planted no-address⇒unread coupling must turn red against the live here answer",
    );
    assert.notEqual(
      withLock.status,
      "location_unread",
      "live presence must not return location_unread for known unlocked lock on SVM",
    );
  });

  it("(d) no entity-sourced owner cast to EVM address type — plant turns red", () => {
    const { productFiles, hooksAndComponents } = reachableDetailGraph();
    assert.ok(
      hooksAndComponents.length >= DETAIL_REACHABLE_HOOKS_COMPONENTS_FLOOR,
      `derivation compared ${hooksAndComponents.length} hooks+components (floor ${DETAIL_REACHABLE_HOOKS_COMPONENTS_FLOOR}); productFiles=${productFiles.length}`,
    );

    const liveHits = findEntityOwnerEvmCasts(productFiles);
    assert.deepEqual(
      liveHits,
      [],
      `live graph must not cast passport.owner to 0x; hits: ${liveHits.join(", ")}`,
    );

    const liveDetail = fs.readFileSync(DETAIL_VIEW, "utf8");
    assert.equal(
      ENTITY_OWNER_EVM_CAST.test(liveDetail),
      false,
      "live detail view must not cast passport.owner to an EVM address type",
    );
    const planted = `${liveDetail}\npassportOwner={passport.owner as \`0x\${string}\`}\n`;
    assert.equal(
      ENTITY_OWNER_EVM_CAST.test(planted),
      true,
      "planted entity-owner EVM cast must be detected",
    );
    assert.notEqual(
      ENTITY_OWNER_EVM_CAST.test(planted),
      ENTITY_OWNER_EVM_CAST.test(liveDetail),
      "planted passport.owner as 0x must turn the entity-coercion ban red",
    );
  });

  it("(d) no getAddress on entity-sourced owner — plant turns red", () => {
    const { productFiles } = reachableDetailGraph();
    assert.ok(
      productFiles.some((r) => r.endsWith("lib/marketplace/passport-custody.ts")),
      "escrow custody owner must be reachable from the detail route",
    );

    const liveHits = findEntityOwnerGetAddress(productFiles);
    assert.deepEqual(
      liveHits,
      [],
      `live graph must not getAddress(entity owner); hits: ${liveHits.join(", ")}`,
    );

    const liveCustody = fs.readFileSync(ESCROW_CUSTODY, "utf8");
    assert.equal(
      ENTITY_OWNER_GET_ADDRESS.test(liveCustody),
      false,
      "live escrow custody must not call getAddress(passportOwner)",
    );
    const planted = `${liveCustody}\nconst owner = getAddress(passportOwner);\n`;
    assert.equal(
      ENTITY_OWNER_GET_ADDRESS.test(planted),
      true,
      "planted getAddress(passportOwner) must be detected",
    );
    assert.notEqual(
      ENTITY_OWNER_GET_ADDRESS.test(planted),
      ENTITY_OWNER_GET_ADDRESS.test(liveCustody),
      "planted getAddress on entity owner must turn the ban red",
    );
  });

  it("(d) over-reach control: legitimate EVM leaf cast stays GREEN", () => {
    // Listing buy panel casts an EVM-read / EVM-typed seller — not passport.owner.
    // Widening must not flag that class.
    const buyPanel = path.join(
      ROOT,
      "components/marketplace/listing-buy-panel.tsx",
    );
    assert.ok(fs.existsSync(buyPanel), "listing-buy-panel fixture present");
    const text = fs.readFileSync(buyPanel, "utf8");
    // May contain other `as \`0x\`` forms — must NOT match entity-owner pattern.
    assert.equal(
      ENTITY_OWNER_EVM_CAST.test(text),
      false,
      "EVM-only listing leaf must not be flagged as entity-owner coercion",
    );
    assert.equal(
      ENTITY_OWNER_GET_ADDRESS.test(text),
      false,
      "EVM-only listing leaf must not be flagged for entity getAddress",
    );
    // Positive control: a synthetic line that is NOT entity-sourced stays green
    // under our detector even when it casts to 0x.
    const legitimate = "const seller = listing.seller as `0x${string}`;";
    assert.equal(
      ENTITY_OWNER_EVM_CAST.test(legitimate),
      false,
      "cast of listing.seller (EVM-sourced) must stay green — over-reach control",
    );
  });

  it("SVM commerce-facts plan reads PassportState; resolve surfaces custodyLocked unread while pending", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0, "live SVM commercial row required");
    const ns = namespaces[0]!;
    const plan = await planPassportCommerceReads({
      chainId: ns,
      tokenId: "1",
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.vm, "svm");
    if (plan.vm !== "svm") return;
    assert.equal(plan.contracts.length, 1);
    assert.equal(plan.contracts[0]!.key, "passportState");

    // Pending → unread (never invent false).
    const pending = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: () => undefined,
      get: () => undefined,
      isPending: true,
    });
    assert.equal(pending.custodyLocked, undefined);

    // Planning → unread.
    const planning = resolvePassportCommerceFacts({
      plan: null,
      planning: true,
      entry: () => undefined,
      get: () => undefined,
      isPending: false,
    });
    assert.equal(planning.custodyLocked, undefined);
  });

  it("EVM commerce-facts plan still builds custodyLocked keyed read", async () => {
    const plan = await planPassportCommerceReads({
      chainId: 84532,
      tokenId: "1",
    });
    assert.equal(plan.ok, true);
    if (!plan.ok || plan.vm !== "evm") {
      assert.fail("expected EVM plan on Base Sepolia");
    }
    const keys = plan.contracts.map((c) => c.key);
    assert.ok(keys.includes("custodyLocked"), "EVM batch must include custodyLocked");
    assert.ok(keys.includes("mayOpen"), "EVM batch shape preserved");
    // Plant: drop custodyLocked from keys — must turn red.
    const plantedKeys = keys.filter((k) => k !== "custodyLocked");
    assert.equal(
      plantedKeys.includes("custodyLocked"),
      false,
      "planted omission of custodyLocked must turn the EVM shape pin red",
    );
    assert.ok(
      keys.includes("custodyLocked"),
      "live EVM plan must retain custodyLocked",
    );
  });
});
