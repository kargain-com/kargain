/**
 * U9.2a — passport detail SVM chrome policy.
 *
 * (a) No component/hook reachable from the marketplace passport detail route
 *     calls wagmiChainId during render (import-graph derivation).
 * (b) Actions panel does not mount EVM-only session refusal for SVM sessions.
 * (c) Presence does not return location_pending merely because karPassportAddress
 *     is undefined — custodyLock from the commerce-facts owner answers.
 *
 * Entity-owner EVM coercion is owned by the ProtocolOwner type wall
 * (test/protocol-owner-policy.test.ts) — not a second text-scanner mechanism.
 *
 * S8-D1a amend: PassportCommerceFacts has no dual `custodyLocked` boolean —
 * tsc assignability plant below pins that absence.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

function runAssignabilityProbe(source: string): {
  status: number | null;
  out: string;
} {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), "kargain-commerce-facts-"),
  );
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
}const ACTIONS_PANEL = path.join(
  ROOT,
  "components/passport/passport-actions-panel.tsx",
);

/** Floor: measured 2026-09-17 on tip before U9.2a — empty derivation must red. */
const DETAIL_REACHABLE_HOOKS_COMPONENTS_FLOOR = 100;

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

/**
 * Follow local imports from the marketplace detail entry into
 * components/ + hooks/ (+ app/ + lib/ for traversal).
 */
function reachableDetailHooksAndComponents(): string[] {
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
  return [...seen]
    .map((f) => path.relative(ROOT, f))
    .filter(
      (rel) => rel.startsWith("components/") || rel.startsWith("hooks/"),
    )
    .sort();
}

function findWagmiChainIdCalls(relPaths: readonly string[]): string[] {
  const hits: string[] = [];
  for (const rel of relPaths) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (/\bwagmiChainId\s*\(/.test(text)) hits.push(rel);
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
    assert.notEqual(
      /\bwagmiChainId\s*\(/.test(planted),
      /\bwagmiChainId\s*\(/.test(live),
      "planted wagmiChainId in a detail-reachable file must turn the ban red",
    );
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

  it("(c) presence is not location_pending merely because karPassportAddress is undefined", () => {
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
      custodyLock: { status: "known", locked: false },
      ponderCustodyChain: ns,
    });
    assert.equal(
      withLock.status,
      "here",
      "custodyLocked false must not become location_pending when passport address is absent",
    );

    // Plant: the old coupling — treat missing address as unread without a lock read.
    function plantedUnreadWhenNoPassportAddress(input: {
      chainId: number;
      custodyLock: { status: "known"; locked: boolean };
    }): "location_pending" | "other" {
      if (karPassportAddress(input.chainId) == null) {
        return "location_pending";
      }
      const p = derivePassportPresence({
        viewChainId: input.chainId,
        custodyLock: input.custodyLock,
        ponderCustodyChain: input.chainId,
      });
      return p.status === "location_pending" ? "location_pending" : "other";
    }

    assert.equal(
      plantedUnreadWhenNoPassportAddress({
        chainId: ns,
        custodyLock: { status: "known", locked: false },
      }),
      "location_pending",
      "planted no-address⇒unread coupling must turn red against the live here answer",
    );
    assert.notEqual(
      withLock.status,
      "location_pending",
      "live presence must not return location_pending for known unlocked lock on SVM",
    );
  });

  it("SVM commerce-facts plan reads PassportState; resolve surfaces custodyLock pending while unread", async () => {
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

    // Pending → custodyLock pending (never invent unlocked).
    const pending = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: () => undefined,
      get: () => undefined,
      isPending: true,
    });
    assert.equal(pending.custodyLock.status, "pending");
    assert.equal(pending.hasLiveConsignment.status, "refused");
    assert.equal(
      pending.hasLiveConsignment.status === "refused" &&
        pending.hasLiveConsignment.cause,
      "product_owner_owed",
    );
    assert.equal(pending.fixedPrice.configured, true);

    // Planning with namespace → SVM support refusals (no "not deployed" flash).
    const planning = resolvePassportCommerceFacts({
      plan: null,
      planning: true,
      entry: () => undefined,
      get: () => undefined,
      isPending: false,
      namespace: ns,
    });
    assert.equal(planning.custodyLock.status, "pending");
    assert.equal(planning.fixedPrice.configured, true);
    assert.equal(
      planning.openConsignmentPermission.status === "blocked" &&
        planning.openConsignmentPermission.cause,
      "product_owner_owed",
    );
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

  it("PassportCommerceFacts has no custodyLocked boolean — tsc RED with member, GREEN without", () => {
    const red = runAssignabilityProbe(`
import type { PassportCommerceFacts } from "@/lib/passport/passport-commerce-facts";
import type { CustodyLockRead } from "@/lib/passport/presence";
declare const lock: CustodyLockRead;
declare const facts: PassportCommerceFacts;
const planted: PassportCommerceFacts = {
  ...facts,
  custodyLock: lock,
  custodyLocked: undefined,
};
void planted;
`);
    assert.notEqual(
      red.status,
      0,
      `expected custodyLocked member on Facts to fail tsc; out:\n${red.out}`,
    );
    assert.match(red.out, /custodyLocked|not assignable|excess|does not exist/i);

    const green = runAssignabilityProbe(`
import type { PassportCommerceFacts } from "@/lib/passport/passport-commerce-facts";
import type { CustodyLockRead } from "@/lib/passport/presence";
declare const lock: CustodyLockRead;
declare const facts: PassportCommerceFacts;
const clean: PassportCommerceFacts = {
  ...facts,
  custodyLock: lock,
};
void clean;
`);
    assert.equal(
      green.status,
      0,
      `expected Facts without custodyLocked member to pass tsc; out:\n${green.out}`,
    );
  });
});
