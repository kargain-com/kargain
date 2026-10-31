/**
 * S8-2 — @solana/web3.js banned from the app graph (app|components|hooks|lib).
 * Literal `import()` is a static edge (ts.preProcessFile). The only opaque
 * door is the declared edge irys-client → adapters/irys-solana/ (choke-point
 * irys-solana-adapter); any other product edge into the adapter is red.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  assertCleanProductScan,
  scanProductSources,
  traceStaticReachabilityToPackages,
  type ReachabilityStopEdge,
} from "./policy-scan-helpers.ts";

const SOLANA_SDK_IMPORT =
  /from\s*["']@solana\/(?:web3\.js|spl-token)["']|require\s*\(\s*["']@solana\/(?:web3\.js|spl-token)["']\s*\)/;

const IRYS_SOLANA_ADAPTER_PREFIX = "adapters/irys-solana/";

/** Declared door — only this importer may stop at the adapter. */
const IRYS_CLIENT_DOOR: ReachabilityStopEdge = {
  from: "lib/storage/irys-client.ts",
  toPrefix: IRYS_SOLANA_ADAPTER_PREFIX,
};

const BANNED = ["@solana/web3.js", "@solana/spl-token"] as const;

function solanaSdkTextPredicate(rel: string, source: string): string | false {
  if (!SOLANA_SDK_IMPORT.test(source)) return false;
  return `direct @solana SDK import in app graph (${rel})`;
}

function plantAdapterGraph(
  root: string,
  importerRel: string,
  importerSource: string,
): void {
  fs.mkdirSync(path.join(root, path.dirname(importerRel)), { recursive: true });
  fs.mkdirSync(path.join(root, "adapters/irys-solana"), { recursive: true });
  fs.writeFileSync(path.join(root, importerRel), importerSource);
  fs.writeFileSync(
    path.join(root, "adapters/irys-solana/build-uploader.ts"),
    'import { WebSolana } from "@irys/web-upload-solana";\nexport const build = WebSolana;\n',
  );
}

describe("solana web3.js app-graph policy (S8-2)", () => {
  it("no product file statically reaches banned Solana SDKs past the Irys client door", () => {
    const violations = traceStaticReachabilityToPackages(BANNED, {
      stopAtEdges: [IRYS_CLIENT_DOOR],
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("constructed direct import is red under the legacy text scan", () => {
    const dirty = `import { Connection } from "@solana/web3.js";\n`;
    assert.equal(
      solanaSdkTextPredicate("lib/web3/invented-rpc.ts", dirty),
      "direct @solana SDK import in app graph (lib/web3/invented-rpc.ts)",
    );
  });

  it("transitive reachability is red even when the old text scan stays green", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-irys-scan-"));
    plantAdapterGraph(
      root,
      "lib/helper.ts",
      'import { build } from "@/adapters/irys-solana/build-uploader";\nexport const x = build;\n',
    );

    const oldScan = scanProductSources(solanaSdkTextPredicate, { rootDir: root });
    assertCleanProductScan(oldScan, { rootDir: root });

    const reachability = traceStaticReachabilityToPackages(BANNED, {
      rootDir: root,
    });
    assert.equal(reachability.length, 1);
    assert.equal(reachability[0]?.path, "lib/helper.ts");
    assert.match(reachability[0]?.reason ?? "", /@irys\/web-upload-solana/);
    assert.match(reachability[0]?.reason ?? "", /@solana\/web3\.js|@solana\/spl-token/);
  });

  it("constructed: literal import() is a static edge into the adapter", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-irys-scan-"));
    plantAdapterGraph(
      root,
      "lib/helper.ts",
      'export async function load() { return import("@/adapters/irys-solana/build-uploader"); }\n',
    );
    const reachability = traceStaticReachabilityToPackages(BANNED, {
      rootDir: root,
    });
    assert.equal(reachability.length, 1);
    assert.equal(reachability[0]?.path, "lib/helper.ts");
    assert.match(reachability[0]?.reason ?? "", /adapters\/irys-solana/);
  });

  it("constructed: declared irys-client → adapter edge is opaque", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-irys-door-"));
    plantAdapterGraph(
      root,
      "lib/storage/irys-client.ts",
      'export async function load() { return import("@/adapters/irys-solana/build-uploader"); }\n',
    );
    const reachability = traceStaticReachabilityToPackages(BANNED, {
      rootDir: root,
      stopAtEdges: [IRYS_CLIENT_DOOR],
    });
    assert.deepEqual(reachability, []);
  });

  it("constructed: components import of the adapter is red", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-irys-leak-"));
    plantAdapterGraph(
      root,
      "components/x.tsx",
      'export async function load() { return import("@/adapters/irys-solana/build-uploader"); }\n',
    );

    const hits = traceStaticReachabilityToPackages(BANNED, {
      rootDir: root,
      stopAtEdges: [IRYS_CLIENT_DOOR],
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.path, "components/x.tsx");
    assert.match(hits[0]?.reason ?? "", /adapters\/irys-solana|@solana/);
  });
});
