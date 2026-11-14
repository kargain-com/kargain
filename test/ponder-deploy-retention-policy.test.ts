/**
 * ADR 0016 §j retention, ADR 0011: only owned schemas (`k_<40 hex>`,
 * `kargain`) outside current and previous are ever dropped; the sync store,
 * RPC cache and svm schemas cannot be selected. The svm projection rebuild
 * stays inside its own schema (both directions of the S7c-2 isolation).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  dropSchemaSql,
  imageTagsToRemove,
  isOwnedPonderSchema,
  schemasToDrop,
} from "../scripts/lib/ponder-deploy-retention.ts";
import type { DeployRef, DeployState } from "../scripts/lib/ponder-deploy-state.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTION_REBUILD = path.join(ROOT, "svm-ingest/projection-rebuild.ts");
const PROJECTION_WRITER = path.join(ROOT, "svm-ingest/svm-projection-writer.ts");
const REPO = "kargain-ponder";

const PROTECTED = [
  "public",
  "ponder_sync",
  "ponder_rpc_cache_1",
  "kargain_svm_raw",
  "kargain_svm_projection",
  "information_schema",
  "pg_catalog",
];

function ref(commitHex: string, indexingHex: string): DeployRef {
  const commit = commitHex.repeat(40);
  return {
    commit,
    image: `${REPO}:${commit}`,
    indexing: indexingHex.repeat(64),
    executable: "e".repeat(64),
  };
}

const LEGACY: DeployRef = {
  commit: null,
  image: `${REPO}:legacy`,
  indexing: null,
  executable: "f".repeat(64),
};

const schemaOf = (hex: string) => `k_${hex.repeat(40)}`;

type Selector = (schemas: readonly string[], state: DeployState) => string[];

/** Every way a selection can be wrong; null when it is exactly right. */
function retentionSelectionDefect(
  select: Selector,
  schemas: readonly string[],
  state: DeployState,
): string | null {
  const selected = select(schemas, state);
  for (const s of selected) {
    if (PROTECTED.includes(s)) return `selected protected ${s}`;
    if (!isOwnedPonderSchema(s)) return `selected non-owned ${s}`;
  }
  const keep = [state.current, state.previous]
    .filter((r): r is DeployRef => r !== null)
    .map((r) => (r.indexing === null ? "kargain" : `k_${r.indexing.slice(0, 40)}`));
  for (const k of keep) if (selected.includes(k)) return `selected kept ${k}`;
  const expected = schemas.filter((s) => isOwnedPonderSchema(s) && !keep.includes(s));
  for (const e of expected) if (!selected.includes(e)) return `left owned ${e}`;
  return null;
}

const STATE: DeployState = {
  current: ref("2", "b"),
  previous: ref("1", "a"),
  switching: null,
};
const SCHEMAS = [
  ...PROTECTED,
  "kargain",
  schemaOf("a"),
  schemaOf("b"),
  schemaOf("c"),
  "k_short",
  `k_${"A".repeat(40)}`,
  "kargain_old",
];

describe("ponder-deploy-retention-policy", () => {
  it("drops exactly the owned schemas outside current and previous", () => {
    assert.equal(retentionSelectionDefect(schemasToDrop, SCHEMAS, STATE), null);
    assert.deepEqual(schemasToDrop(SCHEMAS, STATE), [schemaOf("c"), "kargain"]);
  });

  it("keeps kargain while the legacy ref is current or previous", () => {
    const state: DeployState = { current: ref("2", "b"), previous: LEGACY, switching: null };
    assert.equal(retentionSelectionDefect(schemasToDrop, SCHEMAS, state), null);
    assert.equal(schemasToDrop(SCHEMAS, state).includes("kargain"), false);
  });

  it("refs sharing a schema keep it once", () => {
    const state: DeployState = { current: ref("2", "a"), previous: ref("1", "a"), switching: null };
    assert.equal(retentionSelectionDefect(schemasToDrop, SCHEMAS, state), null);
  });

  it("constructed: a selection of a protected schema is red", () => {
    const planted: Selector = (s, st) => [...schemasToDrop(s, st), "ponder_sync"];
    assert.equal(
      retentionSelectionDefect(planted, SCHEMAS, STATE),
      "selected protected ponder_sync",
    );
  });

  it("constructed: a selection of current's or previous's schema is red", () => {
    const dropsPrevious: Selector = (s, st) =>
      schemasToDrop(s, { ...st, previous: null });
    assert.equal(
      retentionSelectionDefect(dropsPrevious, SCHEMAS, STATE),
      `selected kept ${schemaOf("a")}`,
    );
    const dropsCurrent: Selector = (s, st) => [...schemasToDrop(s, st), schemaOf("b")];
    assert.equal(
      retentionSelectionDefect(dropsCurrent, SCHEMAS, STATE),
      `selected kept ${schemaOf("b")}`,
    );
  });

  it("constructed: a selection of a non-owned schema is red", () => {
    const prefix: Selector = (s, st) => [
      ...schemasToDrop(s, st),
      ...s.filter((n) => n.startsWith("k_") && !isOwnedPonderSchema(n)),
    ];
    assert.equal(
      retentionSelectionDefect(prefix, SCHEMAS, STATE),
      "selected non-owned k_short",
    );
    const nonOwned: Selector = (s, st) => [...schemasToDrop(s, st), "kargain_old"];
    assert.equal(
      retentionSelectionDefect(nonOwned, SCHEMAS, STATE),
      "selected non-owned kargain_old",
    );
  });

  it("drop SQL refuses any name retention could not select", () => {
    for (const name of PROTECTED) {
      assert.throws(() => dropSchemaSql(name), /retention refuses non-owned schema/);
    }
    assert.equal(dropSchemaSql(schemaOf("c")), `DROP SCHEMA "${schemaOf("c")}" CASCADE`);
  });

  it("image tags: keep current, previous, writer and deploy; remove the rest", () => {
    const tags = ["writer", "deploy", "1".repeat(40), "2".repeat(40), "3".repeat(40), "legacy", "latest", "derive"];
    assert.deepEqual(imageTagsToRemove(tags, STATE, REPO), [
      "3".repeat(40),
      "derive",
      "latest",
      "legacy",
    ]);
    const legacyPrevious: DeployState = { ...STATE, previous: LEGACY };
    assert.equal(imageTagsToRemove(tags, legacyPrevious, REPO).includes("legacy"), false);
  });

  it("the deploy never runs ponder db prune", () => {
    for (const rel of [
      "scripts/ponder-deploy.sh",
      "scripts/ponder-deploy-step.ts",
      "scripts/lib/ponder-deploy-switch.ts",
      "scripts/lib/ponder-deploy-retention.ts",
    ]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert.doesNotMatch(src.replace(/^\s*(?:\*|\/\/|#).*$/gm, ""), /db prune/, rel);
    }
  });

  it("projection rebuild drops its own schema only", () => {
    const rebuildSrc = fs.readFileSync(PROJECTION_REBUILD, "utf8");
    const writerSrc = fs.readFileSync(PROJECTION_WRITER, "utf8");
    assert.ok(rebuildSrc.includes("dropSvmProjectionSchema"));
    assert.ok(rebuildSrc.includes("rebuildProjectionFromRaw"));
    assert.ok(!rebuildSrc.includes("rpc-client"));
    assert.ok(writerSrc.includes("DROP SCHEMA IF EXISTS kargain_svm_projection"));
    assert.ok(!writerSrc.includes("DROP SCHEMA IF EXISTS kargain CASCADE"));
    assert.ok(!writerSrc.includes("ponder_sync"));
  });
});
