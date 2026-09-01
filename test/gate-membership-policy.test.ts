/**
 * Gate map: each test file belongs to exactly one targeted test:* group.
 * Opt-in gates (test:vincent:live) and Hardhat `test` are outside this invariant.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

/** Mirrors WORKING-METHOD §8 gate map rows (targeted ship gates). */
export const TARGETED_GATE_SCRIPTS = [
  "test:verify",
  "test:commerce-ui",
  "test:bridge",
  "test:svm",
  "test:svm-stand",
  "test:passport-ui",
  "test:verifier",
  "test:ponder",
  "test:svm-ingest",
  "test:listing",
  "test:metadata",
  "test:trust",
  "test:records",
  "test:confirm-status",
  "test:geo",
  "test:nostr",
  "test:messaging",
  "test:notifications",
  "test:vincent-commons",
  "test:vin-insight",
  "test:vin-assist",
  "test:vincent",
  "test:e2e",
] as const;

/** Same file may appear in a targeted gate plus this opt-in gate. */
const OPT_IN_GATE_SCRIPTS = ["test:vincent:live"] as const;

const TEST_FILE_RE = /test\/[^\s]+\.test\.ts/g;

function parseTestFiles(scriptBody: string): string[] {
  const matches = scriptBody.match(TEST_FILE_RE);
  return matches ?? [];
}

export type GateMembership = Map<string, Set<string>>;

export function buildGateMembership(
  scripts: Record<string, string>,
  gateNames: readonly string[],
): GateMembership {
  const membership: GateMembership = new Map();
  for (const gate of gateNames) {
    const body = scripts[gate];
    if (body == null) continue;
    for (const file of parseTestFiles(body)) {
      if (!membership.has(file)) membership.set(file, new Set());
      membership.get(file)!.add(gate);
    }
  }
  return membership;
}

export function findDualTargetedMembership(
  membership: GateMembership,
): Array<{ file: string; gates: string[] }> {
  const dual: Array<{ file: string; gates: string[] }> = [];
  for (const [file, gates] of membership) {
    if (gates.size >= 2) {
      dual.push({ file, gates: [...gates].sort() });
    }
  }
  return dual.sort((a, b) => a.file.localeCompare(b.file));
}

describe("gate membership policy", () => {
  it("no test file belongs to two targeted groups", () => {
    const membership = buildGateMembership(PKG.scripts, TARGETED_GATE_SCRIPTS);
    const dual = findDualTargetedMembership(membership);
    assert.deepEqual(
      dual,
      [],
      dual.length
        ? `Dual targeted membership (one owner per file):\n${dual
            .map((d) => `${d.file} → ${d.gates.join(" + ")}`)
            .join("\n")}`
        : undefined,
    );
  });

  it("opt-in test:vincent:live may share vincent-integration with test:vincent", () => {
    const targeted = buildGateMembership(PKG.scripts, ["test:vincent"]);
    const liveBody = PKG.scripts["test:vincent:live"];
    assert.ok(liveBody);
    const liveFiles = parseTestFiles(liveBody);
    assert.deepEqual(liveFiles, ["test/vincent-integration.test.ts"]);
    const targetedGates = targeted.get("test/vincent-integration.test.ts");
    assert.ok(targetedGates?.has("test:vincent"));
  });

  it("constructed violation: dual membership is detected", () => {
    const membership: GateMembership = new Map([
      ["test/example.test.ts", new Set(["test:ponder", "test:verify"])],
    ]);
    const dual = findDualTargetedMembership(membership);
    assert.equal(dual.length, 1);
    assert.equal(dual[0]?.file, "test/example.test.ts");
    assert.deepEqual(dual[0]?.gates, ["test:ponder", "test:verify"]);
  });

  it("constructed control: single membership passes", () => {
    const membership: GateMembership = new Map([
      ["test/example.test.ts", new Set(["test:ponder"])],
    ]);
    assert.deepEqual(findDualTargetedMembership(membership), []);
  });
});
