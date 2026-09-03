/**
 * D-1: every repository TypeScript file belongs to exactly one typecheck
 * project (root membership via parseJsonConfigFileContent.fileNames).
 *
 * Bidirectional: package.json `typecheck` must invoke `-p` for every registry
 * tsconfig; every walked file has exactly one owner.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { TYPECHECK_PROJECTS } from "../lib/architecture/typecheck-projects.ts";
import {
  buildTypecheckMembership,
  findMembershipViolations,
  parseTypecheckProjectFlags,
  type TypecheckMembership,
} from "./typecheck-membership-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("typecheck project membership policy", () => {
  it("registry ids are unique and do not mimic Truth-layer T# form", () => {
    const ids = TYPECHECK_PROJECTS.map((p) => p.id);
    assert.equal(ids.length, new Set(ids).size);
    for (const id of ids) {
      assert.doesNotMatch(id, /^T\d+$/);
    }
  });

  it("every walked TypeScript file belongs to exactly one project", () => {
    const membership = buildTypecheckMembership(ROOT);
    const { none, dual } = findMembershipViolations(membership);
    assert.deepEqual(
      none,
      [],
      none.length
        ? `TypeScript outside every typecheck project:\n${none.join("\n")}`
        : undefined,
    );
    assert.deepEqual(
      dual,
      [],
      dual.length
        ? `TypeScript in two typecheck projects:\n${dual
            .map((d) => `${d.file} → ${d.projects.join(" + ")}`)
            .join("\n")}`
        : undefined,
    );
  });

  it("package.json typecheck invokes -p for every registry tsconfig", () => {
    const body = PKG.scripts.typecheck;
    assert.ok(body, "package.json scripts.typecheck missing");
    const flagged = new Set(parseTypecheckProjectFlags(body));
    const missing = TYPECHECK_PROJECTS.filter((p) => !flagged.has(p.tsconfig)).map(
      (p) => p.tsconfig,
    );
    assert.deepEqual(
      missing,
      [],
      missing.length
        ? `typecheck script missing -p for:\n${missing.join("\n")}`
        : undefined,
    );
    // Bidirectional: every -p target is a registry entry
    const registry = new Set(TYPECHECK_PROJECTS.map((p) => p.tsconfig));
    const extra = [...flagged].filter((p) => !registry.has(p));
    assert.deepEqual(
      extra,
      [],
      extra.length
        ? `typecheck -p targets not in TYPECHECK_PROJECTS:\n${extra.join("\n")}`
        : undefined,
    );
  });

  it("constructed violation: file in no project is detected", () => {
    const membership: TypecheckMembership = new Map([
      ["orphan/example.ts", []],
    ]);
    const { none, dual } = findMembershipViolations(membership);
    assert.deepEqual(none, ["orphan/example.ts"]);
    assert.deepEqual(dual, []);
  });

  it("constructed violation: file in two projects is detected", () => {
    const membership: TypecheckMembership = new Map([
      ["shared/example.ts", ["app", "node"]],
    ]);
    const { none, dual } = findMembershipViolations(membership);
    assert.deepEqual(none, []);
    assert.equal(dual.length, 1);
    assert.equal(dual[0]?.file, "shared/example.ts");
    assert.deepEqual(dual[0]?.projects, ["app", "node"]);
  });

  it("constructed control: single membership passes", () => {
    const membership: TypecheckMembership = new Map([
      ["lib/example.ts", ["app"]],
    ]);
    assert.deepEqual(findMembershipViolations(membership), {
      none: [],
      dual: [],
    });
  });

  it("parseTypecheckProjectFlags extracts chained -p targets", () => {
    const flags = parseTypecheckProjectFlags(
      "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    );
    assert.deepEqual(flags, ["tsconfig.json", "tsconfig.node.json"]);
  });
});
