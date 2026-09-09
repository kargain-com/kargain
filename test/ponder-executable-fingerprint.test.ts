/**
 * Fail instruments for ponder-executable-fingerprint.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPonderExecutablePayload,
  collectPonderExecutableGraphFiles,
  digestPonderExecutablePayload,
  packageRuntimeSlice,
} from "../scripts/lib/ponder-executable-fingerprint.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function plantedGraph(apiExtra?: string): Map<string, string> {
  const files = new Map<string, string>();
  files.set("ponder.config.ts", 'export default {};\n');
  files.set("ponder.schema.ts", 'export const passport = {};\n');
  files.set(
    "src/index.ts",
    'import "./commerce-handlers";\nexport {};\n',
  );
  files.set("src/commerce-handlers.ts", "export const h = 1;\n");
  files.set(
    "src/api/index.ts",
    'import "./commerce-routes";\nexport default {};\n',
  );
  files.set(
    "src/api/commerce-routes.ts",
    apiExtra ?? "export function register() {}\n",
  );
  return files;
}

const ARTIFACTS = new Map<string, string>([
  ["Dockerfile.ponder", "FROM node:20\n"],
  ["docker-compose.yml", "services: {}\n"],
  ["pnpm-lock.yaml", "lockfileVersion: '9.0'\n"],
]);

const PKG = {
  dependencies: { ponder: "^0.16.6" },
  packageManager: "pnpm@10.6.5",
  pnpm: { patchedDependencies: {} as Record<string, string> },
  scripts: {
    "ponder:start": "ponder start",
    "test:verify": "node --test test/a.test.ts",
  },
};

describe("ponder-executable-fingerprint", () => {
  it("constructed: src/api change alters executable digest", () => {
    const baseFiles = plantedGraph("export function register() { return 1; }\n");
    const changedFiles = plantedGraph(
      "export function register() { return 2; /* api change */ }\n",
    );
    const d0 = digestPonderExecutablePayload(
      buildPonderExecutablePayload(ROOT, {
        fileContents: baseFiles,
        artifactContents: ARTIFACTS,
        packageJson: PKG,
      }),
    );
    const d1 = digestPonderExecutablePayload(
      buildPonderExecutablePayload(ROOT, {
        fileContents: changedFiles,
        artifactContents: ARTIFACTS,
        packageJson: PKG,
      }),
    );
    assert.notEqual(d0, d1, "API edit must force executable digest change");
    assert.match(d0, /^[a-f0-9]{64}$/);
    assert.match(d1, /^[a-f0-9]{64}$/);
  });

  it("constructed: scripts.test:* package.json edit does NOT alter digest", () => {
    const files = plantedGraph();
    const pkgA = {
      ...PKG,
      scripts: {
        ...PKG.scripts,
        "test:verify": "node --test test/a.test.ts",
      },
    };
    const pkgB = {
      ...PKG,
      scripts: {
        ...PKG.scripts,
        "test:verify":
          "node --test test/a.test.ts test/brand-new-policy.test.ts",
        "test:passport-ui": "node --test test/extra.test.ts",
      },
    };
    const d0 = digestPonderExecutablePayload(
      buildPonderExecutablePayload(ROOT, {
        fileContents: files,
        artifactContents: ARTIFACTS,
        packageJson: pkgA,
      }),
    );
    const d1 = digestPonderExecutablePayload(
      buildPonderExecutablePayload(ROOT, {
        fileContents: files,
        artifactContents: ARTIFACTS,
        packageJson: pkgB,
      }),
    );
    assert.equal(d0, d1, "test-suite membership must not recreate the container");
  });

  it("packageRuntimeSlice omits scripts.test keys", () => {
    const slice = packageRuntimeSlice(PKG);
    assert.equal(slice.ponderStart, "ponder start");
    assert.deepEqual(slice.dependencies, { ponder: "^0.16.6" });
    assert.equal(
      JSON.stringify(slice).includes("test:verify"),
      false,
    );
  });

  it("graph walk reaches src/api from entries and excludes svm-ingest", () => {
    const files = plantedGraph();
    files.set(
      "src/svm-ingest/main.ts",
      "export const shouldNotAppear = true;\n",
    );
    const graph = collectPonderExecutableGraphFiles(ROOT, {
      fileContents: files,
    });
    assert.ok(graph.includes("src/api/commerce-routes.ts"));
    assert.ok(graph.includes("src/index.ts"));
    assert.equal(graph.includes("src/svm-ingest/main.ts"), false);
  });

  it("live executable fingerprint is 64-hex", () => {
    const payload = buildPonderExecutablePayload(ROOT);
    const digest = digestPonderExecutablePayload(payload);
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.ok(payload.files.some((f) => f.path === "src/api/index.ts"));
    assert.ok(payload.files.some((f) => f.path === "Dockerfile.ponder"));
    assert.equal(payload.packageRuntime.ponderStart, "ponder start");
  });
});
