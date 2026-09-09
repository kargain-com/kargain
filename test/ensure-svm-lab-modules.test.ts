/**
 * Fail instrument: typecheck refuses when svm/lab modules are absent.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  svmLabModulesMissing,
  svmLabModulesMissingMessage,
} from "../scripts/ensure-svm-lab-modules.ts";

describe("ensure-svm-lab-modules", () => {
  it("constructed: empty lab root is red by name", () => {
    const root = mkdtempSync(join(tmpdir(), "kargain-svm-lab-"));
    try {
      const missing = svmLabModulesMissing(root);
      assert.ok(missing.length >= 2);
      const msg = svmLabModulesMissingMessage(missing);
      assert.match(msg, /^svm_lab_modules_missing:/);
      assert.match(msg, /pnpm install:svm-lab/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("constructed: markers present → empty missing list", () => {
    const root = mkdtempSync(join(tmpdir(), "kargain-svm-lab-ok-"));
    try {
      for (const rel of [
        "node_modules/@solana/spl-token",
        "node_modules/@solana/web3.js",
      ]) {
        mkdirSync(join(root, rel), { recursive: true });
        writeFileSync(join(root, rel, "package.json"), "{}\n");
      }
      assert.deepEqual(svmLabModulesMissing(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("live svm/lab markers are present after install:svm-lab", () => {
    assert.deepEqual(svmLabModulesMissing(), []);
  });
});
