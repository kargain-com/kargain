/**
 * Policy: passport entity UNION reads only via ponder-passport-entity owner.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = path.join(ROOT, "src/lib/ponder-passport-entity.ts");

const CONSUMERS = [
  path.join(ROOT, "src/api/index.ts"),
  path.join(ROOT, "src/api/commerce-routes.ts"),
  path.join(ROOT, "src/api/notifications-query.ts"),
  path.join(ROOT, "src/api/load-obligation-facts.ts"),
];

const PASSPORT_FROM = /\.from\s*\(\s*passport\s*\)/;
const PROJECTION_NEEDLE = /kargain_svm_projection\.passport[^_]/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function listApiTsFiles(): string[] {
  const apiDir = path.join(ROOT, "src/api");
  const out: string[] = [];
  for (const entry of fs.readdirSync(apiDir, { withFileTypes: true })) {
    if (entry.name.endsWith(".ts")) out.push(path.join(apiDir, entry.name));
  }
  return out;
}

describe("ponder passport entity policy", () => {
  it("consumers import the entity owner", () => {
    for (const file of CONSUMERS) {
      const src = fs.readFileSync(file, "utf8");
      assert.ok(
        src.includes("ponder-passport-entity"),
        `${path.relative(ROOT, file)} must import entity owner`,
      );
    }
  });

  it("owner exports UNION loaders", () => {
    const src = fs.readFileSync(OWNER, "utf8");
    assert.ok(src.includes("loadPassportEntityById"));
    assert.ok(src.includes("loadPassportEntitiesBrowse"));
    assert.ok(src.includes("UNION ALL"));
    assert.ok(src.includes("kargain_svm_projection.passport"));
  });

  it("api routes do not select passport table directly", () => {
    for (const file of CONSUMERS) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      assert.ok(!PASSPORT_FROM.test(src), path.relative(ROOT, file));
    }
  });

  it("no api module reads kargain_svm_projection.passport except via owner path", () => {
    for (const file of listApiTsFiles()) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      if (file.endsWith("ponder-passport-entity.ts")) continue;
      if (file.endsWith("passport-entity-browse-sql.ts")) continue;
      assert.ok(
        !PROJECTION_NEEDLE.test(src),
        `${path.relative(ROOT, file)} must not reference projection passport schema`,
      );
    }
  });

  it("constructed violation: direct passport select in api fails", () => {
    const dirty =
      'import { passport } from "ponder:schema";\nawait db.select().from(passport);';
    assert.ok(PASSPORT_FROM.test(stripComments(dirty)));
  });
});
