/**
 * Product/runtime `process.env.X` reads must appear in `.env.example`.
 * Planted missing key → red; live tree → green with compared counts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  envExampleCoverage,
  liveEnvExampleCoverage,
  parseEnvExampleDeclarations,
  scanRuntimeEnvReads,
} from "../scripts/lib/env-example-coverage.ts";
import { scanProcessEnvReads } from "../scripts/lib/ponder-indexing-env-census.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("env-example-coverage-policy", () => {
  it("live: every product/runtime process.env key or prefix is in .env.example", () => {
    const coverage = liveEnvExampleCoverage(ROOT);
    assert.ok(
      coverage.readTokenCount > 0,
      "the scan must see named env reads",
    );
    assert.ok(
      coverage.declarationCount > 0,
      ".env.example must declare keys",
    );
    assert.deepEqual(
      coverage.missing,
      [],
      `missing from .env.example (${coverage.missing.length}): ${coverage.missing.join(", ")}`,
    );
    assert.equal(
      coverage.readTokenCount,
      coverage.readTokens.length,
      "read token count must match the compared set",
    );
    assert.ok(
      coverage.declarationCount >= coverage.readTokenCount,
      `declarations (${coverage.declarationCount}) must cover reads (${coverage.readTokenCount})`,
    );
  });

  it("constructed: a planted process.env read missing from .env.example is red", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    const planted = [
      ...scanRuntimeEnvReads(ROOT),
      ...scanProcessEnvReads(
        "lib/planted-env.ts",
        "export const x = process.env.PLANTED_MISSING_ENV;\n",
      ),
    ];
    const coverage = envExampleCoverage(example, planted);
    assert.ok(
      coverage.missing.includes("PLANTED_MISSING_ENV"),
      `expected PLANTED_MISSING_ENV in missing, got: ${coverage.missing.join(", ")}`,
    );
  });

  it("parse: commented keys and NEXT_PUBLIC_RPC_<chainId> prefixes are declarations", () => {
    const decls = parseEnvExampleDeclarations(
      [
        "# NODE_ENV=",
        "NEXT_PUBLIC_APP_URL=http://localhost:3000",
        "# NEXT_PUBLIC_RPC_84532=https://example.invalid",
        "# NEXT_PUBLIC_RPC_<chainId>=https://example.invalid",
        "# ARWEAVE_GATEWAY=https://gateway.irys.xyz",
      ].join("\n"),
    );
    const ids = decls.map((d) => (d.prefix ? `${d.key}*` : d.key)).sort();
    assert.deepEqual(ids, [
      "ARWEAVE_GATEWAY",
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_RPC_*",
      "NEXT_PUBLIC_RPC_84532",
      "NODE_ENV",
    ]);
  });

  it("prefix declaration covers NEXT_PUBLIC_RPC_1 and a template prefix read", () => {
    const example = "# NEXT_PUBLIC_RPC_<chainId>=\n";
    const reads = scanProcessEnvReads(
      "x.ts",
      [
        "const a = process.env.NEXT_PUBLIC_RPC_1;",
        "const b = process.env[`NEXT_PUBLIC_RPC_${id}`];",
      ].join("\n"),
    );
    const coverage = envExampleCoverage(example, reads);
    assert.deepEqual(coverage.missing, []);
    assert.deepEqual(coverage.readTokens, [
      "NEXT_PUBLIC_RPC_*",
      "NEXT_PUBLIC_RPC_1",
    ]);
  });
});
