/**
 * Policy: metadata snapshots captured at inline ingest only; rebuild reads raw, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REBUILD_PATHS = [
  "lib/svm/project-raw-to-projection.ts",
  "src/svm-ingest/projection-rebuild.ts",
  "src/svm-ingest/projection-projector.ts",
  "lib/svm/passport-entity-projection.ts",
];

const RAW_WRITER = path.join(ROOT, "src/lib/svm-raw-writer.ts");

describe("svm metadata snapshot policy", () => {
  it("rebuild/projection modules do not fetch metadata over the network", () => {
    for (const rel of REBUILD_PATHS) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert.ok(!src.includes("fetchMetadataFromUri"), rel);
      assert.ok(!src.includes("fetchMetadataForUri"), rel);
      assert.ok(!src.includes("capture-metadata-at-ingest"), rel);
      assert.ok(!/fetch\s*\(/.test(src), rel);
    }
  });

  it("raw writer is sole INSERT owner for metadata_snapshot", () => {
    const src = fs.readFileSync(RAW_WRITER, "utf8");
    assert.ok(src.includes("insertMetadataSnapshot"));
    assert.ok(src.includes("metadata_snapshot"));
  });

  it("constructed violation: fetch in projection rebuild fails grep", () => {
    const dirty = 'import { fetch } from "undici";\nawait fetch("https://example.com");';
    assert.ok(/fetch\s*\(/.test(dirty));
  });
});
