/**
 * ADR 0014 §g / ADR 0015 §j — svm-ingest-owned modules must stay outside
 * Ponder's indexing glob (hashed + executed). Red while those modules live
 * under src/; green once they live only under svm-ingest/.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  listPonderIndexingGlob,
  listSvmIngestOwnedModules,
  ponderIndexingSvmIngestDefect,
  SVM_INGEST_ROOT,
} from "../scripts/lib/ponder-indexing-glob.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ponder indexing glob svm isolation policy", () => {
  it("live tree: no svm-ingest-owned module is in the Ponder indexing glob", () => {
    const indexing = listPonderIndexingGlob(ROOT);
    const owned = listSvmIngestOwnedModules(ROOT);
    const defect = ponderIndexingSvmIngestDefect(indexing, owned);
    assert.equal(
      defect,
      null,
      defect ?? undefined,
    );
  });

  it("constructed: owned modules under src/svm-ingest fail", () => {
    const defect = ponderIndexingSvmIngestDefect(
      ["src/index.ts", "src/svm-ingest/main.ts"],
      [`${SVM_INGEST_ROOT}/main.ts`],
    );
    assert.ok(defect);
    assert.match(defect!, /src\/svm-ingest\/main\.ts/);
  });

  it("constructed: writer under src/lib fails", () => {
    const defect = ponderIndexingSvmIngestDefect(
      ["src/index.ts", "src/lib/svm-raw-writer.ts"],
      [`${SVM_INGEST_ROOT}/svm-raw-writer.ts`],
    );
    assert.ok(defect);
    assert.match(defect!, /src\/lib\/svm-raw-writer\.ts/);
  });

  it("constructed: empty owned catalog fails", () => {
    const defect = ponderIndexingSvmIngestDefect(["src/index.ts"], []);
    assert.ok(defect);
    assert.match(defect!, new RegExp(`${SVM_INGEST_ROOT}/`));
  });

  it("constructed: isolated owned root passes", () => {
    assert.equal(
      ponderIndexingSvmIngestDefect(
        ["src/index.ts", "src/api/index.ts"].filter((p) => !p.startsWith("src/api")),
        [`${SVM_INGEST_ROOT}/main.ts`, `${SVM_INGEST_ROOT}/svm-raw-writer.ts`],
      ),
      null,
    );
  });
});
