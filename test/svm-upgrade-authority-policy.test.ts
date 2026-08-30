/**
 * Ban `--skip-new-upgrade-authority-signer-check` in executable trees.
 * Env UA ≡ deployer: one owner (`assertSolanaUpgradeAuthorityMatchesDeployer`);
 * refuse any read of `SOLANA_UPGRADE_AUTHORITY` outside the owner module and its CLI
 * (WORKING-METHOD §6 — pin the rule, not a spelling; no allowlist).
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
const OWNER_MODULE = path.join(ROOT, "scripts/lib/svm-deploy-plan.ts");
const OWNER_CLI = path.join(ROOT, "scripts/assert-solana-ua-matches-deployer.ts");
const OWNER_SYMBOL = "assertSolanaUpgradeAuthorityMatchesDeployer";
const OWNER_CLI_INVOKE = "assert-solana-ua-matches-deployer";

const SCAN_ROOTS = [
  path.join(ROOT, "scripts"),
  path.join(ROOT, "svm"),
] as const;

/** Raw env reads — any of these outside owner+CLI is a second door. */
const ENV_READ_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /process\.env\.SOLANA_UPGRADE_AUTHORITY\b/, label: "process.env.SOLANA_UPGRADE_AUTHORITY" },
  { re: /\benv\.SOLANA_UPGRADE_AUTHORITY\b/, label: "env.SOLANA_UPGRADE_AUTHORITY" },
  { re: /\$\{SOLANA_UPGRADE_AUTHORITY[:?]?/, label: "${SOLANA_UPGRADE_AUTHORITY…}" },
  { re: /\$SOLANA_UPGRADE_AUTHORITY\b/, label: "$SOLANA_UPGRADE_AUTHORITY" },
];

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

function stripComments(text: string, file: string): string {
  if (file.endsWith(".sh")) {
    return text
      .split("\n")
      .map((line) => {
        const i = line.indexOf("#");
        return i >= 0 ? line.slice(0, i) : line;
      })
      .join("\n");
  }
  // TS: drop // lines and /* */ blocks (good enough for env-read hunt)
  let s = text.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");
  return s;
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

  it("owner exists and is reached from dry-run, CLI, prove, and both live bash scripts", () => {
    assert.ok(fs.existsSync(OWNER_MODULE), "owner module missing");
    assert.ok(fs.existsSync(OWNER_CLI), "owner CLI missing");

    const ownerText = fs.readFileSync(OWNER_MODULE, "utf8");
    assert.match(ownerText, new RegExp(`export function ${OWNER_SYMBOL}`));

    const cliText = fs.readFileSync(OWNER_CLI, "utf8");
    assert.ok(
      cliText.includes(OWNER_SYMBOL),
      "CLI must call assertSolanaUpgradeAuthorityMatchesDeployer",
    );

    const consumers: { file: string; needle: string }[] = [
      {
        file: path.join(ROOT, "scripts/svm-deploy.ts"),
        needle: OWNER_SYMBOL,
      },
      {
        file: path.join(ROOT, "scripts/svm-s5-init-and-prove.ts"),
        needle: OWNER_SYMBOL,
      },
      {
        file: path.join(ROOT, "svm/scripts/deploy-devnet.sh"),
        needle: OWNER_CLI_INVOKE,
      },
      {
        file: path.join(ROOT, "svm/scripts/deploy-s5-staking.sh"),
        needle: OWNER_CLI_INVOKE,
      },
    ];
    for (const { file, needle } of consumers) {
      const text = fs.readFileSync(file, "utf8");
      assert.ok(
        text.includes(needle),
        `${path.relative(ROOT, file)} must reach owner via ${needle}`,
      );
    }
  });

  it("refuses any SOLANA_UPGRADE_AUTHORITY env read outside owner module and CLI", () => {
    const allowed = new Set([OWNER_MODULE, OWNER_CLI]);
    const hits: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of listExecutableFiles(root)) {
        if (allowed.has(file)) continue;
        const code = stripComments(fs.readFileSync(file, "utf8"), file);
        for (const { re, label } of ENV_READ_PATTERNS) {
          if (re.test(code)) {
            hits.push(`${path.relative(ROOT, file)} (${label})`);
          }
        }
      }
    }
    assert.deepEqual(
      hits,
      [],
      `unowned SOLANA_UPGRADE_AUTHORITY reads:\n${hits.join("\n")}`,
    );
  });
});
