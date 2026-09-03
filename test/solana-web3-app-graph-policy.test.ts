/**
 * S8-2 — @solana/web3.js banned from the app graph (app|components|hooks|lib).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scanProductSources } from "./policy-scan-helpers.ts";

const WEB3JS_IMPORT = /from\s*["']@solana\/web3\.js["']|require\s*\(\s*["']@solana\/web3\.js["']\s*\)/;

function web3jsPredicate(rel: string, source: string): string | false {
  if (!WEB3JS_IMPORT.test(source)) return false;
  return `@solana/web3.js in app graph (${rel})`;
}

describe("solana web3.js app-graph policy (S8-2)", () => {
  it("no product file imports @solana/web3.js", () => {
    const violations = scanProductSources(web3jsPredicate);
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("constructed dirty import is red", () => {
    const dirty = `import { Connection } from "@solana/web3.js";\n`;
    assert.equal(
      web3jsPredicate("lib/web3/invented-rpc.ts", dirty),
      "@solana/web3.js in app graph (lib/web3/invented-rpc.ts)",
    );
  });
});
