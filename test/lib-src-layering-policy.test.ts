/**
 * Modules under lib/ must not import from src/. That edge put shared facts
 * into Ponder's indexing glob via the svm-ingest closure (#70 / #78).
 */
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildStaticImportGraph,
  walkTsFilesFromRoots,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type LibSrcLayeringHit = { from: string; to: string };

/**
 * Defect list: every local import from a lib/ module that resolves under src/.
 */
export function libImportsFromSrcHits(
  rootDir: string,
): LibSrcLayeringHit[] {
  const graph = buildStaticImportGraph(["lib"], rootDir);
  const hits: LibSrcLayeringHit[] = [];
  for (const [from, node] of graph) {
    if (!from.startsWith("lib/")) continue;
    for (const to of node.localDeps) {
      if (to === "src" || to.startsWith("src/")) {
        hits.push({ from, to });
      }
    }
  }
  return hits.sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
}

describe("lib/ must not import from src/", () => {
  it("live tree: no lib/ module imports from src/", () => {
    const hits = libImportsFromSrcHits(ROOT);
    assert.deepEqual(
      hits,
      [],
      hits.map((h) => `${h.from} → ${h.to}`).join("\n"),
    );
  });

  it("constructed: lib → src import is red", () => {
    const plant = mkdtempSync(path.join(tmpdir(), "kargain-lib-src-"));
    try {
      mkdirSync(path.join(plant, "lib/svm"), { recursive: true });
      mkdirSync(path.join(plant, "src/lib"), { recursive: true });
      writeFileSync(
        path.join(plant, "src/lib/ponder-g1-fields.ts"),
        "export const x = 1;\n",
      );
      writeFileSync(
        path.join(plant, "lib/svm/passport-entity-projection.ts"),
        'import { x } from "../../src/lib/ponder-g1-fields.js";\nexport const y = x;\n',
      );
      const hits = libImportsFromSrcHits(plant);
      assert.equal(hits.length, 1);
      assert.equal(hits[0]?.from, "lib/svm/passport-entity-projection.ts");
      assert.equal(hits[0]?.to, "src/lib/ponder-g1-fields.ts");
    } finally {
      rmSync(plant, { recursive: true, force: true });
    }
  });

  it("lib/ tree is non-empty (negative control)", () => {
    const files = walkTsFilesFromRoots(["lib"], ROOT);
    assert.ok(files.length > 0);
    assert.ok(
      files.some((f) =>
        f.replace(/\\/g, "/").endsWith("lib/passport/trust-fields.ts"),
      ),
    );
    // Touch package.json so unused-import lint stays quiet if any.
    assert.ok(readFileSync(path.join(ROOT, "package.json"), "utf8").length > 0);
  });
});
