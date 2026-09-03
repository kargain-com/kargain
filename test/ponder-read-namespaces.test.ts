/**
 * Local UNION namespaces live on the indexer owner, not COMMERCIAL_ACTIVE.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { registeredCommercialNamespaceIds } from "../lib/web3/commercial-active.ts";
import { LOCALHOST_CHAIN_ID } from "../lib/web3/deployment-addresses.ts";
import { indexerReadNamespaceIds } from "../src/lib/ponder-read-namespaces.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ponder read namespaces", () => {
  it("commercial registry source has no process.env and no 31337", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "lib/web3/commercial-active.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /process\.env/);
    assert.doesNotMatch(src, /\b31337\b/);
    assert.doesNotMatch(src, /indexerReadNamespaceIds/);
    assert.doesNotMatch(src, /commercialSvmProjectionLive/);
  });

  it("without PONDER_ENABLE_LOCAL, UNION namespaces are commercial only", () => {
    const prev = process.env.PONDER_ENABLE_LOCAL;
    delete process.env.PONDER_ENABLE_LOCAL;
    try {
      assert.deepEqual(
        [...indexerReadNamespaceIds()],
        [...registeredCommercialNamespaceIds()],
      );
      assert.ok(!indexerReadNamespaceIds().includes(LOCALHOST_CHAIN_ID));
    } finally {
      if (prev === undefined) delete process.env.PONDER_ENABLE_LOCAL;
      else process.env.PONDER_ENABLE_LOCAL = prev;
    }
  });

  it("PONDER_ENABLE_LOCAL=1 appends LOCALHOST_CHAIN_ID", () => {
    const prev = process.env.PONDER_ENABLE_LOCAL;
    process.env.PONDER_ENABLE_LOCAL = "1";
    try {
      const ids = indexerReadNamespaceIds();
      assert.ok(ids.includes(LOCALHOST_CHAIN_ID));
      for (const id of registeredCommercialNamespaceIds()) {
        assert.ok(ids.includes(id));
      }
    } finally {
      if (prev === undefined) delete process.env.PONDER_ENABLE_LOCAL;
      else process.env.PONDER_ENABLE_LOCAL = prev;
    }
  });
});
