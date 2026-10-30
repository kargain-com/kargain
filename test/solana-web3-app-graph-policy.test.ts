/**
 * S8-2 — @solana/web3.js banned from the app graph (app|components|hooks|lib).
 * Literal `import()` is a static edge (ts.preProcessFile). The Irys Solana
 * adapter remains the opaque door: live scans stop at adapters/irys-solana/.
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
} from "./policy-scan-helpers.ts";

const SOLANA_SDK_IMPORT =
  /from\s*["']@solana\/(?:web3\.js|spl-token)["']|require\s*\(\s*["']@solana\/(?:web3\.js|spl-token)["']\s*\)/;

/** Opaque door — adapter owns the banned SDKs (choke-point irys-solana-adapter). */
const IRYS_SOLANA_ADAPTER_PREFIX = "adapters/irys-solana/";

function solanaSdkTextPredicate(rel: string, source: string): string | false {
  if (!SOLANA_SDK_IMPORT.test(source)) return false;
  return `direct @solana SDK import in app graph (${rel})`;
}

describe("solana web3.js app-graph policy (S8-2)", () => {
  it("no product file statically reaches banned Solana SDKs past the Irys adapter door", () => {
    const violations = traceStaticReachabilityToPackages(
      ["@solana/web3.js", "@solana/spl-token"],
      { stopAtPrefixes: [IRYS_SOLANA_ADAPTER_PREFIX] },
    );
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
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "adapters/irys-solana"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "lib/helper.ts"),
      'import { build } from "@/adapters/irys-solana/build-uploader";\nexport const x = build;\n',
    );
    fs.writeFileSync(
      path.join(root, "adapters/irys-solana/build-uploader.ts"),
      'import { WebSolana } from "@irys/web-upload-solana";\nexport const build = WebSolana;\n',
    );

    const oldScan = scanProductSources(solanaSdkTextPredicate, { rootDir: root });
    assertCleanProductScan(oldScan, { rootDir: root });

    const reachability = traceStaticReachabilityToPackages(
      ["@solana/web3.js", "@solana/spl-token"],
      { rootDir: root },
    );
    assert.equal(reachability.length, 1);
    assert.equal(reachability[0]?.path, "lib/helper.ts");
    assert.match(reachability[0]?.reason ?? "", /@irys\/web-upload-solana/);
    assert.match(reachability[0]?.reason ?? "", /@solana\/web3\.js|@solana\/spl-token/);
  });

  it("constructed: literal import() is a static edge into the adapter", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-irys-scan-"));
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "adapters/irys-solana"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "lib/helper.ts"),
      'export async function load() { return import("@/adapters/irys-solana/build-uploader"); }\n',
    );
    fs.writeFileSync(
      path.join(root, "adapters/irys-solana/build-uploader.ts"),
      'import { WebSolana } from "@irys/web-upload-solana";\nexport const build = WebSolana;\n',
    );
    const reachability = traceStaticReachabilityToPackages(
      ["@solana/web3.js", "@solana/spl-token"],
      { rootDir: root },
    );
    assert.equal(reachability.length, 1);
    assert.equal(reachability[0]?.path, "lib/helper.ts");
    assert.match(reachability[0]?.reason ?? "", /adapters\/irys-solana/);
  });

  it("constructed: stopAtPrefixes keeps the Irys adapter door opaque", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-irys-door-"));
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "adapters/irys-solana"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "lib/helper.ts"),
      'export async function load() { return import("@/adapters/irys-solana/build-uploader"); }\n',
    );
    fs.writeFileSync(
      path.join(root, "adapters/irys-solana/build-uploader.ts"),
      'import { WebSolana } from "@irys/web-upload-solana";\nexport const build = WebSolana;\n',
    );
    const reachability = traceStaticReachabilityToPackages(
      ["@solana/web3.js", "@solana/spl-token"],
      { rootDir: root, stopAtPrefixes: [IRYS_SOLANA_ADAPTER_PREFIX] },
    );
    assert.deepEqual(reachability, []);
  });
});
