/**
 * S5 prove must mint to a durable `--passport-owner` pubkey — never
 * `Keypair.generate()` for the passport owner (shredded work-dir keys leave
 * permanent raw rows owned by nobody). Ephemeral verifier generate remains legal.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROVE = path.join(ROOT, "scripts/svm-s5-init-and-prove.ts");
const BASH = path.join(ROOT, "svm/scripts/deploy-s5-staking.sh");

const OWNER_ARG = 'arg("--passport-owner")';
const OWNER_GENERATE = /const\s+owner\s*=\s*Keypair\.generate\s*\(/;
const VERIFIER_GENERATE = /const\s+verifier\s*=\s*Keypair\.generate\s*\(/;

function assertDurableOwnerPolicy(source: string): void {
  assert.ok(
    source.includes(OWNER_ARG),
    "svm-s5-init-and-prove must require arg(\"--passport-owner\")",
  );
  assert.ok(
    !OWNER_GENERATE.test(source),
    "mint owner must not be Keypair.generate() — use durable --passport-owner",
  );
  assert.ok(
    VERIFIER_GENERATE.test(source),
    "ephemeral verifier Keypair.generate() must remain (distinct from mint owner)",
  );
}

describe("svm-s5 passport owner policy", () => {
  it("prove script requires --passport-owner and never generates the mint owner", () => {
    const source = fs.readFileSync(PROVE, "utf8");
    assertDurableOwnerPolicy(source);
  });

  it("deploy-s5-staking.sh requires PASSPORT_OWNER_PUBKEY and passes --passport-owner", () => {
    const sh = fs.readFileSync(BASH, "utf8");
    assert.ok(
      sh.includes("PASSPORT_OWNER_PUBKEY"),
      "bash wrapper must require PASSPORT_OWNER_PUBKEY",
    );
    assert.ok(
      sh.includes("--passport-owner"),
      "bash wrapper must pass --passport-owner",
    );
  });

  it("constructed dirty fixture (ephemeral mint owner) is refused", () => {
    const clean = fs.readFileSync(PROVE, "utf8");
    assertDurableOwnerPolicy(clean);

    const dirty = clean
      .replace(OWNER_ARG, '/* removed */ "missing"')
      .replace(
        VERIFIER_GENERATE,
        "const owner = Keypair.generate();\n  const verifier = Keypair.generate(",
      );
    assert.throws(
      () => assertDurableOwnerPolicy(dirty),
      /passport-owner|Keypair\.generate/,
      "dirty fixture that mints to Keypair.generate owner must fail the policy",
    );
  });
});
