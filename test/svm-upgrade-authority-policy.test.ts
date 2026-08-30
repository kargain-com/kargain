/**
 * Ban `--skip-new-upgrade-authority-signer-check` in executable trees.
 * Historical abandon prose may name the flag in docs/ only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertSolanaUpgradeAuthorityMatchesDeployer,
} from "../scripts/lib/svm-deploy-plan.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_FLAG = "--skip-new-upgrade-authority-signer-check";

const SCAN_ROOTS = [
  path.join(ROOT, "scripts"),
  path.join(ROOT, "svm"),
] as const;

function listExecutableFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "target" || entry.name === "node_modules") continue;
      out.push(...listExecutableFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|sh)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("svm upgrade-authority policy", () => {
  it(`bans ${SKIP_FLAG} in scripts/ and svm/ *.ts|*.sh`, () => {
    const hits: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of listExecutableFiles(root)) {
        const text = fs.readFileSync(file, "utf8");
        if (text.includes(SKIP_FLAG)) {
          hits.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(
      hits,
      [],
      `skip-signer flag forbidden in executable trees:\n${hits.join("\n")}`,
    );
  });

  it("bans set-upgrade-authority in product deploy/prove scripts (lab A→B excepted)", () => {
    const allow = new Set([
      path.join(ROOT, "svm/scripts/prove-upgradeable-deploy.sh"),
    ]);
    const hits: string[] = [];
    const roots = [
      path.join(ROOT, "scripts"),
      path.join(ROOT, "svm/scripts"),
    ];
    for (const root of roots) {
      for (const file of listExecutableFiles(root)) {
        if (allow.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (/set-upgrade-authority/.test(text)) {
          hits.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(
      hits,
      [],
      `set-upgrade-authority only allowed in prove-upgradeable-deploy.sh:\n${hits.join("\n")}`,
    );
  });

  it("pins env UA ≡ deployer helper", () => {
    assert.equal(
      assertSolanaUpgradeAuthorityMatchesDeployer("Abc", {
        SOLANA_UPGRADE_AUTHORITY: "Abc",
      }),
      "Abc",
    );
    assert.throws(
      () =>
        assertSolanaUpgradeAuthorityMatchesDeployer("Abc", {
          SOLANA_UPGRADE_AUTHORITY: "Xyz",
        }),
      /≠ deployer/,
    );
  });
});
