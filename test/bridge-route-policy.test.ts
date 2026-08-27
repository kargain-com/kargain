/**
 * Route resolver is the sole owner of hub/spoke hop sequences.
 * Ban a second counterpart map under lib / hooks / components.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OWNER = path.join(ROOT, "lib/web3/bridge/bridge-config.ts");

const SCAN_DIRS = [
  path.join(ROOT, "lib"),
  path.join(ROOT, "hooks"),
  path.join(ROOT, "components"),
] as const;

const COUNTERPART_MAP =
  /(?:const|let|var)\s+\w*(COUNTERPART|counterpartChains?|STAR_REMOTE)\w*/;

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("bridge route resolver policy", () => {
  it("owning module exports resolveBridgeRoute and has no hub default on adapter", () => {
    const text = fs.readFileSync(OWNER, "utf8");
    assert.match(text, /export function resolveBridgeRoute/);
    assert.doesNotMatch(
      text,
      /function bridgeAdapterAddress\s*\(\s*chainId:\s*number\s*=\s*BRIDGE_HUB_CHAIN_ID/,
    );
    assert.doesNotMatch(text, /(?:const|let)\s+COUNTERPART\b/);
  });

  it("no second counterpart map under lib/ hooks/ components/", () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (file === OWNER) continue;
        const text = fs.readFileSync(file, "utf8");
        if (COUNTERPART_MAP.test(text)) {
          violations.push(path.relative(ROOT, file));
        }
        if (/export function resolveBridgeRoute/.test(text)) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });
});
