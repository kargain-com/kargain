/**
 * Fail instrument: policy content search must not shell out to host `rg`.
 * Host ripgrep is absent on GitHub Actions; Node owner is the only door.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  searchContent,
  searchPaths,
  searchUnder,
} from "./policy-content-search.ts";

const TEST_DIR = join(fileURLToPath(new URL(".", import.meta.url)));
const OWNER = "policy-content-search.ts";
const HOST_RG = /(?:execFileSync|spawnSync|execSync)\(\s*["']rg["']/;

function listTestTsFiles(dir: string = TEST_DIR): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const name of readdirSync(cur)) {
      const full = join(cur, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === "fixtures" || name === "node_modules") continue;
        stack.push(full);
        continue;
      }
      if (name.endsWith(".ts")) out.push(full);
    }
  }
  return out;
}

describe("policy-content-search-policy", () => {
  it("owner exports searchContent / searchPaths / searchUnder", () => {
    assert.equal(typeof searchContent, "function");
    assert.equal(typeof searchPaths, "function");
    assert.equal(typeof searchUnder, "function");
  });

  it("no test suite shells out to host rg (except never the owner)", () => {
    const self = join(TEST_DIR, "policy-content-search-policy.test.ts");
    const dirty = listTestTsFiles()
      .filter((f) => f !== self)
      .filter((f) => !f.endsWith(`/${OWNER}`) && !f.endsWith(`\\${OWNER}`))
      .filter((f) => HOST_RG.test(readFileSync(f, "utf8")));
    assert.deepEqual(dirty, [], `host rg still used:\n${dirty.join("\n")}`);
  });

  it("constructed: host-rg call site is red under the ban regex", () => {
    const planted = `import { execFileSync } from "node:child_process";\nexecFileSync("rg", ["-n", "foo"]);\n`;
    assert.match(planted, HOST_RG);
    const clean = `import { searchUnder } from "./policy-content-search.ts";\nsearchUnder("foo", ".", ["*.rs"]);\n`;
    assert.doesNotMatch(clean, HOST_RG);
  });

  it("searchPaths / searchUnder find constructed hits without host rg", () => {
    const root = mkdtempSync(join(tmpdir(), "kargain-pcs-"));
    try {
      writeFileSync(join(root, "hit.rs"), "fn forbidden_symbol() {}\n");
      writeFileSync(join(root, "miss.rs"), "fn ok() {}\n");
      const hit = searchPaths(String.raw`forbidden_symbol`, [join(root, "hit.rs")]);
      assert.match(hit, /forbidden_symbol/);
      const under = searchUnder(String.raw`forbidden_symbol`, root, ["*.rs"]);
      assert.match(under, /hit\.rs/);
      assert.equal(searchUnder(String.raw`absent_token_xyz`, root, ["*.rs"]).trim(), "");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
