/**
 * Fail instruments for the two Ponder identities (ADR 0016 §b): one walk,
 * indexing ⊆ executable, API-only edits move only the executable identity.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectPonderGraph,
  computePonderIdentities,
  indexingFilesMissingFromExecutable,
  packageRuntimeSlice,
  type PonderIdentitiesOptions,
} from "../scripts/lib/ponder-executable-fingerprint.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const INDEXING_ENTRIES = ["ponder.config.ts", "ponder.schema.ts", "src/index.ts"];
const API_ENTRIES = ["src/api/index.ts"];

function plantedGraph(opts?: {
  api?: string;
  handler?: string;
  shared?: string;
}): Map<string, string> {
  return new Map<string, string>([
    ["ponder.config.ts", "export default {};\n"],
    ["ponder.schema.ts", "export const passport = {};\n"],
    ["src/index.ts", 'import "./commerce-handlers";\nexport {};\n'],
    [
      "src/commerce-handlers.ts",
      opts?.handler ?? 'import { s } from "../lib/shared";\nexport const h = s;\n',
    ],
    ["lib/shared.ts", opts?.shared ?? "export const s = 1;\n"],
    ["src/api/index.ts", 'import "./commerce-routes";\nexport default {};\n'],
    ["src/api/commerce-routes.ts", opts?.api ?? "export function register() {}\n"],
  ]);
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

function identitiesOf(
  files: Map<string, string>,
  over?: Partial<PonderIdentitiesOptions>,
) {
  return computePonderIdentities(ROOT, {
    indexingEntries: INDEXING_ENTRIES,
    apiEntries: API_ENTRIES,
    fileContents: files,
    artifactContents: ARTIFACTS,
    packageJson: PKG,
    ...over,
  });
}

describe("ponder-executable-fingerprint", () => {
  it("constructed: an API-only edit moves the executable identity, not the indexing one", () => {
    const a = identitiesOf(plantedGraph({ api: "export const r = 1;\n" }));
    const b = identitiesOf(plantedGraph({ api: "export const r = 2;\n" }));
    assert.notEqual(a.executable.digest, b.executable.digest);
    assert.equal(a.indexing.digest, b.indexing.digest);
    assert.match(a.indexing.digest, /^[a-f0-9]{64}$/);
  });

  it("constructed: an edit to a module an indexing handler imports moves both identities", () => {
    const a = identitiesOf(plantedGraph({ shared: "export const s = 1;\n" }));
    const b = identitiesOf(plantedGraph({ shared: "export const s = 2;\n" }));
    assert.notEqual(a.indexing.digest, b.indexing.digest);
    assert.notEqual(a.executable.digest, b.executable.digest);
  });

  it("constructed: a lockfile or Dockerfile edit moves the indexing identity; compose only the executable", () => {
    const base = identitiesOf(plantedGraph());
    const lock = identitiesOf(plantedGraph(), {
      artifactContents: new Map([...ARTIFACTS, ["pnpm-lock.yaml", "lockfileVersion: '9.1'\n"]]),
    });
    const dockerfile = identitiesOf(plantedGraph(), {
      artifactContents: new Map([...ARTIFACTS, ["Dockerfile.ponder", "FROM node:24\n"]]),
    });
    const compose = identitiesOf(plantedGraph(), {
      artifactContents: new Map([...ARTIFACTS, ["docker-compose.yml", "services: {a: {}}\n"]]),
    });
    assert.notEqual(lock.indexing.digest, base.indexing.digest);
    assert.notEqual(dockerfile.indexing.digest, base.indexing.digest);
    assert.equal(compose.indexing.digest, base.indexing.digest);
    assert.notEqual(compose.executable.digest, base.executable.digest);
  });

  it("constructed: a Ponder version bump moves the indexing identity", () => {
    const base = identitiesOf(plantedGraph());
    const bumped = identitiesOf(plantedGraph(), {
      packageJson: { ...PKG, dependencies: { ponder: "^0.16.7" } },
    });
    assert.notEqual(bumped.indexing.digest, base.indexing.digest);
  });

  it("constructed: scripts.test:* package.json edit moves neither identity", () => {
    const a = identitiesOf(plantedGraph());
    const b = identitiesOf(plantedGraph(), {
      packageJson: {
        ...PKG,
        scripts: {
          ...PKG.scripts,
          "test:verify": "node --test test/a.test.ts test/brand-new-policy.test.ts",
          "test:passport-ui": "node --test test/extra.test.ts",
        },
      },
    });
    assert.equal(a.indexing.digest, b.indexing.digest);
    assert.equal(a.executable.digest, b.executable.digest);
  });

  it("packageRuntimeSlice omits scripts.test keys", () => {
    const slice = packageRuntimeSlice(PKG);
    assert.equal(slice.ponderStart, "ponder start");
    assert.deepEqual(slice.dependencies, { ponder: "^0.16.6" });
    assert.equal(JSON.stringify(slice).includes("test:verify"), false);
  });

  it("one walk: the indexing closure excludes API-only files; the executable closure has both", () => {
    const graph = collectPonderGraph(ROOT, {
      indexingEntries: INDEXING_ENTRIES,
      apiEntries: API_ENTRIES,
      fileContents: plantedGraph(),
    });
    assert.ok(graph.indexing.includes("lib/shared.ts"));
    assert.equal(graph.indexing.includes("src/api/commerce-routes.ts"), false);
    assert.ok(graph.executable.includes("src/api/commerce-routes.ts"));
    assert.ok(graph.executable.includes("lib/shared.ts"));
  });

  it("live: the executable file set contains the indexing file set", () => {
    const ids = computePonderIdentities(ROOT);
    assert.deepEqual(
      indexingFilesMissingFromExecutable(ids.indexing.payload, ids.executable.payload),
      [],
    );
    assert.ok(ids.indexing.payload.files.length > 0);
    assert.ok(ids.indexing.payload.files.some((f) => f.path === "pnpm-lock.yaml"));
    assert.ok(ids.executable.payload.files.some((f) => f.path === "src/api/index.ts"));
    assert.equal(
      ids.indexing.payload.files.some((f) => f.path === "docker-compose.yml"),
      false,
    );
  });

  it("constructed: an indexing set not contained in the executable set is named", () => {
    const ids = identitiesOf(plantedGraph());
    const shrunk = {
      ...ids.executable.payload,
      files: ids.executable.payload.files.filter((f) => f.path !== "lib/shared.ts"),
    };
    assert.deepEqual(
      indexingFilesMissingFromExecutable(ids.indexing.payload, shrunk),
      ["lib/shared.ts"],
    );
  });

  it("live Ponder graph contains no svm-ingest/ file", () => {
    const graph = collectPonderGraph(ROOT);
    const hits = graph.executable.filter(
      (p) => p === "svm-ingest" || p.startsWith("svm-ingest/"),
    );
    assert.deepEqual(hits, []);
  });

  it("live indexing graph includes ponder-env.ts, the registry and custody/fold.ts", () => {
    const { indexing } = collectPonderGraph(ROOT);
    assert.ok(indexing.includes("scripts/lib/ponder-env.ts"));
    assert.ok(indexing.includes("lib/web3/commercial-active.ts"));
    assert.ok(indexing.includes("lib/custody/fold.ts"));
  });

  it("planted: relative .js import resolves to .ts source in the graph", () => {
    const graph = collectPonderGraph(ROOT, {
      indexingEntries: ["entry.ts"],
      apiEntries: [],
      fileContents: new Map([
        ["entry.ts", 'import "./a.js";\nexport {};\n'],
        ["a.ts", "export const a = 1;\n"],
      ]),
    });
    assert.ok(graph.indexing.includes("a.ts"));
  });

  it("planted: unresolved relative import throws with file and specifier", () => {
    assert.throws(
      () =>
        collectPonderGraph(ROOT, {
          indexingEntries: ["entry.ts"],
          apiEntries: [],
          fileContents: new Map([["entry.ts", 'import "./missing.js";\nexport {};\n']]),
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /entry\.ts/);
        assert.match(msg, /\.\/missing\.js/);
        return true;
      },
    );
  });

  it("indexing glob file that nothing imports is in the indexing graph and moves its digest", () => {
    const plant = mkdtempSync(join(tmpdir(), "kargain-exec-orphan-"));
    try {
      mkdirSync(join(plant, "src/api"), { recursive: true });
      writeFileSync(join(plant, "ponder.config.ts"), "export default {};\n");
      writeFileSync(join(plant, "ponder.schema.ts"), "export const passport = {};\n");
      writeFileSync(join(plant, "src/index.ts"), "export {};\n");
      writeFileSync(join(plant, "src/api/index.ts"), "export default {};\n");
      writeFileSync(join(plant, "src/orphan.ts"), "export const n = 1;\n");

      assert.ok(collectPonderGraph(plant).indexing.includes("src/orphan.ts"));
      const digestOf = () =>
        computePonderIdentities(plant, {
          artifactContents: ARTIFACTS,
          packageJson: PKG,
        }).indexing.digest;
      const before = digestOf();
      writeFileSync(join(plant, "src/orphan.ts"), "export const n = 2;\n");
      assert.notEqual(digestOf(), before);
    } finally {
      rmSync(plant, { recursive: true, force: true });
    }
  });

  it("entry that resolves to no file throws", () => {
    const plant = mkdtempSync(join(tmpdir(), "kargain-exec-missing-"));
    try {
      mkdirSync(join(plant, "src/api"), { recursive: true });
      writeFileSync(join(plant, "ponder.schema.ts"), "export {};\n");
      writeFileSync(join(plant, "src/index.ts"), "export {};\n");
      writeFileSync(join(plant, "src/api/index.ts"), "export {};\n");
      assert.throws(
        () => collectPonderGraph(plant),
        /Ponder identity entry resolves to no file: ponder\.config\.ts/,
      );
    } finally {
      rmSync(plant, { recursive: true, force: true });
    }
  });

  it("planted entry missing from fileContents throws", () => {
    assert.throws(
      () =>
        collectPonderGraph(ROOT, {
          indexingEntries: ["missing.ts"],
          apiEntries: [],
          fileContents: new Map([["other.ts", "export {};\n"]]),
        }),
      /Ponder identity entry resolves to no file: missing\.ts/,
    );
  });

  it("empty indexing glob throws", () => {
    const plant = mkdtempSync(join(tmpdir(), "kargain-exec-empty-"));
    try {
      mkdirSync(join(plant, "src/api"), { recursive: true });
      writeFileSync(join(plant, "ponder.config.ts"), "export default {};\n");
      writeFileSync(join(plant, "ponder.schema.ts"), "export {};\n");
      writeFileSync(join(plant, "src/api/only.ts"), "export {};\n");
      assert.throws(() => collectPonderGraph(plant), /Ponder indexing glob empty/);
    } finally {
      rmSync(plant, { recursive: true, force: true });
    }
  });

  it("empty indexing entry list throws", () => {
    assert.throws(
      () => collectPonderGraph(ROOT, { indexingEntries: [] }),
      /Ponder indexing entries are empty/,
    );
  });
});
