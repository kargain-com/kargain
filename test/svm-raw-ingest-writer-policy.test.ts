/**
 * Policy: sole INSERT owner for kargain_svm_raw (S7c-1).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = path.join(ROOT, "src/lib/svm-raw-writer.ts");

const INSERT_RE = /INSERT\s+INTO\s+kargain_svm_raw/i;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("svm raw ingest writer policy", () => {
  it("owner inserts into structured_payload and ingest_refusal", () => {
    const src = stripComments(fs.readFileSync(OWNER, "utf8"));
    assert.ok(INSERT_RE.test(src));
    assert.ok(src.includes("kargain_svm_raw.structured_payload"));
    assert.ok(src.includes("kargain_svm_raw.ingest_refusal"));
  });

  it("no other module inserts into kargain_svm_raw tables", () => {
    const scanRoots = [
      path.join(ROOT, "src"),
      path.join(ROOT, "lib"),
      path.join(ROOT, "app"),
      path.join(ROOT, "scripts"),
    ];
    for (const root of scanRoots) {
      for (const file of listTsFiles(root)) {
        if (file === OWNER) continue;
        const src = stripComments(fs.readFileSync(file, "utf8"));
        assert.ok(
          !INSERT_RE.test(src),
          `${path.relative(ROOT, file)} must not INSERT into kargain_svm_raw — use svm-raw-writer`,
        );
      }
    }
  });

  it("constructed violation: insert outside owner detected", () => {
    const dirty = "INSERT INTO kargain_svm_raw.structured_payload VALUES ()";
    assert.ok(INSERT_RE.test(dirty));
  });

  it("owner without INSERT fails", () => {
    const src = stripComments(fs.readFileSync(OWNER, "utf8"));
    const stripped = src.replace(/INSERT\s+INTO/gi, "");
    assert.ok(!INSERT_RE.test(stripped));
  });
});
