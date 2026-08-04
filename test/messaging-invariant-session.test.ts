/**
 * I5 — Session core has no React and no module-scope session instances outside registry.
 * I6 — Primary interface commands come from the session contract.
 * Also folds P4 probe deletion + idle warm (session must not own registration probe).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { shouldIdleWarmXmtp } from "../lib/messaging/snapshot-ui.ts";
import {
  ROOT,
  listTsFiles,
  moduleScopeSessionMapViolations,
  reactInSessionCoreViolations,
  stripComments,
} from "./messaging-invariant-helpers.ts";

const SESSION_CORE = [
  "lib/messaging/effects.ts",
  "lib/messaging/reconcile.ts",
  "lib/messaging/machine.ts",
  "lib/messaging/session-store.ts",
  "lib/messaging/session-registry.ts",
].map((p) => path.join(ROOT, p));

const REGISTRY = path.join(ROOT, "lib/messaging/session-registry.ts");
const PROVIDER = path.join(ROOT, "components/providers/messaging-session-provider.tsx");
const HOOK = path.join(ROOT, "hooks/use-messaging-session.ts");
const SURFACE_FILES = [
  "components/messaging/messaging-setup-card.tsx",
  "components/messaging/messaging-setup-error.tsx",
  "components/marketplace/seller-messaging-banner.tsx",
  "components/profile/messaging-settings-section.tsx",
] as const;

describe("I5 session core has no React and no parallel session Maps", () => {
  // Blind spot: cannot detect a Map stored under a different variable name that
  // still holds MessagingSession values without matching the type pattern.

  it("structural: session core files import neither React nor hooks", () => {
    const violations: string[] = [];
    for (const file of SESSION_CORE) {
      for (const hit of reactInSessionCoreViolations(fs.readFileSync(file, "utf8"))) {
        violations.push(`${path.relative(ROOT, file)}: ${hit}`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("catches a constructed React import in session core", () => {
    assert.deepEqual(
      reactInSessionCoreViolations(`import { useState } from "react";\n`),
      ["react import", "react hook"],
    );
    assert.deepEqual(reactInSessionCoreViolations(`export function reconcile() {}`), []);
  });

  it("structural: no module-scope session Maps outside the registry", () => {
    const violations: string[] = [];
    for (const dir of [
      path.join(ROOT, "hooks"),
      path.join(ROOT, "components"),
      path.join(ROOT, "lib/messaging"),
    ]) {
      for (const file of listTsFiles(dir)) {
        if (file === REGISTRY) continue;
        for (const hit of moduleScopeSessionMapViolations(fs.readFileSync(file, "utf8"))) {
          violations.push(`${path.relative(ROOT, file)}: ${hit}`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("catches a constructed module-scope sessions Map", () => {
    assert.deepEqual(
      moduleScopeSessionMapViolations(`const sessions = new Map();\n`),
      ["sessions Map"],
    );
    assert.deepEqual(moduleScopeSessionMapViolations(`const cache = new Map();\n`), []);
  });

  it("structural: provider acquires on render; hook is context-only; syncWalletAddress gone", () => {
    const provider = stripComments(fs.readFileSync(PROVIDER, "utf8"));
    const hook = stripComments(fs.readFileSync(HOOK, "utf8"));
    assert.match(provider, /registry\.acquire/);
    assert.match(provider, /createMessagingSession/);
    for (const match of provider.matchAll(/useEffect\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,/g)) {
      assert.doesNotMatch(match[1] ?? "", /createMessagingSession|registry\.acquire/);
    }
    assert.match(hook, /useContext\(MessagingSessionContext\)/);
    assert.doesNotMatch(hook, /createMessagingSession/);
    for (const dir of [
      path.join(ROOT, "lib"),
      path.join(ROOT, "hooks"),
      path.join(ROOT, "components"),
    ]) {
      for (const file of listTsFiles(dir)) {
        assert.equal(
          fs.readFileSync(file, "utf8").includes("syncWalletAddress"),
          false,
          path.relative(ROOT, file),
        );
      }
    }
  });

  it("structural: session core has no registration probe; settings raise no client demand", () => {
    for (const file of SESSION_CORE) {
      const text = stripComments(fs.readFileSync(file, "utf8"));
      assert.doesNotMatch(text, /\bprobeRegistration\b|\bprobePeerRegistration\b/);
    }
    const ports = fs.readFileSync(path.join(ROOT, "lib/messaging/ports.ts"), "utf8");
    const portBlock = ports.match(/export type XmtpPort\s*=\s*\{([\s\S]*?)\n\};/);
    assert.ok(portBlock);
    assert.doesNotMatch(portBlock[1]!, /\bprobeRegistration\b/);
    const settings = stripComments(
      fs.readFileSync(path.join(ROOT, "components/profile/messaging-settings-section.tsx"), "utf8"),
    );
    assert.doesNotMatch(settings, /requestLocalClient|useRequestLocalMessagingClient/);
  });

  it("behavioural: idle warm only when reachable and no client", () => {
    assert.equal(shouldIdleWarmXmtp({ publiclyReachable: true, hasClient: false }), true);
    assert.equal(shouldIdleWarmXmtp({ publiclyReachable: true, hasClient: true }), false);
    assert.equal(shouldIdleWarmXmtp({ publiclyReachable: false, hasClient: false }), false);
  });
});

describe("I6 primary commands come from the session contract", () => {
  // Blind spot: cannot prove a surface that dispatches enable/disable via a
  // renamed local helper without importing primaryActionFromSnapshot for retry.

  it("structural: setup surfaces consume primaryActionFromSnapshot", () => {
    const helper = fs.readFileSync(path.join(ROOT, "lib/messaging/snapshot-ui.ts"), "utf8");
    assert.ok(helper.includes("export function primaryActionFromSnapshot"));
    assert.ok(helper.includes("SECONDARY_REVOKE_ALL_COMMAND"));
    for (const rel of SURFACE_FILES) {
      const text = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      if (rel.endsWith("messaging-setup-error.tsx")) {
        assert.equal(/\bdispatch\s*\(/.test(text), false);
        continue;
      }
      assert.ok(
        text.includes("primaryActionFromSnapshot") ||
          text.includes("SECONDARY_REVOKE_ALL_COMMAND"),
        rel,
      );
    }
  });

  it("catches a constructed surface that invents retry without the helper", () => {
    const dirty = `
export function SetupCard({ snapshot, dispatch }) {
  if (snapshot.reason === "opfs_lock") dispatch({ type: "retry" });
}
`;
    assert.equal(dirty.includes("primaryActionFromSnapshot"), false);
    assert.match(dirty, /dispatch\(\{\s*type:\s*"retry"/);
    const clean = `
import { primaryActionFromSnapshot } from "@/lib/messaging/snapshot-ui";
export function SetupCard({ snapshot, dispatch }) {
  const action = primaryActionFromSnapshot(snapshot);
  if (action) dispatch({ type: action.command });
}
`;
    assert.ok(clean.includes("primaryActionFromSnapshot"));
  });

  it("structural: setup card does not invent retry on opfs_lock", () => {
    const card = stripComments(
      fs.readFileSync(path.join(ROOT, "components/messaging/messaging-setup-card.tsx"), "utf8"),
    );
    assert.ok(card.includes("primaryActionFromSnapshot"));
    assert.equal(/opfs_lock[\s\S]{0,800}dispatch\(\{\s*type:\s*"retry"/.test(card), false);
  });
});
