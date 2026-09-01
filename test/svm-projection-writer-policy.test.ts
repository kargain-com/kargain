/**
 * Policy: sole INSERT owner for kargain_svm_projection (S7c-2).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSERT_RE = /INSERT\s+INTO\s+kargain_svm_projection/i;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...listTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("svm projection writer policy", () => {
  it("owner module inserts into projection tables", () => {
    const owner = fs.readFileSync(
      path.join(ROOT, "src/lib/svm-projection-writer.ts"),
      "utf8",
    );
    assert.ok(owner.includes("kargain_svm_projection.passport_record"));
    assert.ok(owner.includes("kargain_svm_projection.passport_uri_history"));
  });

  it("no other module inserts into kargain_svm_projection", () => {
    const ownerPath = path.join(ROOT, "src/lib/svm-projection-writer.ts");
    for (const file of listTsFiles(path.join(ROOT, "src"))) {
      if (file === ownerPath) continue;
      const src = fs.readFileSync(file, "utf8");
      assert.ok(
        !INSERT_RE.test(src),
        `${path.relative(ROOT, file)} must not INSERT into kargain_svm_projection`,
      );
    }
  });

  it("constructed violation: foreign insert fails policy", () => {
    const dirty = "INSERT INTO kargain_svm_projection.passport_record VALUES ()";
    assert.ok(INSERT_RE.test(dirty));
  });
});
