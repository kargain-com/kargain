/**
 * Unit G: Hardhat discovers exactly the declared native suites; every other
 * suite is named in a `test:*` gate. Bidirectional + constructed holes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  HARDHAT_E2E_SUITE,
  HARDHAT_NATIVE_SUITES,
  findHardhatSuiteHoles,
  isHardhatTestScriptPartitioned,
  parseTestFilesFromScriptBody,
} from "../lib/architecture/hardhat-test-suites.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR = path.join(ROOT, "test");
const PKG = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("hardhat test suites partition (Unit G)", () => {
  it("package.json test invokes the partitioned runner (not bare hardhat test)", () => {
    const body = PKG.scripts.test;
    assert.ok(body, "scripts.test missing");
    assert.equal(
      isHardhatTestScriptPartitioned(body),
      true,
      `scripts.test must run scripts/run-hardhat-test.ts; got: ${body}`,
    );
  });

  it("live tree: declared ≡ Hardhat-importing ∖ e2e; every suite reachable", () => {
    const holes = findHardhatSuiteHoles({
      testDirAbs: TEST_DIR,
      scripts: PKG.scripts,
    });
    assert.deepEqual(
      holes,
      [],
      holes.length
        ? `Hardhat suite partition holes:\n${holes
            .map((h) => `${h.kind}: ${h.file}`)
            .join("\n")}`
        : undefined,
    );
  });

  it("e2e stays on test:e2e — never in HARDHAT_NATIVE_SUITES", () => {
    assert.equal(
      (HARDHAT_NATIVE_SUITES as readonly string[]).includes(HARDHAT_E2E_SUITE),
      false,
    );
    const e2eBody = PKG.scripts["test:e2e"];
    assert.ok(e2eBody);
    assert.ok(
      parseTestFilesFromScriptBody(e2eBody).includes(HARDHAT_E2E_SUITE),
    );
  });

  it("constructed: undeclared Hardhat-import is a hole", () => {
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hh-suite-"));
    try {
      const nested = path.join(fakeRoot, "test");
      fs.mkdirSync(nested);
      fs.writeFileSync(
        path.join(nested, "orphan-hh.test.ts"),
        `import hardhat from "hardhat";\n`,
      );
      const holes = findHardhatSuiteHoles({
        testDirAbs: nested,
        scripts: { "test:unit": "node --test test/foo.test.ts" },
      });
      assert.ok(
        holes.some(
          (h) =>
            h.kind === "hardhat_import_undeclared" &&
            h.file === "test/orphan-hh.test.ts",
        ),
        `expected hardhat_import_undeclared, got ${JSON.stringify(holes)}`,
      );
    } finally {
      fs.rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it("constructed: unreachable non-Hardhat suite is a hole", () => {
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hh-reach-"));
    try {
      const nested = path.join(fakeRoot, "test");
      fs.mkdirSync(nested);
      fs.writeFileSync(
        path.join(nested, "lonely.test.ts"),
        `import { describe, it } from "node:test";\n`,
      );
      const holes = findHardhatSuiteHoles({
        testDirAbs: nested,
        scripts: {},
      });
      assert.ok(
        holes.some(
          (h) =>
            h.kind === "unreachable" && h.file === "test/lonely.test.ts",
        ),
        `expected unreachable, got ${JSON.stringify(holes)}`,
      );
    } finally {
      fs.rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it("constructed: bare hardhat test script is not partitioned", () => {
    assert.equal(isHardhatTestScriptPartitioned("hardhat test"), false);
    assert.equal(
      isHardhatTestScriptPartitioned(
        "node --import tsx scripts/run-hardhat-test.ts",
      ),
      true,
    );
  });
});
