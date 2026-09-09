/**
 * Trunk CI + deploy workflows: isolation, gates-before-SSH, verify∖CI partition.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEPLOY_MACHINE_VERIFY_SUITES,
  ciRunnableVacuousDeploymentsViolation,
  ciVerifyMembers,
  findVerifyPartitionHoles,
  isVacuousGreenOnAbsentDeploymentsSource,
  parseVerifyMembers,
} from "../lib/architecture/ci-verify-partition.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CI_WF = join(ROOT, ".github/workflows/ci.yml");
const PONDER_WF = join(ROOT, ".github/workflows/deploy-ponder.yml");
const SVM_WF = join(ROOT, ".github/workflows/deploy-svm-ingest.yml");
const PKG = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as { scripts: Record<string, string>; packageManager?: string };

function pathsBlock(yaml: string): string {
  const m = yaml.match(/paths:\n((?: {6}- .+\n)+)/);
  assert.ok(m, "workflow must declare on.push.paths");
  return m[1]!;
}

/** Deploy path must poll reserved /ready via the readiness-probe owner. */
export function ponderDeployLacksReadinessProbe(yaml: string): string | null {
  if (!/ponder-ready-probe/.test(yaml)) {
    return "deploy path lacks ponder-ready-probe readiness verification";
  }
  if (!/\/ready/.test(yaml) && !/ponder-ready-probe/.test(yaml)) {
    return "deploy path lacks /ready readiness verification";
  }
  return null;
}

/** Deploy path must skip recreate when the executable fingerprint is unchanged. */
export function ponderDeployLacksExecutableSkip(yaml: string): string | null {
  if (!/executable inputs unchanged/.test(yaml)) {
    return "deploy path lacks executable-fingerprint skip-recreate branch";
  }
  if (!/EXECUTABLE_DIGEST/.test(yaml)) {
    return "deploy path lacks EXECUTABLE_DIGEST comparison";
  }
  return null;
}

