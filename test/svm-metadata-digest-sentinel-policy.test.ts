/**
 * Ban writing/comparing the retired digest sentinel `"unavailable"`.
 * Status owns unavailability; digests are hex or SQL NULL.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_ROOTS = ["lib/svm", "src/svm-ingest", "src/lib"];

/** Digest-shaped uses of the literal — status: "unavailable" is legal. */
const DIGEST_SENTINEL_PATTERNS = [
  /contentSha256\s*:\s*["']unavailable["']/,
  /content_sha256\s*:\s*["']unavailable["']/,
  /contentSha256\s*=\s*["']unavailable["']/,
  /content_sha256\s*=\s*["']unavailable["']/,
  /["']unavailable["']\s*as\s+content/i,
];

function walkTs(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "target") continue;
      walkTs(p, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
}

describe("svm metadata digest sentinel ban (raw-sentinel)", () => {
  it("no source assigns or compares digest to the literal unavailable", () => {
    const hits: string[] = [];
    for (const root of SCAN_ROOTS) {
      const files: string[] = [];
      walkTs(path.join(ROOT, root), files);
      for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        for (const re of DIGEST_SENTINEL_PATTERNS) {
          if (re.test(text)) {
            hits.push(`${path.relative(ROOT, file)} ~ ${re}`);
          }
        }
      }
    }
    assert.deepEqual(
      hits,
      [],
      `digest sentinel "unavailable" must not appear:\n${hits.join("\n")}`,
    );
  });

  it("planted: contentSha256: \"unavailable\" would go red", () => {
    const dirty = 'contentSha256: "unavailable"';
    assert.ok(DIGEST_SENTINEL_PATTERNS[0]!.test(dirty));
  });

  it("metadata-snapshot refuses the sentinel via requireCapturedContentDigest", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "lib/svm/metadata-snapshot.ts"),
      "utf8",
    );
    assert.match(src, /FORBIDDEN_METADATA_DIGEST_SENTINEL/);
    assert.match(src, /requireCapturedContentDigest/);
    assert.match(src, /contentSha256: string \| null/);
  });
});
