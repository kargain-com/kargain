/**
 * Scratch reachability — lab scripts reachable; package.json script targets exist.
 * Plants are in-memory only (no live-tree mutation).
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { POLICY_SCAN_ROOT } from "./policy-scan-helpers.ts";
import {
  extractScriptFileTargets,
  findMissingPackageScriptTargets,
  findUnreachableLabScripts,
  type PackageScriptsInput,
} from "./scratch-reachability.ts";

const ROOT = POLICY_SCAN_ROOT;
const LAB_SCRIPTS_DIR = join(ROOT, "svm/lab/scripts");
const RESULTS_PATH = join(ROOT, "svm/lab/RESULTS.md");

function listLabScripts(): string[] {
  return readdirSync(LAB_SCRIPTS_DIR)
    .filter((n) => /\.(ts|tsx|js|mjs|cjs|sh)$/.test(n))
    .map((n) => `svm/lab/scripts/${n}`)
    .sort();
}

function loadRepoPackages(): PackageScriptsInput[] {
  const out: PackageScriptsInput[] = [];
  for (const rel of ["package.json", "svm/lab/package.json"]) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    const j = JSON.parse(readFileSync(abs, "utf8")) as {
      scripts?: Record<string, string>;
    };
    if (!j.scripts) continue;
    out.push({ packageJsonRel: rel, scripts: j.scripts });
  }
  return out;
}

describe("scratch-reachability-policy", () => {
  it("extractScriptFileTargets reads tsx/node/hardhat/bash path tokens", () => {
    assert.deepEqual(
      extractScriptFileTargets("tsx scripts/run-lab.ts"),
      ["scripts/run-lab.ts"],
    );
    assert.deepEqual(
      extractScriptFileTargets(
        "node --import tsx --test test/a.test.ts test/b.test.ts",
      ),
      ["test/a.test.ts", "test/b.test.ts"],
    );
    assert.deepEqual(
      extractScriptFileTargets(
        "hardhat run scripts/deploy-local.ts --network localhost",
      ),
      ["scripts/deploy-local.ts"],
    );
    assert.deepEqual(
      extractScriptFileTargets("cargo test --manifest-path svm/Cargo.toml"),
      ["svm/Cargo.toml"],
    );
  });

  it("half A live: every svm/lab/scripts file is package-reachable or RESULTS-cited", () => {
    const packages = loadRepoPackages();
    const results = readFileSync(RESULTS_PATH, "utf8");
    const unreachable = findUnreachableLabScripts({
      labScriptRels: listLabScripts(),
      packages,
      resultsMarkdown: results,
    });
    assert.deepEqual(
      unreachable,
      [],
      unreachable.map((u) => u.repoRel).join(", "),
    );
  });

  it("half A plant: orphan lab script is red then green (in-memory)", () => {
    const packages: PackageScriptsInput[] = [
      {
        packageJsonRel: "svm/lab/package.json",
        scripts: { "measure:6d2": "tsx scripts/measure-6d2.ts" },
      },
    ];
    const results = "Harness: `svm/lab/scripts/measure-6d2.ts`.\n";
    const red = findUnreachableLabScripts({
      labScriptRels: [
        "svm/lab/scripts/measure-6d2.ts",
        "svm/lab/scripts/debug-orphan.ts",
      ],
      packages,
      resultsMarkdown: results,
    });
    assert.deepEqual(
      red.map((u) => u.repoRel),
      ["svm/lab/scripts/debug-orphan.ts"],
    );
    const green = findUnreachableLabScripts({
      labScriptRels: ["svm/lab/scripts/measure-6d2.ts"],
      packages,
      resultsMarkdown: results,
    });
    assert.deepEqual(green, []);
  });

  it("half B live: every package.json script file target exists", () => {
    const packages = loadRepoPackages();
    const missing = findMissingPackageScriptTargets({
      packages,
      exists: (rel) => existsSync(join(ROOT, rel)),
    });
    assert.deepEqual(
      missing,
      [],
      missing
        .map(
          (m) =>
            `${m.packageJsonRel} scripts.${m.scriptName} → ${m.resolvedRel}`,
        )
        .join("\n"),
    );
  });

  it("half B plant: missing script target is red then green (in-memory)", () => {
    const packages: PackageScriptsInput[] = [
      {
        packageJsonRel: "svm/lab/package.json",
        scripts: {
          lab: "tsx scripts/run-lab.ts",
          "lab:p2": "tsx scripts/run-lab-client.ts",
        },
      },
    ];
    const existsSet = new Set(["svm/lab/scripts/run-lab-client.ts"]);
    const red = findMissingPackageScriptTargets({
      packages,
      exists: (rel) => existsSet.has(rel),
    });
    assert.equal(red.length, 1);
    assert.equal(red[0]!.scriptName, "lab");
    assert.equal(red[0]!.resolvedRel, "svm/lab/scripts/run-lab.ts");

    const greenPackages: PackageScriptsInput[] = [
      {
        packageJsonRel: "svm/lab/package.json",
        scripts: { "lab:p2": "tsx scripts/run-lab-client.ts" },
      },
    ];
    const green = findMissingPackageScriptTargets({
      packages: greenPackages,
      exists: (rel) => existsSet.has(rel),
    });
    assert.deepEqual(green, []);
  });
});
