/**
 * ADR 0014 §g / ADR 0015 §j — the static import closure of svm-ingest:start
 * must not intersect Ponder's indexing glob.
 */
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  listPonderIndexingGlob,
  ponderIndexingSvmIngestDefect,
  resolveSvmIngestStartEntry,
} from "../scripts/lib/ponder-indexing-glob.ts";
import {
  collectStaticImportClosure,
  SVM_INGEST_GRAPH_ROOTS,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function isolationDefect(rootDir: string): string | null {
  const entry = resolveSvmIngestStartEntry(rootDir);
  const owned = collectStaticImportClosure(entry, {
    rootDir,
    graphRoots: SVM_INGEST_GRAPH_ROOTS,
  });
  const indexing = listPonderIndexingGlob(rootDir);
  return ponderIndexingSvmIngestDefect(indexing, owned);
}

describe("ponder indexing glob", () => {
  it("constructed fixture: .d.ts in; dot dir, api, test.mts, tsx out", () => {
    const plant = mkdtempSync(path.join(tmpdir(), "kargain-ponder-glob-"));
    try {
      mkdirSync(path.join(plant, "src/api"), { recursive: true });
      mkdirSync(path.join(plant, "src/.hidden"), { recursive: true });
      writeFileSync(path.join(plant, "src/index.ts"), "export {};\n");
      writeFileSync(path.join(plant, "src/types.d.ts"), "export {};\n");
      writeFileSync(path.join(plant, "src/ok.mts"), "export {};\n");
      writeFileSync(path.join(plant, "src/skip.test.mts"), "export {};\n");
      writeFileSync(path.join(plant, "src/skip.tsx"), "export {};\n");
      writeFileSync(path.join(plant, "src/api/route.ts"), "export {};\n");
      writeFileSync(path.join(plant, "src/.hidden/secret.ts"), "export {};\n");

      assert.deepEqual(listPonderIndexingGlob(plant), [
        "src/index.ts",
        "src/ok.mts",
        "src/types.d.ts",
      ]);
    } finally {
      rmSync(plant, { recursive: true, force: true });
    }
  });

  it("constructed: unreadable indexing dir fails closed", () => {
    const plant = mkdtempSync(path.join(tmpdir(), "kargain-ponder-glob-missing-"));
    try {
      assert.throws(
        () => listPonderIndexingGlob(plant),
        /Ponder indexing dir unreadable/,
      );
    } finally {
      rmSync(plant, { recursive: true, force: true });
    }
  });

  it("constructed: empty indexing glob fails closed", () => {
    const plant = mkdtempSync(path.join(tmpdir(), "kargain-ponder-glob-empty-"));
    try {
      mkdirSync(path.join(plant, "src/api"), { recursive: true });
      writeFileSync(path.join(plant, "src/api/only.ts"), "export {};\n");
      assert.throws(
        () => listPonderIndexingGlob(plant),
        /Ponder indexing glob empty/,
      );
    } finally {
      rmSync(plant, { recursive: true, force: true });
    }
  });
});

describe("ponder indexing glob svm isolation policy", () => {
  it("live tree: svm-ingest:start closure ∩ Ponder indexing glob is empty", () => {
    const defect = isolationDefect(ROOT);
    assert.equal(defect, null, defect ?? undefined);
  });

  it("constructed: closure file under src/ fails", () => {
    const plant = mkdtempSync(path.join(tmpdir(), "kargain-svm-isol-"));
    try {
      mkdirSync(path.join(plant, "src/lib"), { recursive: true });
      mkdirSync(path.join(plant, "svm-ingest"), { recursive: true });
      writeFileSync(path.join(plant, "src/index.ts"), "export {};\n");
      writeFileSync(
        path.join(plant, "src/lib/svm-ingest-helper.ts"),
        "export const helper = 1;\n",
      );
      writeFileSync(
        path.join(plant, "svm-ingest/main.ts"),
        'import { helper } from "../src/lib/svm-ingest-helper.js";\nexport const x = helper;\n',
      );
      writeFileSync(
        path.join(plant, "package.json"),
        JSON.stringify({
          scripts: {
            "svm-ingest:start": "node --import tsx svm-ingest/main.ts",
          },
        }),
      );

      const defect = isolationDefect(plant);
      assert.ok(defect);
      assert.match(defect!, /src\/lib\/svm-ingest-helper\.ts/);
    } finally {
      rmSync(plant, { recursive: true, force: true });
    }
  });

  it("constructed: empty closure fails closed", () => {
    assert.throws(
      () => ponderIndexingSvmIngestDefect(["src/index.ts"], []),
      /svm-ingest import closure is empty/,
    );
  });

  it("constructed: unresolved svm-ingest:start fails closed", () => {
    const plant = mkdtempSync(path.join(tmpdir(), "kargain-svm-start-"));
    try {
      writeFileSync(path.join(plant, "package.json"), JSON.stringify({ scripts: {} }));
      assert.throws(
        () => resolveSvmIngestStartEntry(plant),
        /svm-ingest:start unresolved/,
      );
    } finally {
      rmSync(plant, { recursive: true, force: true });
    }
  });

  it("constructed: isolated entry outside src/ passes", () => {
    const plant = mkdtempSync(path.join(tmpdir(), "kargain-svm-ok-"));
    try {
      mkdirSync(path.join(plant, "src"), { recursive: true });
      mkdirSync(path.join(plant, "svm-ingest"), { recursive: true });
      mkdirSync(path.join(plant, "lib/svm"), { recursive: true });
      writeFileSync(path.join(plant, "src/index.ts"), "export {};\n");
      writeFileSync(
        path.join(plant, "lib/svm/config.ts"),
        "export const n = 1;\n",
      );
      writeFileSync(
        path.join(plant, "svm-ingest/main.ts"),
        'import { n } from "../lib/svm/config.js";\nexport const x = n;\n',
      );
      writeFileSync(
        path.join(plant, "package.json"),
        JSON.stringify({
          scripts: {
            "svm-ingest:start": "node --import tsx svm-ingest/main.ts",
          },
        }),
      );

      assert.equal(isolationDefect(plant), null);
    } finally {
      rmSync(plant, { recursive: true, force: true });
    }
  });
});
