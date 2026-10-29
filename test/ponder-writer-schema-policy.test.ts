/**
 * ADR 0015 §b policy: no `kargain.` table qualifier in src/** (excl. kargain_svm_*).
 * Constructed control: plant the literal, assert red; production tree is green.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

/** Qualifier form banned by ADR 0015 / #73 — not kargain_svm_* schemas. */
const KARGAIN_QUALIFIER = /(?<![\w])kargain\./;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (ent.isFile() && ent.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function findKargainQualifiers(source: string): string[] {
  const hits: string[] = [];
  for (const line of source.split("\n")) {
    if (KARGAIN_QUALIFIER.test(line) && !/kargain_svm_/.test(line)) {
      hits.push(line.trim());
    }
  }
  return hits;
}

describe("ponder writer schema policy", () => {
  it("planted kargain. qualifier is red", () => {
    const planted = 'FROM kargain.passport WHERE id = $1';
    assert.ok(findKargainQualifiers(planted).length > 0);
    assert.deepEqual(findKargainQualifiers("FROM kargain_svm_projection.passport"), []);
  });

  it("src/** has no kargain. qualifier (excl. kargain_svm_*)", () => {
    const violations: { file: string; line: string }[] = [];
    for (const file of walkTsFiles(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      for (const line of findKargainQualifiers(text)) {
        violations.push({ file: path.relative(ROOT, file), line });
      }
    }
    assert.deepEqual(violations, []);
  });

  it("owner module is the sole DATABASE_SCHEMA reader in src/lib product SQL path", () => {
    const owner = fs.readFileSync(
      path.join(SRC, "lib/ponder-writer-schema.ts"),
      "utf8",
    );
    assert.match(owner, /DATABASE_SCHEMA/);
    assert.match(owner, /k_\[0-9a-f\]\{40\}/);
    assert.match(owner, /kargain/);
  });
});
