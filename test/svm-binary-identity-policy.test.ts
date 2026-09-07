/**
 * Sole owner: ProgramData ELF ↔ evidence digest compare lives only in
 * scripts/lib/assert-svm-binary-identity.ts. Fixtures must not copy live
 * deployments/svm-*.json. CLI uses JSON-RPC only (no keypair / program show).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = path.join(ROOT, "scripts/lib/assert-svm-binary-identity.ts");
const CLI = path.join(ROOT, "scripts/assert-svm-binary-identity.ts");

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

describe("svm-binary-identity policy", () => {
  it("compareProgramDataElfToArtifact / assertSvmBinaryIdentity only exported from owner", () => {
    const ownerSrc = fs.readFileSync(OWNER, "utf8");
    assert.match(ownerSrc, /export function compareProgramDataElfToArtifact/);
    assert.match(ownerSrc, /export async function assertSvmBinaryIdentity/);

    const hits: string[] = [];
    for (const root of ["scripts", "lib", "src", "test"]) {
      const files: string[] = [];
      walkTs(path.join(ROOT, root), files);
      for (const file of files) {
        if (file === OWNER) continue;
        if (file.endsWith("assert-svm-binary-identity.test.ts")) continue;
        if (file.endsWith("svm-binary-identity-policy.test.ts")) continue;
        if (file === CLI) continue;
        const text = fs.readFileSync(file, "utf8");
        if (
          /function compareProgramDataElfToArtifact\b/.test(text) ||
          /function assertSvmBinaryIdentity\b/.test(text)
        ) {
          hits.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(hits, [], `second compare door:\n${hits.join("\n")}`);
  });

  it("CLI uses postSolanaJsonRpc getAccountInfo; no program show / keypair", () => {
    const cli = fs.readFileSync(CLI, "utf8");
    // Strip block + line comments so doc prose cannot trip executable bans.
    const code = cli
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /postSolanaJsonRpc/);
    assert.match(code, /getAccountInfo/);
    assert.doesNotMatch(code, /program["\s]+show/);
    assert.doesNotMatch(code, /--keypair/);
    assert.doesNotMatch(code, /solana config/);
    assert.doesNotMatch(code, /spawnSync/);
  });

  it("fixtures never copy live deployments/svm-*.json", () => {
    const fixtureDir = path.join(ROOT, "test/fixtures");
    const hits: string[] = [];
    if (fs.existsSync(fixtureDir)) {
      const files: string[] = [];
      walkTs(fixtureDir, files);
      for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        if (/deployments\/svm-\d+\.json/.test(text)) {
          hits.push(path.relative(ROOT, file));
        }
      }
    }
    const testFile = path.join(ROOT, "test/assert-svm-binary-identity.test.ts");
    const testSrc = fs.readFileSync(testFile, "utf8");
    assert.doesNotMatch(testSrc, /deployments\/svm-\d+\.json/);
    assert.deepEqual(hits, []);
  });

  it("package.json exposes verify:svm-binary-identity beside verify:svm-authority", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    assert.equal(
      pkg.scripts["verify:svm-binary-identity"],
      "node --import tsx scripts/assert-svm-binary-identity.ts",
    );
    assert.match(
      pkg.scripts["test:verify"] ?? "",
      /assert-svm-binary-identity\.test\.ts/,
    );
    assert.match(
      pkg.scripts["test:verify"] ?? "",
      /svm-binary-identity-policy\.test\.ts/,
    );
  });
});