describe("deploy-ponder-svm-ingest-ci-policy", () => {
  it("ponder workflow omits svm-ingest paths and Dockerfile.svm-ingest", () => {
    const yaml = readFileSync(PONDER_WF, "utf8");
    const paths = pathsBlock(yaml);
    assert.doesNotMatch(paths, /src\/svm-ingest/);
    assert.doesNotMatch(paths, /Dockerfile\.svm-ingest/);
    assert.doesNotMatch(paths, /lib\/svm/);
    assert.match(yaml, /docker compose build ponder/);
    assert.match(yaml, /docker compose up -d ponder/);
    assert.doesNotMatch(yaml, /build svm-ingest/);
  });

  it("ponder deploy verifies readiness and skips recreate on unchanged executable", () => {
    const yaml = readFileSync(PONDER_WF, "utf8");
    assert.equal(ponderDeployLacksReadinessProbe(yaml), null);
    assert.equal(ponderDeployLacksExecutableSkip(yaml), null);
    assert.match(yaml, /ponder-deploy-fingerprints/);
    assert.match(yaml, /IDENTITY_DIGEST/);
    assert.match(
      yaml,
      /Ponder executable inputs unchanged — leaving running service alone/,
    );
    assert.match(yaml, /a reindex may be required/);
    assert.doesNotMatch(yaml, /continue-on-error/);
  });

  it("constructed: deploy YAML without readiness probe is red", () => {
    const planted = `
deploy:
  steps:
    - run: docker compose build ponder
    - run: docker compose up -d ponder
`;
    assert.equal(
      ponderDeployLacksReadinessProbe(planted),
      "deploy path lacks ponder-ready-probe readiness verification",
    );
  });

  it("constructed: deploy YAML without executable skip is red", () => {
    const planted = `
deploy:
  steps:
    - run: node --import tsx scripts/ponder-ready-probe.ts
    - run: docker compose up -d ponder
`;
    assert.equal(
      ponderDeployLacksExecutableSkip(planted),
      "deploy path lacks executable-fingerprint skip-recreate branch",
    );
  });

  it("svm-ingest workflow exists and never builds or restarts ponder", () => {
    const yaml = readFileSync(SVM_WF, "utf8");
    const paths = pathsBlock(yaml);
    assert.match(paths, /src\/svm-ingest\/\*\*/);
    assert.match(paths, /lib\/svm\/\*\*/);
    assert.match(paths, /Dockerfile\.svm-ingest/);
    assert.match(yaml, /docker compose build svm-ingest/);
    assert.match(
      yaml,
      /docker compose up -d --force-recreate svm-ingest/,
    );
    assert.doesNotMatch(yaml, /build ponder/);
    assert.doesNotMatch(yaml, /up -d ponder/);
    assert.doesNotMatch(yaml, /up -d --force-recreate ponder/);
  });

  it("Dockerfiles pin corepack pnpm@10.6.5 matching packageManager", () => {
    assert.equal(PKG.packageManager, "pnpm@10.6.5");
    for (const name of ["Dockerfile.svm-ingest", "Dockerfile.ponder"] as const) {
      const df = readFileSync(join(ROOT, name), "utf8");
      assert.match(df, /corepack enable/);
      assert.match(df, /corepack prepare pnpm@10\.6\.5 --activate/);
      assert.doesNotMatch(df, /npm install -g pnpm/);
    }
  });

  it("ci.yml exists, triggers on push to master, runs compile through build", () => {
    const yaml = readFileSync(CI_WF, "utf8");
    assert.match(yaml, /name:\s*CI/);
    assert.match(
      yaml,
      /push:\s*\n\s*branches:\s*(?:\[master\]|\n\s*-\s*master)/,
    );
    assert.match(
      yaml,
      /pull_request:\s*\n\s*branches:\s*(?:\[master\]|\n\s*-\s*master)/,
    );
    assert.match(yaml, /workflow_call:/);
    assert.match(yaml, /pnpm compile/);
    assert.match(yaml, /pnpm typecheck/);
    assert.match(yaml, /pnpm lint/);
    assert.match(yaml, /pnpm test:ci/);
    assert.match(yaml, /pnpm build/);
    assert.doesNotMatch(yaml, /appleboy\/ssh-action/);
    assert.doesNotMatch(yaml, /secrets\./);
    assert.match(yaml, /cancel-in-progress:\s*false/);
  });

  it("ci.yml Install installs svm/lab for typecheck paths", () => {
    const yaml = readFileSync(CI_WF, "utf8");
    assert.match(
      yaml,
      /pnpm --dir svm\/lab install --frozen-lockfile/,
      "CI must install svm/lab so svm/tsconfig can resolve @solana/spl-token",
    );
    assert.match(yaml, /actions\/checkout@v5/);
    assert.match(yaml, /actions\/setup-node@v5/);
  });

  it("constructed: CI Install without svm/lab is red", () => {
    const planted = `
jobs:
  gates:
    steps:
      - name: Install
        run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
`;
    assert.doesNotMatch(
      planted,
      /pnpm --dir svm\/lab install --frozen-lockfile/,
    );
    // Live policy: absence of the lab install line is the defect.
    const live = readFileSync(CI_WF, "utf8");
    assert.match(live, /pnpm --dir svm\/lab install --frozen-lockfile/);
    assert.notEqual(
      /pnpm --dir svm\/lab install --frozen-lockfile/.test(planted),
      /pnpm --dir svm\/lab install --frozen-lockfile/.test(live),
    );
  });

  it("package.json defines test:ci as the derived runner", () => {
    assert.equal(
      PKG.scripts["test:ci"],
      "node --import tsx scripts/run-test-ci.ts",
    );
  });

  it("both deploy workflows need gates that call ci.yml before SSH", () => {
    for (const [label, path] of [
      ["ponder", PONDER_WF],
      ["svm-ingest", SVM_WF],
    ] as const) {
      const yaml = readFileSync(path, "utf8");
      assert.match(
        yaml,
        /gates:\s*\n\s*uses:\s*\.\/\.github\/workflows\/ci\.yml/,
        `${label}: missing gates job uses ci.yml`,
      );
      assert.match(
        yaml,
        /deploy:\s*\n\s*needs:\s*gates/,
        `${label}: deploy must needs: gates`,
      );
      const deployIdx = yaml.indexOf("\n  deploy:");
      const sshIdx = yaml.indexOf("appleboy/ssh-action");
      assert.ok(deployIdx >= 0, `${label}: deploy job missing`);
      assert.ok(sshIdx > deployIdx, `${label}: SSH must sit under deploy job`);
    }
  });

  it("test:verify members partition into test:ci xor deploy-machine enumerator", () => {
    const holes = findVerifyPartitionHoles(PKG.scripts);
    assert.deepEqual(
      holes,
      [],
      holes.length
        ? `Partition holes:\n${holes.map((h) => `${h.file} (${h.reason})`).join("\n")}`
        : undefined,
    );
    const verify = parseVerifyMembers(PKG.scripts);
    const ci = ciVerifyMembers(PKG.scripts);
    assert.equal(
      ci.length + DEPLOY_MACHINE_VERIFY_SUITES.length,
      verify.length,
    );
    for (const m of DEPLOY_MACHINE_VERIFY_SUITES) {
      assert.equal(ci.includes(m), false, `CI must not include ${m}`);
      assert.ok(verify.includes(m), `enumerator member must be in test:verify: ${m}`);
    }
  });

  it("constructed: CI-runnable vacuous-green on absent deployments is red", () => {
    const planted = `
import { existsSync } from "node:fs";
import { join } from "node:path";
it("vacuous", () => {
  if (!existsSync(join(ROOT, "deployments"))) return;
  assert.equal(1, 0);
});
`;
    assert.equal(isVacuousGreenOnAbsentDeploymentsSource(planted), true);
    assert.equal(
      ciRunnableVacuousDeploymentsViolation({
        source: planted,
        declaredCiRunnable: true,
      }),
      "CI-runnable suite passes vacuously when deployments/ is absent",
    );
    assert.equal(
      ciRunnableVacuousDeploymentsViolation({
        source: planted,
        declaredCiRunnable: false,
      }),
      null,
    );
  });

  it("live CI members are not vacuous-green on absent deployments", () => {
    for (const rel of ciVerifyMembers(PKG.scripts)) {
      // This suite embeds planted fixtures for instrument 5.
      if (rel === "test/deploy-ponder-svm-ingest-ci-policy.test.ts") continue;
      const source = readFileSync(join(ROOT, rel), "utf8");
      assert.equal(
        ciRunnableVacuousDeploymentsViolation({
          source,
          declaredCiRunnable: true,
        }),
        null,
        `${rel} must not be vacuous-green on absent deployments/`,
      );
    }
  });

  it("constructed partition hole (in neither) is detected", () => {
    const scripts = {
      "test:verify":
        "node --import tsx --test test/a.test.ts test/commercial-active-manifest-policy.test.ts test/orphan.test.ts",
    };
    // Force ci members to exclude orphan by pretending orphan is not filtered —
    // findVerifyPartitionHoles uses real enumerator; orphan is in verify, not in
    // enumerator, and would be in ci. Plant in_both instead:
    const both = findVerifyPartitionHoles({
      "test:verify":
        "node --import tsx --test test/commercial-active-manifest-policy.test.ts",
    });
    // Only machine suite in verify → ci empty for that file, machine has it → ok partition.
    assert.deepEqual(both, []);

    // Inject a fake verify list via monkey: call find with a script that lists
    // a file that is neither in derived ci (because we add it only to verify
    // after filtering) — actually ciVerifyMembers = verify - machine, so any
    // non-machine verify file is always in ci. True "in neither" requires an
    // enumerator member missing from verify:
    const holes = findVerifyPartitionHoles({
      "test:verify": "node --import tsx --test test/a.test.ts",
    });
    assert.ok(
      holes.some(
        (h) =>
          h.file === "test/commercial-active-manifest-policy.test.ts" &&
          h.reason === "in_neither",
      ),
      "enumerator member absent from verify must be in_neither",
    );
  });
});
