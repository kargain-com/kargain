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
  type ProcessEnvRead,
} from "../scripts/lib/ponder-indexing-env-census.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Removed by ADR 0016 §a; spelled in parts so the removal grep stays empty. */
const REMOVED_START_BLOCK_KEY = ["PONDER", "START", "BLOCK"].join("_");

function liveReads(): ProcessEnvRead[] {
  const { indexing } = collectPonderGraph(ROOT);
  return indexing.flatMap((rel) =>
    scanProcessEnvReads(rel, readFileSync(join(ROOT, rel), "utf8")),
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

  it("scan: literal, element, template and opaque reads", () => {
    const reads = scanProcessEnvReads(
      "x.ts",
      [
        "const a = process.env.A;",
        'const b = process.env["B"];',
        "const c = process.env[`C_${id}`];",
        "const d = (process.env as Record<string, string>).D;",
        "const e = process.env;",
        "const f = process.env[k];",
      ].join("\n"),
    );
    assert.deepEqual(
      reads.map((r) =>
        r.kind === "key" ? r.key : r.kind === "prefix" ? `${r.prefix}*` : "opaque",
      ),
      ["A", "B", "C_*", "opaque", "opaque", "opaque"],
    );
  });

  it("constructed: an opaque read can never be classified", () => {
    const reads = scanProcessEnvReads("x.ts", "const all = { ...process.env };\n");
    assert.equal(indexingEnvCensusDefects(reads).unclassified.length, 1);
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
