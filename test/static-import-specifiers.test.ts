/**
 * Sole static-import owner — side-effect imports and related forms.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { extractStaticImportSpecifiers } from "../scripts/lib/static-import-specifiers.ts";
import {
  buildPonderExecutablePayload,
  collectPonderExecutableGraphFiles,
  digestPonderExecutablePayload,
} from "../scripts/lib/ponder-executable-fingerprint.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("static-import-specifiers", () => {
  it("yields side-effect, named, type, namespace, default, export-from, require, dynamic import, multiline", () => {
    const source = `
import "./side";
import def from "./def";
import { named } from "./named";
import * as ns from "./ns";
import type { T } from "./type-only";
export { a } from "./exp";
export * from "./star";
const r = require("./req");
const d = import("./dyn");
import {
  multi
} from "./multi";
`;
    assert.deepEqual(extractStaticImportSpecifiers(source).sort(), [
      "./def",
      "./dyn",
      "./exp",
      "./multi",
      "./named",
      "./ns",
      "./req",
      "./side",
      "./star",
      "./type-only",
    ]);
  });

  it("does not yield specifiers that appear only in comments or strings", () => {
    const source = `
// import "./commented";
/* import "./block"; */
const s = "import \\"./string\\";";
import "./real";
`;
    assert.deepEqual(extractStaticImportSpecifiers(source), ["./real"]);
  });

  it("constructed: side-effect then named from both appear in the executable graph", () => {
    const files = new Map<string, string>([
      [
        "entry.ts",
        'import "./b";\nimport { x } from "./c";\nexport {};\n',
      ],
      ["b.ts", "export const b = 1;\n"],
      ["c.ts", "export const x = 1;\n"],
    ]);
    const graph = collectPonderExecutableGraphFiles(ROOT, {
      entries: ["entry.ts"],
      fileContents: files,
    });
    assert.ok(graph.includes("b.ts"), "side-effect ./b must be in the graph");
    assert.ok(graph.includes("c.ts"), "named ./c must be in the graph");
  });

  it("live graph includes src/bridge-handlers.ts", () => {
    const graph = collectPonderExecutableGraphFiles(ROOT);
    assert.ok(
      graph.includes("src/bridge-handlers.ts"),
      "side-effect import from src/index.ts must reach bridge-handlers",
    );
  });

  it("live: bridge-handlers content participates in the executable digest", () => {
    const graph = collectPonderExecutableGraphFiles(ROOT);
    assert.ok(graph.includes("src/bridge-handlers.ts"));
    const fileContents = new Map(
      graph.map((rel) => [rel, readFileSync(join(ROOT, rel), "utf8")] as const),
    );
    const before = digestPonderExecutablePayload(
      buildPonderExecutablePayload(ROOT, { fileContents }),
    );
    fileContents.set(
      "src/bridge-handlers.ts",
      `${fileContents.get("src/bridge-handlers.ts")!}\n// fingerprint-probe\n`,
    );
    const after = digestPonderExecutablePayload(
      buildPonderExecutablePayload(ROOT, { fileContents }),
    );
    assert.notEqual(
      before,
      after,
      "bridge-handlers edit must change executable digest",
    );
  });
});
