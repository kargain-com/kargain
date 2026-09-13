/**
 * U6.1-fix — shared product scanner must not pass over unread or missing files.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  assertCleanProductScan,
  countProductScanTargets,
  POLICY_SCAN_ROOT,
  PRODUCT_POLICY_SCAN_ROOTS,
  scanProductSources,
  walkProductTsFiles,
} from "./policy-scan-helpers.ts";

function walkDotDirectoryTsFiles(rootDir: string): string[] {
  const hits: string[] = [];
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (name === "node_modules" || name === ".next") continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
        if (name.startsWith(".") || full.includes(`${path.sep}.`)) {
          hits.push(path.relative(rootDir, full).replace(/\\/g, "/"));
        }
      }
    }
  }
  for (const root of PRODUCT_POLICY_SCAN_ROOTS) {
    walk(path.join(rootDir, root));
  }
  return hits.sort();
}

describe("product policy scan contract (U6.1-fix)", () => {
  it("no TypeScript product sources live under dot-directories", () => {
    const dotHits = walkDotDirectoryTsFiles(POLICY_SCAN_ROOT);
    assert.deepEqual(
      dotHits,
      [],
      dotHits.length > 0
        ? `dot-directory sources must not exist: ${dotHits.join(", ")}`
        : undefined,
    );
  });

  it("live repo scan reads the full product target set", () => {
    const scan = scanProductSources(() => false);
    assertCleanProductScan(scan);
    assert.equal(scan.filesRead, countProductScanTargets());
    assert.ok(scan.filesRead >= 700, "expected hundreds of product files");
  });

  it("negative: unreadable file fails by name (red then green)", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kargain-scan-unreadable-"));
    try {
      mkdirSync(path.join(root, "lib"), { recursive: true });
      const rel = "lib/unreadable.ts";
      const abs = path.join(root, rel);
      writeFileSync(abs, "export const x = 1;\n", "utf8");
      chmodSync(abs, 0o000);

      const scan = scanProductSources(() => false, { rootDir: root });
      assert.equal(scan.filesRead, 0);
      assert.equal(scan.unreadable.length, 1);
      assert.match(scan.unreadable[0]!.path, /unreadable\.ts$/);
      assert.match(scan.unreadable[0]!.reason, /^scan_read_failed:/);

      assert.throws(
        () => assertCleanProductScan(scan, { rootDir: root }),
        (err: unknown) => {
          assert.ok(err instanceof assert.AssertionError);
          assert.match(String(err.message), /unreadable|scan_read_failed|ENOENT/);
          return true;
        },
      );

      chmodSync(abs, 0o644);
      const green = scanProductSources(() => false, { rootDir: root });
      assertCleanProductScan(green, { rootDir: root });
      assert.equal(green.filesRead, 1);
    } finally {
      try {
        const abs = path.join(root, "lib/unreadable.ts");
        if (fs.existsSync(abs)) chmodSync(abs, 0o644);
      } catch {
        // best-effort restore before rm
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("negative: empty target set fails count assertion (red then green)", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kargain-scan-empty-"));
    try {
      mkdirSync(path.join(root, "app"), { recursive: true });

      const scan = scanProductSources(() => false, { rootDir: root });
      assert.equal(scan.filesRead, 0);
      assert.equal(countProductScanTargets({ rootDir: root }), 0);

      assert.throws(
        () => assertCleanProductScan(scan, { rootDir: root }),
        (err: unknown) => {
          assert.ok(err instanceof assert.AssertionError);
          assert.match(String(err.message), /at least one file|expected 0/);
          return true;
        },
      );

      mkdirSync(path.join(root, "lib"), { recursive: true });
      writeFileSync(
        path.join(root, "lib/stub.ts"),
        "export const stub = true;\n",
        "utf8",
      );
      const green = scanProductSources(() => false, { rootDir: root });
      assertCleanProductScan(green, { rootDir: root });
      assert.equal(green.filesRead, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("consumer suite floors (representative ownership scans)", () => {
    const floors: Array<{ label: string; filesRead: number }> = [];

    const hub = scanProductSources(() => false);
    floors.push({ label: "commercial-active-hub-literal (full tree)", filesRead: hub.filesRead });

    const vm = scanProductSources(() => false, {
      owners: ["lib/passport/prepare-passport-edit-write.ts"],
    });
    floors.push({
      label: "sample owner skip (prepare-passport-edit-write)",
      filesRead: vm.filesRead,
    });

    for (const row of floors) {
      assert.ok(row.filesRead > 0, row.label);
    }
    assert.equal(hub.filesRead, walkProductTsFiles(POLICY_SCAN_ROOT).length);
    assert.equal(
      vm.filesRead,
      countProductScanTargets({
        owners: ["lib/passport/prepare-passport-edit-write.ts"],
      }),
    );
  });
});
