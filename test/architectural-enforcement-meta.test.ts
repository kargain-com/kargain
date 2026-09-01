/**
 * Meta-enforcement: architectural policy/invariant/coverage/contract tests stay
 * reachable from a gate, and every choke-point names a guarding test that exists
 * and is reachable.
 *
 * Failures:
 * - New `*policy*` / `*invariant*` / `*coverage*` / `*contract*` test under
 *   `test/` not listed in any `test:*` script (Hardhat-native suites may use
 *   the `test` / hardhat runner instead).
 * - New entry in ARCHITECTURAL_CHOKEPOINTS without a guarding test file, or
 *   whose guard is unreachable from a gate.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ARCHITECTURAL_CHOKEPOINTS } from "@/lib/architecture/chokepoints";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR = path.join(ROOT, "test");
const PKG = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

const ENFORCEMENT_BASENAME_RE =
  /(policy|invariant|coverage|contract).*\.test\.ts$/;

function listEnforcementTests(): string[] {
  return fs
    .readdirSync(TEST_DIR)
    .filter((f) => ENFORCEMENT_BASENAME_RE.test(f))
    .sort();
}

/** Targeted `test:*` scripts plus bare `test` (Hardhat runner). */
function gateScripts(): Array<{ name: string; body: string }> {
  return Object.entries(PKG.scripts)
    .filter(([name]) => name === "test" || name.startsWith("test:"))
    .map(([name, body]) => ({ name, body: String(body) }));
}

function isHardhatNativeSuite(absPath: string): boolean {
  const text = fs.readFileSync(absPath, "utf8");
  return (
    /\bfrom\s+["']hardhat["']/.test(text) ||
    /\bimport\s+hardhat\b/.test(text) ||
    /@nomicfoundation\/hardhat/.test(text)
  );
}

/**
 * A suite is reachable when a targeted `test:*` script names its file, or
 * (Hardhat-native only) the bare `test` script is `hardhat test`.
 */
function reachableGates(basename: string): string[] {
  const abs = path.join(TEST_DIR, basename);
  const gates: string[] = [];
  for (const { name, body } of gateScripts()) {
    if (name === "test") {
      if (
        /hardhat\s+test/.test(body) &&
        fs.existsSync(abs) &&
        isHardhatNativeSuite(abs)
      ) {
        gates.push(name);
      }
      continue;
    }
    if (body.includes(basename)) gates.push(name);
  }
  return gates;
}

describe("architectural enforcement meta", () => {
  it("every policy/invariant/coverage/contract test is reachable from a gate", () => {
    const orphan: string[] = [];
    for (const basename of listEnforcementTests()) {
      if (reachableGates(basename).length === 0) orphan.push(basename);
    }
    assert.deepEqual(
      orphan,
      [],
      `Unreachable enforcement suites (add to a test:* gate, or mark Hardhat-native):\n${orphan.join("\n")}`,
    );
  });

  it("every choke-point names an existing reachable guarding test", () => {
    const problems: string[] = [];
    for (const cp of ARCHITECTURAL_CHOKEPOINTS) {
      if (cp.guardTests.length === 0) {
        problems.push(`${cp.id}: no guardTests`);
        continue;
      }
      for (const guard of cp.guardTests) {
        const abs = path.join(TEST_DIR, guard);
        if (!fs.existsSync(abs)) {
          problems.push(`${cp.id}: missing test/${guard}`);
          continue;
        }
        if (reachableGates(guard).length === 0) {
          problems.push(
            `${cp.id}: test/${guard} exists but is not reachable from any gate`,
          );
        }
      }
    }
    assert.deepEqual(
      problems,
      [],
      `Choke-point guard failures:\n${problems.join("\n")}`,
    );
  });

  it("choke-point ids are unique and do not mimic Truth-layer T# form", () => {
    const ids = ARCHITECTURAL_CHOKEPOINTS.map((c) => c.id);
    assert.equal(ids.length, new Set(ids).size);
    for (const id of ids) {
      assert.equal(
        /^T\d+$/i.test(id),
        false,
        `choke-point id "${id}" collides with Truth-layer T1–T6 naming form`,
      );
    }
  });

  it("reports enforcement tests not named as any choke-point guard (informational pin)", () => {
    const guarded = new Set(
      ARCHITECTURAL_CHOKEPOINTS.flatMap((c) => [...c.guardTests]),
    );
    const ungarded = listEnforcementTests().filter((f) => !guarded.has(f));
    // Pin the known non-choke-point enforcement suites so silence cannot grow.
    // These guard coverage / layer invariants that are not sole-module owners.
    const knownWithoutChokepoint = [
      "gate-membership-policy.test.ts",
      "messaging-contract.test.ts",
      "kargain.contracts.test.ts",
      "notification-state-coverage.test.ts",
      "profile-publish-coverage.test.ts",
      "server-action-home-concurrency-policy.test.ts",
    ].sort();
    assert.deepEqual(
      ungarded.sort(),
      knownWithoutChokepoint,
      `Unexpected ungarded enforcement tests (add a choke-point or extend the known pin):\n${ungarded.join("\n")}`,
    );
  });
});
