/**
 * Policy: kargain_svm_raw has no product consumer in S7c-1.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BANNED_ROOTS = [
  path.join(ROOT, "src/api"),
  path.join(ROOT, "app"),
  path.join(ROOT, "src/index.ts"),
  path.join(ROOT, "lib/web3"),
];

const ALLOWED = new Set([
  path.join(ROOT, "src/lib/svm-raw-writer.ts"),
  path.join(ROOT, "src/svm-ingest"),
  path.join(ROOT, "lib/svm"),
  path.join(ROOT, "scripts/svm-raw-replay-digest.ts"),
]);

const NEEDLE = /kargain_svm_raw|structured_payload/;

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  if (fs.statSync(dir).isFile()) return dir.endsWith(".ts") ? [dir] : [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function isAllowed(file: string): boolean {
  for (const prefix of ALLOWED) {
    if (file === prefix || file.startsWith(prefix + path.sep)) return true;
  }
  return false;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("svm raw ingest surface policy", () => {
  for (const root of BANNED_ROOTS) {
    it(`${path.relative(ROOT, root)} does not read kargain_svm_raw`, () => {
      for (const file of listTsFiles(root)) {
        const src = stripComments(fs.readFileSync(file, "utf8"));
        assert.ok(
          !NEEDLE.test(src),
          `${path.relative(ROOT, file)} must not consume raw layer (S7c-1)`,
        );
      }
    });
  }

  it("src/index.ts does not reference raw schema", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "src/index.ts"), "utf8"));
    assert.ok(!NEEDLE.test(src));
  });

  it("constructed violation: api read fails policy", () => {
    const dirty = 'const x = "kargain_svm_raw.structured_payload"';
    assert.ok(NEEDLE.test(dirty));
  });
});

describe("svm raw ingest allowed paths", () => {
  it("writer and ingest service may reference schema", () => {
    const owner = fs.readFileSync(path.join(ROOT, "src/lib/svm-raw-writer.ts"), "utf8");
    assert.ok(isAllowed(path.join(ROOT, "src/lib/svm-raw-writer.ts")));
    assert.ok(owner.includes("kargain_svm_raw"));
  });
});
