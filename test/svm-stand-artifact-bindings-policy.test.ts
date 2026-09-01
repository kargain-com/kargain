/**
 * LIVE stand proofs must attest loaded BPF artifacts + git HEAD.
 *
 * Sole hash owner: svm/stand/stand-artifact-bindings.ts
 * Each imported live-* proof runner wraps its final return with
 * withStandArtifactBindings so the outer suite can pin binaries.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  STAND_PRELOAD_FIXTURES,
  STAND_PRELOAD_PROGRAMS,
  collectStandArtifactBindings,
  withStandArtifactBindings,
} from "../svm/stand/stand-artifact-bindings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAND_TEST = path.join(ROOT, "test/svm-stand.test.ts");
const STAND_DIR = path.join(ROOT, "svm/stand");
const OWNER = path.join(STAND_DIR, "stand-artifact-bindings.ts");

/** Exported LIVE proof entrypoints imported by svm-stand.test.ts. */
const LIVE_PROOF_EXPORTS = [
  "runLiveSvmRoundTrip",
  "runLiveVerifierFlow",
  "runLiveMoneyPayoutProof",
  "runLiveConsignmentAutomaton",
  "runLiveFixedPrice",
  "runLiveAscending",
] as const;

function liveProofModulesFromStandTest(): string[] {
  const src = fs.readFileSync(STAND_TEST, "utf8");
  const re = /from\s+["']\.\.\/svm\/stand\/(live-[^"']+)\.ts["']/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push(path.join(STAND_DIR, `${m[1]}.ts`));
  }
  return out;
}

function exportReturnUsesArtifactWrapper(source: string, exportName: string): boolean {
  const start = source.indexOf(`export async function ${exportName}`);
  if (start < 0) return false;
  return source.slice(start).includes("return withStandArtifactBindings(");
}

function writeStandArtifactStubs(baseDir: string, payload: Buffer): { deploy: string; fixtures: string } {
  const deploy = path.join(baseDir, "target/deploy");
  const fixtures = path.join(baseDir, "lab/fixtures");
  fs.mkdirSync(deploy, { recursive: true });
  fs.mkdirSync(fixtures, { recursive: true });
  for (const name of STAND_PRELOAD_PROGRAMS) {
    fs.writeFileSync(path.join(deploy, `${name}.so`), payload);
  }
  fs.writeFileSync(path.join(fixtures, "mpl_core_release_0.15.1.so"), payload);
  fs.writeFileSync(path.join(fixtures, "spl_noop.so"), payload);
  return { deploy, fixtures };
}

function withStandEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => T,
): T {
  const prev: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function initTempGitRepo(baseDir: string): void {
  execSync("git init", { cwd: baseDir, stdio: "ignore" });
  execSync('git config user.email "stand@test.local"', { cwd: baseDir, stdio: "ignore" });
  execSync('git config user.name "Stand Test"', { cwd: baseDir, stdio: "ignore" });
  fs.writeFileSync(path.join(baseDir, "README"), "stand artifact git fixture\n");
  fs.writeFileSync(path.join(baseDir, ".gitignore"), "target/\nlab/fixtures/\n");
  execSync("git add README .gitignore", { cwd: baseDir, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: baseDir, stdio: "ignore" });
}

describe("svm-stand-artifact-bindings-policy", () => {
  it("owner module exists and exports preload program list aligned with validator", () => {
    assert.ok(fs.existsSync(OWNER));
    assert.equal(STAND_PRELOAD_PROGRAMS.length, 10);
    assert.ok(STAND_PRELOAD_PROGRAMS.includes("kar_fixed_price"));
    assert.ok(STAND_PRELOAD_PROGRAMS.includes("kar_ascending"));
    assert.equal(STAND_PRELOAD_FIXTURES.length, 2);
  });

  it("collectStandArtifactBindings hashes a temp file deterministically", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-artifact-"));
    const payload = Buffer.from("stand-artifact-bindings-fixture");
    const { deploy, fixtures } = writeStandArtifactStubs(dir, payload);

    withStandEnv(
      {
        KARGAIN_SVM_STAND_DEPLOY_DIR: deploy,
        KARGAIN_SVM_STAND_FIXTURES_DIR: fixtures,
      },
      () => {
        const expected = createHash("sha256").update(payload).digest("hex");

        const bindings = collectStandArtifactBindings({ loadMode: "preload" });
        assert.equal(bindings.loadMode, "preload");
        assert.ok(bindings.gitHead.length >= 7);
        assert.equal(bindings.programs.kar_ascending.sha256, expected);
        assert.equal(bindings.programs.kar_ascending.bytes, payload.length);
        assert.equal(bindings.fixtures.spl_noop.sha256, expected);

        const wrapped = withStandArtifactBindings({ ok: true });
        assert.equal(wrapped.ok, true);
        assert.equal(wrapped.artifacts.programs.kar_fixed_price.sha256, expected);
      },
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("gitDirty is false on a clean temp repo and true after an uncommitted edit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-artifact-git-"));
    const payload = Buffer.from("git-dirty-fixture");
    const { deploy, fixtures } = writeStandArtifactStubs(dir, payload);
    initTempGitRepo(dir);

    withStandEnv(
      {
        KARGAIN_SVM_STAND_DEPLOY_DIR: deploy,
        KARGAIN_SVM_STAND_FIXTURES_DIR: fixtures,
        KARGAIN_SVM_STAND_GIT_ROOT: dir,
      },
      () => {
        const clean = collectStandArtifactBindings({ loadMode: "preload" });
        assert.equal(clean.gitDirty, false, "clean tree must not report dirty");

        fs.writeFileSync(path.join(dir, "uncommitted.txt"), "dirty\n");
        const dirty = collectStandArtifactBindings({ loadMode: "preload" });
        assert.equal(dirty.gitDirty, true, "uncommitted edit must report dirty");
        assert.equal(dirty.gitHead, clean.gitHead, "HEAD unchanged while dirty");
      },
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("readGitState uses porcelain only — no manual path excludes in owner", () => {
    const src = fs.readFileSync(OWNER, "utf8");
    assert.ok(src.includes("git status --porcelain"));
    assert.ok(!src.includes("next-env"));
    assert.ok(!src.includes("porcelainFilter"));
    assert.ok(!/porcelain[\s\S]{0,120}\.(filter|split|replace)\(/.test(src));
  });

  it("each imported live-* proof wraps its final return with withStandArtifactBindings", () => {
    const mods = liveProofModulesFromStandTest();
    assert.ok(mods.length >= 3);

    const missing: string[] = [];
    for (const mod of mods) {
      const src = fs.readFileSync(mod, "utf8");
      if (!src.includes("stand-artifact-bindings")) {
        missing.push(`${path.relative(ROOT, mod)}: missing stand-artifact-bindings import`);
        continue;
      }
      for (const exportName of LIVE_PROOF_EXPORTS) {
        if (!src.includes(`export async function ${exportName}`)) continue;
        if (!exportReturnUsesArtifactWrapper(src, exportName)) {
          missing.push(
            `${path.relative(ROOT, mod)}: ${exportName} must return withStandArtifactBindings(...)`,
          );
        }
      }
    }
    assert.equal(missing.join("\n"), "", missing.join("\n"));
  });

  it("stand-artifact-bindings is the sole deploy .so hasher under svm/stand", () => {
    const hits: string[] = [];
    for (const name of fs.readdirSync(STAND_DIR)) {
      if (!name.endsWith(".ts")) continue;
      const file = path.join(STAND_DIR, name);
      if (file === OWNER) continue;
      const src = fs.readFileSync(file, "utf8");
      if (/createHash\s*\(\s*["']sha256["']\s*\)[\s\S]{0,120}\.so/.test(src)) {
        hits.push(path.relative(ROOT, file));
      }
      if (/readFileSync\s*\([^)]*\.so["']/.test(src)) {
        hits.push(`${path.relative(ROOT, file)} (readFileSync .so)`);
      }
    }
    assert.deepEqual(hits, []);
  });

  it("svm-stand.test.ts asserts artifacts on LIVE path", () => {
    const src = fs.readFileSync(STAND_TEST, "utf8");
    assert.ok(src.includes("stand-artifact-bindings"));
    assert.ok(src.includes("assertStandArtifactBindings"));
  });
});
