/**
 * Tracked TypeScript may not carry a file-wide @ts-nocheck pragma
 * outside the named exception list (empty).
 *
 * Plants are in-memory — never write a pragma into the scanned tree.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  TS_NOCHECK_EXCEPTIONS,
  findTsNocheckViolations,
  sourceHasTsNocheckPragma,
} from "../lib/architecture/ts-nocheck.ts";
import { listTrackedFiles } from "./policy-content-search.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function trackedTsFiles(): Array<{ path: string; source: string }> {
  const rels = listTrackedFiles(ROOT, ["*.ts", "*.tsx"]).filter((p) =>
    /\.tsx?$/.test(p),
  );
  return rels.map((rel) => ({
    path: rel,
    source: readFileSync(path.join(ROOT, rel), "utf8"),
  }));
}

describe("ts-nocheck policy", () => {
  it("named exception list is empty", () => {
    assert.deepEqual([...TS_NOCHECK_EXCEPTIONS], []);
  });

  it("live tracked TypeScript has no file-wide nocheck pragma", () => {
    assert.deepEqual(findTsNocheckViolations(trackedTsFiles()), []);
  });

  it("planted file-wide pragma is red then green (in-memory)", () => {
    const planted = {
      path: "svm/lab/scripts/planted-nocheck.ts",
      source: "// @ts-nocheck\nexport const x = 1;\n",
    };
    const clean = { path: planted.path, source: "export const x = 1;\n" };
    assert.equal(sourceHasTsNocheckPragma(planted.source), true);
    assert.deepEqual(findTsNocheckViolations([planted]), [planted.path]);
    assert.equal(sourceHasTsNocheckPragma(clean.source), false);
    assert.deepEqual(findTsNocheckViolations([clean]), []);
    assert.deepEqual(findTsNocheckViolations(trackedTsFiles()), []);
  });

  it("named exception skips the planted path; token in prose is not a pragma", () => {
    const planted = {
      path: "svm/lab/scripts/planted-nocheck.ts",
      source: "// @ts-nocheck\nexport const x = 1;\n",
    };
    assert.deepEqual(
      findTsNocheckViolations([planted], [planted.path]),
      [],
    );
    assert.equal(
      sourceHasTsNocheckPragma(
        'it("mentions @ts-nocheck in a title without a pragma") {}',
      ),
      false,
    );
  });
});
