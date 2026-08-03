/**
 * RC-1 residual: module load must not sit inside BUILD_DEADLINE_MS.
 *
 * Instrumentation finding (harness):
 * - Pre-fix shape: loadXmtp inside buildLocal raced BUILD_DEADLINE_MS → timeout;
 *   late ok clients were not closed (orphan OPFS).
 * - Create after true opfs_lock already idles via lastError; mint path was
 *   build_failed + enableRequested (misclassified storage). Guard +
 *   classification close that hole; orphan close stops same-tab handle hold.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { BUILD_DEADLINE_MS } from "../lib/messaging/session-budgets.ts";
import type { BuildLocalResult, XmtpLocalClient } from "../lib/messaging/ports.ts";
import {
  advanceAndSettle,
  answeredIntent,
  createControlledClock,
  disposeAllOpenSessions,
  hangUntilAbort,
  openSession,
  settleAsync,
} from "./messaging-contract-harness.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

afterEach(async () => {
  await disposeAllOpenSessions();
});

function brandClient(id: number): XmtpLocalClient {
  return { __brand: "XmtpLocalClient", __id: id } as XmtpLocalClient;
}

describe("module load is not an operation", () => {
  it("slow ensureModule past BUILD_DEADLINE_MS then success — never timeout", async () => {
    const clock = createControlledClock();
    let ensureStarted = 0;
    let ensureFinished = 0;
    let resolveEnsure: (() => void) | null = null;

    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        ensureModule: async (signal) => {
          ensureStarted += 1;
          await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            resolveEnsure = () => {
              ensureFinished += 1;
              resolve();
            };
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        },
        buildLocal: async () => ({ ok: true, client: brandClient(1) }),
      },
    });

    await settleAsync(clock);
    let snap = session.getSnapshot();
    assert.equal(snap.state, "reconciling");
    if (snap.state === "reconciling") {
      assert.equal(snap.op, "sdk");
      assert.equal(snap.next, "cancel");
    }
    assert.equal(ensureStarted, 1);
    assert.equal(xmtp.calls.buildLocal, 0);

    await advanceAndSettle(clock, BUILD_DEADLINE_MS + 5_000);
    snap = session.getSnapshot();
    assert.equal(snap.state, "reconciling");
    if (snap.state === "reconciling") assert.equal(snap.op, "sdk");
    assert.equal(
      snap.state === "error" && snap.reason === "timeout",
      false,
      "module load must not produce timeout",
    );

    resolveEnsure?.();
    await settleAsync(clock);
    snap = session.getSnapshot();
    assert.equal(ensureFinished, 1);
    assert.ok(xmtp.calls.buildLocal >= 1);
    assert.equal(snap.state, "active");
  });

  it("post-ready hung build still times out at BUILD_DEADLINE_MS", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        buildLocal: async (_a, signal) => hangUntilAbort(signal),
      },
    });
    await advanceAndSettle(clock, BUILD_DEADLINE_MS);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "error");
    if (snap.state === "error") assert.equal(snap.reason, "timeout");
  });

  it("storage held → opfs_lock and zero create attempts across retries", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "opfs_lock" }),
      },
    });
    await settleAsync(clock);
    let snap = session.getSnapshot();
    assert.equal(snap.state, "error");
    if (snap.state === "error") {
      assert.equal(snap.reason, "opfs_lock");
      assert.equal(snap.next, "cancel");
    }
    assert.equal(xmtp.calls.createWithSigner, 0);

    session.dispatch({ type: "retry" });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 0);
    snap = session.getSnapshot();
    assert.equal(snap.state, "error");
    if (snap.state === "error") assert.equal(snap.reason, "opfs_lock");
  });

  it("not_registered + enable creates exactly once", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "not_registered" }),
      },
    });
    await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 0);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 1);
    assert.equal(session.getSnapshot().state, "active");
  });

  it("unknown throw is not timeout and carries cause", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        buildLocal: async () => {
          throw new Error("relay exploded");
        },
      },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "error");
    if (snap.state === "error") {
      assert.equal(snap.reason, "unknown");
      assert.equal(snap.cause, "relay exploded");
    }
  });

  it("late ok client after build timeout is closed", async () => {
    const clock = createControlledClock();
    let releaseBuild: ((result: BuildLocalResult) => void) | null = null;
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        buildLocal: async () =>
          new Promise<BuildLocalResult>((resolve) => {
            releaseBuild = resolve;
          }),
      },
    });
    await advanceAndSettle(clock, BUILD_DEADLINE_MS);
    assert.equal(session.getSnapshot().state, "error");
    const closesBefore = xmtp.calls.closeLocal;
    releaseBuild?.({ ok: true, client: brandClient(99) });
    await settleAsync(clock);
    assert.ok(xmtp.calls.closeLocal > closesBefore);
    assert.equal(xmtp.liveCount, 0);
  });
});

describe("sdk load policy", () => {
  /**
   * Invariant (enforced in two parts):
   *
   * 1. Same-body: no function that arms a wall-clock abort timer
   *    (`setTimeout` → `.abort`) may call `loadXmtp` or `ensureModuleLoaded`.
   * 2. Owner: `loadXmtp(` appears only in its definition, `preloadXmtp`, and
   *    `ensureModuleLoaded` — timed paths cannot reach the dynamic import via
   *    probe / openDm / messagingBackend indirection.
   * 3. Session deadline: `runWithDeadline` wraps build only, never sdk
   *    (dedicated assertion — outer interpreter body is too large for (1)).
   *
   * Limits: (1) does not prove cross-file A-under-timer → B → ensureModuleLoaded
   * when B is a separate function; (2) closes that hole for the dynamic import.
   * `runWithDeadline` wrapping a callback that indirectly loads is covered by (3)
   * for the known session path, not by a general transitive graph.
   */
  function extractTopLevelBodies(source: string): Array<{ name: string; body: string }> {
    const out: Array<{ name: string; body: string }> = [];
    const startRe =
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{|(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = startRe.exec(source)) !== null) {
      const name = match[1] ?? match[2] ?? "anonymous";
      if (name === "if" || name === "for" || name === "while" || name === "switch") continue;
      const openIdx = match.index + match[0].length - 1;
      let depth = 0;
      let i = openIdx;
      for (; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            break;
          }
        }
      }
      out.push({ name, body: source.slice(openIdx, i) });
    }
    return out;
  }

  function armsWallClockAbort(body: string): boolean {
    return (
      /setTimeout\s*\(\s*\(\)\s*=>\s*[\w.]+\.abort\b/.test(body) ||
      /setTimeout\s*\(\s*\(\)\s*=>\s*\{\s*[\w.]+\.abort\b/.test(body)
    );
  }

  function reachesModuleLoader(body: string): boolean {
    return /\bloadXmtp\s*\(/.test(body) || /\bensureModuleLoaded\s*\(/.test(body);
  }

  function wallClockLoaderViolations(source: string): string[] {
    return extractTopLevelBodies(source)
      .filter(({ body }) => armsWallClockAbort(body) && reachesModuleLoader(body))
      .map(({ name }) => name);
  }

  it("loadXmtp is only reached from preloadXmtp and ensureModuleLoaded", () => {
    const text = fs.readFileSync(
      path.join(ROOT, "lib/messaging/adapters/xmtp-adapter.ts"),
      "utf8",
    );
    const calls = [...text.matchAll(/\bloadXmtp\s*\(/g)];
    assert.equal(calls.length, 3, `expected 3 loadXmtp( sites, found ${calls.length}`);
    assert.ok(/export function preloadXmtp[\s\S]{0,80}return loadXmtp\(\)/.test(text));
    assert.ok(/async function ensureModuleLoaded[\s\S]{0,200}loadXmtp\(\)/.test(text));
  });

  it("no wall-clock abort timer body reaches the module loader", () => {
    const messagingRoot = path.join(ROOT, "lib/messaging");
    const files: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
      }
    }
    walk(messagingRoot);

    const found: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const name of wallClockLoaderViolations(text)) {
        found.push(`${path.relative(ROOT, file)}:${name}`);
      }
    }
    assert.deepEqual(found, []);
  });

  it("catches a constructed deadline-around-loader violation", () => {
    const violation = `
export async function checkXmtpReachable(address) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await loadXmtp();
  } finally {
    clearTimeout(timeout);
  }
}
`;
    assert.deepEqual(wallClockLoaderViolations(violation), ["checkXmtpReachable"]);

    const clean = `
export async function checkXmtpReachable(address) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await probePeerRegistration(address, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
`;
    assert.deepEqual(wallClockLoaderViolations(clean), []);
  });

  it("effects runWithDeadline only wraps build, not sdk", () => {
    const text = fs.readFileSync(path.join(ROOT, "lib/messaging/effects.ts"), "utf8");
    assert.ok(text.includes('case "sdk"'));
    assert.ok(text.includes("ensureModule"));
    assert.equal(/case "sdk":[\s\S]{0,400}runWithDeadline/.test(text), false);
    assert.ok(/case "build":[\s\S]{0,200}runWithDeadline/.test(text));
  });

  it("shouldCreate refuses opfs_lock", () => {
    const text = fs.readFileSync(path.join(ROOT, "lib/messaging/reconcile.ts"), "utf8");
    assert.ok(text.includes('localBuildReason === "opfs_lock"'));
    assert.ok(text.includes('lastError === "opfs_lock"'));
  });
});
