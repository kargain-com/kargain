/**
 * Ponder vs svm-ingest VPS deploy workflows stay isolated (no cross rebuild).
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PONDER_WF = join(ROOT, ".github/workflows/deploy-ponder.yml");
const SVM_WF = join(ROOT, ".github/workflows/deploy-svm-ingest.yml");

function pathsBlock(yaml: string): string {
  const m = yaml.match(/paths:\n((?: {6}- .+\n)+)/);
  assert.ok(m, "workflow must declare on.push.paths");
  return m[1]!;
}

describe("deploy-ponder-svm-ingest-ci-policy", () => {
  it("ponder workflow omits svm-ingest paths and Dockerfile.svm-ingest", () => {
    const yaml = readFileSync(PONDER_WF, "utf8");
    const paths = pathsBlock(yaml);
    assert.doesNotMatch(paths, /src\/svm-ingest/);
    assert.doesNotMatch(paths, /Dockerfile\.svm-ingest/);
    assert.doesNotMatch(paths, /lib\/svm/);
    assert.match(yaml, /docker compose build ponder/);
    assert.match(yaml, /docker compose up -d ponder/);
    assert.doesNotMatch(yaml, /build svm-ingest/);
  });

  it("svm-ingest workflow exists and never builds or restarts ponder", () => {
    const yaml = readFileSync(SVM_WF, "utf8");
    const paths = pathsBlock(yaml);
    assert.match(paths, /src\/svm-ingest\/\*\*/);
    assert.match(paths, /lib\/svm\/\*\*/);
    assert.match(paths, /Dockerfile\.svm-ingest/);
    assert.match(yaml, /docker compose build svm-ingest/);
    assert.match(
      yaml,
      /docker compose up -d --force-recreate svm-ingest/,
    );
    assert.doesNotMatch(yaml, /build ponder/);
    assert.doesNotMatch(yaml, /up -d ponder/);
    assert.doesNotMatch(yaml, /up -d --force-recreate ponder/);
  });

  it("Dockerfiles pin corepack pnpm@10.6.5 matching packageManager", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as { packageManager?: string };
    assert.equal(pkg.packageManager, "pnpm@10.6.5");
    for (const name of ["Dockerfile.svm-ingest", "Dockerfile.ponder"] as const) {
      const df = readFileSync(join(ROOT, name), "utf8");
      assert.match(df, /corepack enable/);
      assert.match(df, /corepack prepare pnpm@10\.6\.5 --activate/);
      assert.doesNotMatch(df, /npm install -g pnpm/);
    }
  });
});
