/**
 * S8-2 — @solana/web3.js banned from the app graph (app|components|hooks|lib).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  scanProductSources,
  traceStaticReachabilityToPackages,
} from "./policy-scan-helpers.ts";

const SOLANA_SDK_IMPORT =
  /from\s*["']@solana\/(?:web3\.js|spl-token)["']|require\s*\(\s*["']@solana\/(?:web3\.js|spl-token)["']\s*\)/;

function solanaSdkTextPredicate(rel: string, source: string): string | false {
  if (!SOLANA_SDK_IMPORT.test(source)) return false;
  return `direct @solana SDK import in app graph (${rel})`;
}

describe("solana web3.js app-graph policy (S8-2)", () => {
  it("no product file statically reaches banned Solana SDKs", () => {
    const violations = traceStaticReachabilityToPackages([
      "@solana/web3.js",
      "@solana/spl-token",
    ]);
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
    assert.deepEqual(oldScan, []);

    const reachability = traceStaticReachabilityToPackages(
      ["@solana/web3.js", "@solana/spl-token"],
      { rootDir: root },
    );
    assert.equal(reachability.length, 1);
    assert.equal(reachability[0]?.path, "lib/helper.ts");
    assert.match(reachability[0]?.reason ?? "", /@irys\/web-upload-solana/);
    assert.match(reachability[0]?.reason ?? "", /@solana\/web3\.js|@solana\/spl-token/);
  });

  it("constructed control: dynamic import boundary is not treated as static reachability", () => {
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
    assert.deepEqual(reachability, []);
  });
});
