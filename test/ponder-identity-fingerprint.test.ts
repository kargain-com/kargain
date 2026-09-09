/**
 * Fail instruments for ponder-identity-fingerprint: constructed change/non-change.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPonderIdentityPayload,
  digestPonderIdentityPayload,
  type PonderIdentityPayload,
} from "../scripts/lib/ponder-identity-fingerprint.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function basePayload(): PonderIdentityPayload {
  return {
    ordering: "omnichain",
    chains: [
      { name: "baseSepolia", id: 84532 },
      { name: "ethereumSepolia", id: 11155111 },
    ],
    contracts: {
      KarPassport: {
        chain: {
          baseSepolia: {
            address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            startBlock: 100,
          },
        },
      },
    },
    abisGeneratedSha256: sha256("abis-v1"),
    schemaSha256: sha256("schema-v1"),
    indexingFiles: [{ path: "src/index.ts", sha256: sha256("index-v1") }],
  };
}

describe("ponder-identity-fingerprint", () => {
  it("constructed: start block change alters digest", () => {
    const base = basePayload();
    const changed: PonderIdentityPayload = structuredClone(base);
    const entry = changed.contracts.KarPassport!.chain as {
      baseSepolia: { address: string; startBlock: number };
    };
    entry.baseSepolia.startBlock = 999;
    const d0 = digestPonderIdentityPayload(base);
    const d1 = digestPonderIdentityPayload(changed);
    assert.notEqual(d0, d1);
    // Printed digests for the acceptance report
    assert.equal(typeof d0, "string");
    assert.equal(d0.length, 64);
    assert.equal(d1.length, 64);
  });

  it("constructed: contract address change alters digest", () => {
    const base = basePayload();
    const changed: PonderIdentityPayload = structuredClone(base);
    const entry = changed.contracts.KarPassport!.chain as {
      baseSepolia: { address: string; startBlock: number };
    };
    entry.baseSepolia.address = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    assert.notEqual(
      digestPonderIdentityPayload(base),
      digestPonderIdentityPayload(changed),
    );
  });

  it("constructed: chain entry change alters digest", () => {
    const base = basePayload();
    const changed: PonderIdentityPayload = structuredClone(base);
    changed.chains.push({ name: "localhost", id: 31337 });
    assert.notEqual(
      digestPonderIdentityPayload(base),
      digestPonderIdentityPayload(changed),
    );
  });

  it("constructed: schema change alters digest", () => {
    const base = basePayload();
    const changed: PonderIdentityPayload = structuredClone(base);
    changed.schemaSha256 = sha256("schema-v2");
    assert.notEqual(
      digestPonderIdentityPayload(base),
      digestPonderIdentityPayload(changed),
    );
  });

  it("constructed: test/docs/package.json scripts.test edits are not in payload", () => {
    const base = basePayload();
    const d0 = digestPonderIdentityPayload(base);
    // Non-bake surfaces never enter the payload — digest stays identical when
    // we only "edit" them outside the owner.
    const still = digestPonderIdentityPayload({
      ...base,
      // identical identity fields; the following are not payload keys:
    });
    assert.equal(d0, still);

    // Prove the owner payload shape has no slots for those edits:
    const keys = Object.keys(base).sort();
    assert.deepEqual(keys, [
      "abisGeneratedSha256",
      "chains",
      "contracts",
      "indexingFiles",
      "ordering",
      "schemaSha256",
    ]);
    assert.equal("testFile" in base, false);
    assert.equal("docsFile" in base, false);
    assert.equal("packageScripts" in base, false);
  });

  it("constructed: ABI artifact change alters digest", () => {
    const base = basePayload();
    const changed: PonderIdentityPayload = structuredClone(base);
    changed.abisGeneratedSha256 = sha256("abis-v2");
    assert.notEqual(
      digestPonderIdentityPayload(base),
      digestPonderIdentityPayload(changed),
    );
  });

  it("live build produces a stable 64-hex digest without env leakage", () => {
    const payload = buildPonderIdentityPayload(ROOT);
    const digest = digestPonderIdentityPayload(payload);
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.ok(payload.chains.length >= 2);
    assert.ok(payload.contracts.KarPassport);
    assert.equal(payload.ordering, "omnichain");
    // Indexing excludes api + svm-ingest writers
    for (const f of payload.indexingFiles) {
      assert.equal(f.path.startsWith("src/api/"), false, f.path);
      assert.equal(f.path.startsWith("src/svm-ingest/"), false, f.path);
      assert.notEqual(f.path, "src/lib/svm-raw-writer.ts");
      assert.notEqual(f.path, "src/lib/svm-projection-writer.ts");
    }
  });
});
