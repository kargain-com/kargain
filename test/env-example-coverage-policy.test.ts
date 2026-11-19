/**
 * Product/runtime `process.env` reads (app trees ∪ Ponder executable ∪
 * svm-ingest closure) must appear in `.env.example`. Injected-env bindings are
 * resolved by scanProcessEnvReads; remaining opaque reads fail the gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ENV_COVERAGE_APP_ROOTS,
  envExampleCoverage,
  parseEnvExampleDeclarations,
  scanEnvReadsInFiles,
  walkEnvCoverageAppRoot,
} from "../scripts/lib/env-example-coverage.ts";
import { collectPonderGraph } from "../scripts/lib/ponder-executable-fingerprint.ts";
import { scanProcessEnvReads } from "../scripts/lib/ponder-indexing-env-census.ts";
import {
  collectStaticImportClosure,
  resolveSvmIngestStartEntry,
} from "./policy-scan-helpers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Runtime file set: app trees ∪ Ponder executable ∪ svm-ingest closure. */
function collectRuntimeEnvFiles(rootDir: string): string[] {
  const files = new Set<string>();
  for (const root of ENV_COVERAGE_APP_ROOTS) {
    for (const f of walkEnvCoverageAppRoot(rootDir, root)) files.add(f);
  }
  for (const f of collectPonderGraph(rootDir).executable) {
    if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(f)) files.add(f.replace(/\\/g, "/"));
  }
  const svmEntry = resolveSvmIngestStartEntry(rootDir);
  for (const f of collectStaticImportClosure(svmEntry, { rootDir })) {
    if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(f)) files.add(f.replace(/\\/g, "/"));
  }
  return [...files].sort();
}

function liveCoverage() {
  const files = collectRuntimeEnvFiles(ROOT);
  const reads = scanEnvReadsInFiles(ROOT, files);
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  return { files, ...envExampleCoverage(example, reads) };
}

describe("env-example-coverage-policy", () => {
  it("live: every runtime process.env key or prefix is in .env.example; no opaque", () => {
    const coverage = liveCoverage();
    assert.ok(coverage.files.length > 0, "the file set must be non-empty");
    assert.ok(
      coverage.files.some((f) => f === "ponder.config.ts" || f.endsWith("/ponder.config.ts")),
      "Ponder executable closure must include ponder.config.ts",
    );
    assert.ok(
      coverage.files.some((f) => f.startsWith("svm-ingest/")),
      "svm-ingest closure must be present",
    );
    assert.ok(coverage.readTokenCount > 0, "the scan must see named env reads");
    assert.deepEqual(
      coverage.missing,
      [],
      `missing from .env.example (${coverage.missing.length}): ${coverage.missing.join(", ")}`,
    );
    assert.deepEqual(
      coverage.opaque,
      [],
      `opaque reads remain: ${coverage.opaque.map((o) => `${o.file}:${o.line}`).join(", ")}`,
    );
    assert.equal(
      coverage.readTokenCount,
      coverage.readTokens.length,
      "read token count must match the compared set",
    );
  });

  it("constructed: a missing key in a Ponder-closure file is red", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    const base = scanEnvReadsInFiles(ROOT, collectRuntimeEnvFiles(ROOT));
    const planted = [
      ...base,
      ...scanProcessEnvReads(
        "scripts/lib/ponder-env.ts",
        "export const x = process.env.PLANTED_PONDER_ENV;\n",
      ),
    ];
    const coverage = envExampleCoverage(example, planted);
    assert.ok(
      coverage.missing.includes("PLANTED_PONDER_ENV"),
      `expected PLANTED_PONDER_ENV in missing, got: ${coverage.missing.join(", ")}`,
    );
  });

  it("constructed: a missing key through an injected env binding is red", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    const base = scanEnvReadsInFiles(ROOT, collectRuntimeEnvFiles(ROOT));
    const planted = [
      ...base,
      ...scanProcessEnvReads(
        "lib/planted-inject.ts",
        "export function f(env: NodeJS.ProcessEnv = process.env) { return env.PLANTED_INJECTED_ENV; }\n",
      ),
    ];
    const coverage = envExampleCoverage(example, planted);
    assert.ok(
      coverage.missing.includes("PLANTED_INJECTED_ENV"),
      `expected PLANTED_INJECTED_ENV in missing, got: ${coverage.missing.join(", ")}`,
    );
    assert.equal(
      planted.filter((r) => r.kind === "opaque").length,
      base.filter((r) => r.kind === "opaque").length,
      "injected binding must not leave an opaque read",
    );
  });

  it("constructed: an unresolvable opaque read fails the gate", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    const base = scanEnvReadsInFiles(ROOT, collectRuntimeEnvFiles(ROOT));
    const planted = [
      ...base,
      ...scanProcessEnvReads(
        "lib/planted-opaque.ts",
        "export const all = { ...process.env };\n",
      ),
    ];
    const coverage = envExampleCoverage(example, planted);
    assert.ok(
      coverage.opaque.some((o) => o.file === "lib/planted-opaque.ts"),
      "expected opaque read from planted spread",
    );
  });

  it("constructed: a prefix read covered only by concrete keys is red", () => {
    const example = [
      "PONDER_RPC_URLS_84532=https://example.invalid",
      "PONDER_RPC_URLS_11155111=https://example.invalid",
    ].join("\n");
    const reads = scanProcessEnvReads(
      "scripts/lib/ponder-env.ts",
      "const u = process.env[`PONDER_RPC_URLS_${id}`];\n",
    );
    const coverage = envExampleCoverage(example, reads);
    assert.deepEqual(coverage.missing, ["PONDER_RPC_URLS_*"]);
  });

  it("parse: commented keys and prefix placeholders are declarations", () => {
    const decls = parseEnvExampleDeclarations(
      [
        "# NODE_ENV=",
        "NEXT_PUBLIC_APP_URL=http://localhost:3000",
        "# NEXT_PUBLIC_RPC_<chainId>=https://example.invalid",
        "# PONDER_RPC_URLS_<chainId>=",
        "# ARWEAVE_GATEWAY=https://gateway.irys.xyz",
      ].join("\n"),
    );
    const ids = decls.map((d) => (d.prefix ? `${d.key}*` : d.key)).sort();
    assert.deepEqual(ids, [
      "ARWEAVE_GATEWAY",
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_RPC_*",
      "NODE_ENV",
      "PONDER_RPC_URLS_*",
    ]);
  });
});
