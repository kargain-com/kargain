/**
 * Policy: passport provenance UNION reads only via ponder-passport-provenance owner.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = path.join(ROOT, "src/lib/ponder-passport-provenance.ts");

const CONSUMERS = [
  path.join(ROOT, "src/api/index.ts"),
  path.join(ROOT, "src/api/notifications-query.ts"),
];

const WRITER = path.join(ROOT, "src/index.ts");

const RECORD_FROM = /\.from\s*\(\s*passportRecord\s*\)/;
const URI_FROM = /\.from\s*\(\s*passportUriHistory\s*\)/;
const PROJECTION_NEEDLE = /kargain_svm_projection/;

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

describe("ponder passport provenance policy", () => {
  it("consumers import the provenance owner", () => {
    for (const file of CONSUMERS) {
      const src = fs.readFileSync(file, "utf8");
      assert.ok(
        src.includes("ponder-passport-provenance"),
        `${path.relative(ROOT, file)} must import provenance owner`,
      );
    }
  });

  it("owner exports UNION loaders", () => {
    const src = fs.readFileSync(OWNER, "utf8");
    assert.ok(src.includes("loadPassportRecordsByTokenId"));
    assert.ok(src.includes("UNION ALL"));
    assert.ok(src.includes("kargain_svm_projection"));
  });

  it("api routes do not select passport_record / uri_history directly", () => {
    for (const file of CONSUMERS) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      assert.ok(!RECORD_FROM.test(src), `${path.relative(ROOT, file)}`);
      assert.ok(!URI_FROM.test(src), `${path.relative(ROOT, file)}`);
    }
  });

  it("no api module reads kargain_svm_projection except via owner path", () => {
    for (const file of listApiTsFiles()) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      assert.ok(
        !PROJECTION_NEEDLE.test(src),
        `${path.relative(ROOT, file)} must not reference projection schema`,
      );
    }
  });

  it("ponder writer may still use passportRecord", () => {
    const src = fs.readFileSync(WRITER, "utf8");
    assert.ok(src.includes("passportRecord"));
  });

  it("constructed violation: direct passportRecord select in api fails", () => {
    const dirty =
      'import { passportRecord } from "ponder:schema";\nawait db.select().from(passportRecord);';
    assert.ok(RECORD_FROM.test(dirty));
  });
});
