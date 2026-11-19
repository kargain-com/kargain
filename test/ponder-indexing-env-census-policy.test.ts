/**
 * ADR 0016 §a/§b: every `process.env` read in the indexing identity's closure
 * is classified transport / database / local, every classified key is read,
 * and the deploy preflight refuses removed keys, a DATABASE_SCHEMA override
 * and every set local key. The closure is the fingerprint owner's own walk.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { collectPonderGraph } from "../scripts/lib/ponder-executable-fingerprint.ts";
import {
  PONDER_INDEXING_ENV_CENSUS,
  indexingEnvCensusDefects,
  ponderDeployEnvRefusal,
  scanProcessEnvReads,
  scanProcessEnvReadsInSources,
  type ProcessEnvRead,
} from "../scripts/lib/ponder-indexing-env-census.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Removed by ADR 0016 §a. */
const REMOVED_START_BLOCK_KEY = "PONDER_START_BLOCK";

function liveReads(): ProcessEnvRead[] {
  const { indexing } = collectPonderGraph(ROOT);
  return scanProcessEnvReadsInSources(
    indexing.map((rel) => ({
      file: rel,
      source: readFileSync(join(ROOT, rel), "utf8"),
    })),
  );
}

describe("ponder-indexing-env-census-policy", () => {
  it("live: every read in the indexing closure is classified and every entry is read", () => {
    const reads = liveReads();
    assert.ok(reads.length > 0, "the scan must see env reads");
    const defects = indexingEnvCensusDefects(reads);
    assert.deepEqual(defects.unclassified, []);
    assert.deepEqual(defects.unread, []);
  });

  it("constructed: an unclassified read in the closure is red", () => {
    const planted = [
      ...liveReads(),
      ...scanProcessEnvReads(
        "src/planted.ts",
        "export const b = process.env.PONDER_PLANTED_START;\n",
      ),
    ];
    const defects = indexingEnvCensusDefects(planted);
    assert.deepEqual(
      defects.unclassified.map((r) => (r.kind === "key" ? r.key : r.kind)),
      ["PONDER_PLANTED_START"],
    );
  });

  it("constructed: a classified key that nothing reads is red", () => {
    const census = [
      ...PONDER_INDEXING_ENV_CENSUS,
      { key: "PONDER_NEVER_READ", class: "transport" as const },
    ];
    assert.deepEqual(
      indexingEnvCensusDefects(liveReads(), census).unread.map((e) => e.key),
      ["PONDER_NEVER_READ"],
    );
  });

  it("scan: literal, element, template, cast, binding, destructure, and opaque reads", () => {
    const reads = scanProcessEnvReads(
      "x.ts",
      [
        "const a = process.env.A;",
        'const b = process.env["B"];',
        "const c = process.env[`C_${id}`];",
        "const d = (process.env as Record<string, string>).D;",
        "const e = process.env;",
        "use(e);",
        "const f = process.env[k];",
        "function g(env: NodeJS.ProcessEnv = process.env) { return env.G; }",
        "const { H } = process.env;",
      ].join("\n"),
    );
    assert.deepEqual(
      reads.map((r) =>
        r.kind === "key" ? r.key : r.kind === "prefix" ? `${r.prefix}*` : "opaque",
      ),
      // cast unwrap names D; bare binding then use(e) is opaque; process.env[k]
      // stays opaque; injected env.G is named; destructure yields H.
      ["A", "B", "C_*", "D", "opaque", "opaque", "G", "H"],
    );
  });

  it("constructed: an opaque read can never be classified", () => {
    const reads = scanProcessEnvReads("x.ts", "const all = { ...process.env };\n");
    assert.equal(indexingEnvCensusDefects(reads).unclassified.length, 1);
  });

  it("scan (binder): export escape, hoist, param property, var hoist, wrong-position forward", () => {
    const label = (reads: ProcessEnvRead[]) =>
      reads.map((r) =>
        r.kind === "key" ? r.key : r.kind === "prefix" ? `${r.prefix}*` : "opaque",
      );

    assert.deepEqual(
      label(scanProcessEnvReads("x.ts", "export const e = process.env;\n")),
      ["opaque"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          "export function f() { return e.H; } const e = process.env;\n",
        ),
      ),
      ["H"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          "class C { constructor(private env = process.env) {} get x() { return this.env.CX; } }\n",
        ),
      ),
      ["opaque", "opaque"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          "function f() { return e.H; }\nvar e = process.env;\n",
        ),
      ),
      ["H"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          [
            "function g(e = process.env) { return e.Q; }",
            "export function f(env = process.env) {",
            "  const g = (x) => x.Z;",
            "  return g(env);",
            "}",
          ].join("\n"),
        ),
      ),
      ["Q", "opaque"],
    );
  });

  it("scan (binder): shorthand, strict options forward, param destructure, process forms", () => {
    const label = (reads: ProcessEnvRead[]) =>
      reads.map((r) =>
        r.kind === "key" ? r.key : r.kind === "prefix" ? `${r.prefix}*` : "opaque",
      );

    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          "function f(env = process.env) { return { env }; }\n",
        ),
      ),
      ["opaque"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          "function f(env = process.env) { return h({ env }); }\n",
        ),
      ),
      ["opaque"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          "const env = process.env; export const cfg = { env };\n",
        ),
      ),
      ["opaque"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          [
            "function g(o) { const e = o?.env ?? process.env; return h(o); }",
            "function f(env = process.env) { return g({ env }); }",
          ].join("\n"),
        ),
      ),
      ["opaque"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          [
            "function g(o) { const e = o?.env ?? process.env; return o!.env.SECRET2; }",
            "function f(env = process.env) { return g({ env }); }",
          ].join("\n"),
        ),
      ),
      ["opaque"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          "function f({ A } = process.env) { return A; }\n",
        ),
      ),
      ["A"],
    );
    assert.deepEqual(
      label(scanProcessEnvReads("x.ts", 'process["env"].X1;\n')),
      ["X1"],
    );
    assert.deepEqual(
      label(scanProcessEnvReads("x.ts", "globalThis.process.env.X2;\n")),
      ["X2"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads("x.ts", "const { env } = process; env.X3;\n"),
      ),
      ["opaque"],
    );
    // process binding: .env is an env source → named read
    assert.deepEqual(
      label(
        scanProcessEnvReads("x.ts", "const p = process; p.env.X4;\n"),
      ),
      ["X4"],
    );
  });

  it("scan (binder): process export/rest, local shadow, typeof, moduleDetection", () => {
    const label = (reads: ProcessEnvRead[]) =>
      reads.map((r) =>
        r.kind === "key" ? r.key : r.kind === "prefix" ? `${r.prefix}*` : "opaque",
      );

    assert.deepEqual(
      label(scanProcessEnvReads("x.ts", "export const p = process;\n")),
      ["opaque"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          "const { exit, ...rest } = process; rest.env.R1;\n",
        ),
      ),
      ["opaque"],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads(
          "x.ts",
          "function f(process: any) { return process.env.NOT_REAL; }\n",
        ),
      ),
      [],
    );
    assert.deepEqual(
      label(
        scanProcessEnvReads("x.ts", "typeof process !== 'undefined';\n"),
      ),
      [],
    );
    assert.deepEqual(
      label(scanProcessEnvReads("x.ts", "typeof process.env;\n")),
      [],
    );

    const batch = scanProcessEnvReadsInSources([
      { file: "a.ts", source: "var env = process.env;\n" },
      { file: "b.ts", source: "function use() { return env.CROSS_SCRIPT; }\n" },
    ]);
    assert.deepEqual(label(batch), []);
    assert.deepEqual(
      label(scanProcessEnvReads("b.ts", "function use() { return env.CROSS_SCRIPT; }\n")),
      label(batch.filter((r) => r.file === "b.ts")),
    );
  });

  it("refuses removed start-block keys and every PONDER_*_ADDRESS by name", () => {
    for (const key of [
      REMOVED_START_BLOCK_KEY,
      `${REMOVED_START_BLOCK_KEY}_84532`,
      `${REMOVED_START_BLOCK_KEY}_11155111`,
      "PONDER_KAR_PASSPORT_ADDRESS",
      "PONDER_SOMETHING_NEW_ADDRESS",
    ]) {
      assert.deepEqual(ponderDeployEnvRefusal({ [key]: "1" }), {
        reason: "removed_env_key",
        key,
      });
    }
  });

  it("refuses a DATABASE_SCHEMA override", () => {
    assert.deepEqual(ponderDeployEnvRefusal({ DATABASE_SCHEMA: "kargain" }), {
      reason: "database_schema_override",
      key: "DATABASE_SCHEMA",
    });
  });

  it("refuses every set local census key, NEXT_PUBLIC_ENABLE_LOCAL_CHAIN included", () => {
    const local = PONDER_INDEXING_ENV_CENSUS.filter(
      (e) => e.class === "local" && !/_ADDRESS$/.test(e.key),
    );
    assert.ok(local.some((e) => e.key === "NEXT_PUBLIC_ENABLE_LOCAL_CHAIN"));
    for (const { key } of local) {
      assert.deepEqual(
        ponderDeployEnvRefusal({ [key]: "1" }),
        { reason: "local_mode_set", key },
        key,
      );
    }
  });

  it("blank values are unset; transport and database keys pass", () => {
    assert.equal(
      ponderDeployEnvRefusal({
        PONDER_ENABLE_LOCAL: "  ",
        DATABASE_SCHEMA: "",
        DATABASE_URL: "postgresql://x",
        PONDER_RPC_URLS_84532: "https://a",
        PONDER_GETLOGS_BLOCK_RANGE_84532: "500",
      }),
      null,
    );
  });
});
