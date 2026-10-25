/**
 * VPS deploy secrets and triggers: secrets context locality, allowlisted
 * events, gates via reusable ci.yml before deploy.
 * Negative controls plant under a temporary .github/ copy — never the live tree.
 */
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GITHUB_DIR = ".github";
const WORKFLOWS_DIR = join(GITHUB_DIR, "workflows");

const ALLOWED_DEPLOY_WORKFLOW_PATHS = new Set([
  ".github/workflows/deploy-ponder.yml",
  ".github/workflows/deploy-svm-ingest.yml",
]);
const ALLOWED_TRIGGERS = new Set(["push", "workflow_dispatch"]);
const ALLOWED_PUSH_KEYS = new Set(["branches", "paths", "paths-ignore"]);
const GATES_USES = "./.github/workflows/ci.yml";

/** secrets as a context identifier inside ${{ … }} (case-insensitive). */
const SECRETS_CONTEXT_IN_EXPR =
  /(^|[^A-Za-z0-9_])secrets(?=[^A-Za-z0-9_]|$)/i;
const EXPR_RE = /\$\{\{([\s\S]*?)\}\}/g;

type YamlDoc = Record<string, unknown>;

type LoadResult =
  | { ok: true; doc: YamlDoc }
  | { ok: false; reason: string };

function githubRoot(repoRoot: string): string {
  return join(repoRoot, GITHUB_DIR);
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function isYamlPath(filePath: string): boolean {
  return filePath.endsWith(".yml") || filePath.endsWith(".yaml");
}

function toPosixRel(repoRoot: string, abs: string): string {
  return relative(repoRoot, abs).split("\\").join("/");
}

function loadYamlFile(filePath: string): LoadResult {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  let doc: unknown;
  try {
    doc = yaml.load(raw);
  } catch {
    return { ok: false, reason: "parse error" };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, reason: "non-mapping document" };
  }
  return { ok: true, doc: doc as YamlDoc };
}

function stringReferencesSecretsContext(s: string): boolean {
  EXPR_RE.lastIndex = 0;
  for (const m of s.matchAll(EXPR_RE)) {
    if (SECRETS_CONTEXT_IN_EXPR.test(m[1]!)) return true;
  }
  return false;
}

function valueReferencesSecretsContext(value: unknown): boolean {
  if (typeof value === "string") return stringReferencesSecretsContext(value);
  if (Array.isArray(value)) {
    return value.some(valueReferencesSecretsContext);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      valueReferencesSecretsContext,
    );
  }
  return false;
}

function jobHasSecretsKey(job: Record<string, unknown>): boolean {
  return Object.keys(job).some((k) => k.toLowerCase() === "secrets");
}

function secretUseAllowed(relPath: string, jobId: string): boolean {
  return ALLOWED_DEPLOY_WORKFLOW_PATHS.has(relPath) && jobId === "deploy";
}

/**
 * The secrets context and job-level secrets: may appear only inside
 * jobs.deploy of the two deploy workflow paths.
 */
export function vpsSecretLocalityViolations(repoRoot: string): string[] {
  const gh = githubRoot(repoRoot);
  const violations: string[] = [];
  const seen = new Set<string>();

  function add(msg: string): void {
    if (!seen.has(msg)) {
      seen.add(msg);
      violations.push(msg);
    }
  }

  for (const abs of listFilesRecursive(gh)) {
    if (!isYamlPath(abs)) continue;
    const rel = toPosixRel(repoRoot, abs);
    const loaded = loadYamlFile(abs);
    if (!loaded.ok) {
      add(`secrets check fail-closed (${loaded.reason}): ${rel}`);
      continue;
    }
    const doc = loaded.doc;

    // Non-job strings that reference secrets (workflow-level env, etc.).
    for (const [key, value] of Object.entries(doc)) {
      if (key === "jobs") continue;
      if (valueReferencesSecretsContext(value)) {
        add(`secrets context outside allowed deploy jobs: ${rel}`);
      }
    }

    const jobs = doc.jobs;
    if (jobs === undefined) continue;
    if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) {
      add(`secrets check fail-closed (jobs not a mapping): ${rel}`);
      continue;
    }

    for (const [jobId, jobVal] of Object.entries(
      jobs as Record<string, unknown>,
    )) {
      if (!jobVal || typeof jobVal !== "object" || Array.isArray(jobVal)) {
        continue;
      }
      const job = jobVal as Record<string, unknown>;
      const allowed = secretUseAllowed(rel, jobId);
      if (jobHasSecretsKey(job) && !allowed) {
        add(`secrets: key outside allowed deploy jobs: ${rel}`);
      }
      if (valueReferencesSecretsContext(job) && !allowed) {
        add(`secrets context outside allowed deploy jobs: ${rel}`);
      }
    }
  }
  return violations;
}

function pushBranchList(push: unknown): string[] | null {
  if (push === null || push === undefined) return null;
  if (typeof push !== "object" || Array.isArray(push)) return null;
  const branches = (push as Record<string, unknown>).branches;
  if (typeof branches === "string") return [branches];
  if (Array.isArray(branches)) return branches.map(String);
  return null;
}

function checkPushConfig(
  label: string,
  push: unknown,
  violations: string[],
): void {
  if (push === null || push === undefined || typeof push !== "object") {
    violations.push(`${label} push trigger lacks branch filter`);
    return;
  }
  if (Array.isArray(push)) {
    violations.push(`${label} push trigger lacks branch filter`);
    return;
  }
  const cfg = push as Record<string, unknown>;
  for (const key of Object.keys(cfg)) {
    if (!ALLOWED_PUSH_KEYS.has(key)) {
      violations.push(`${label} push trigger forbids key ${key}`);
    }
  }
  const branches = pushBranchList(push);
  if (!branches || branches.length !== 1 || branches[0] !== "master") {
    violations.push(`${label} push trigger must target only master`);
  }
}

function checkOnEvent(
  label: string,
  event: string,
  config: unknown,
  violations: string[],
): void {
  if (!ALLOWED_TRIGGERS.has(event)) {
    violations.push(`${label} declares forbidden trigger ${event}`);
    return;
  }
  if (event === "push") {
    checkPushConfig(label, config, violations);
  }
}

/**
 * Deploy workflows may only use push→master and/or workflow_dispatch.
 * on.push keys ⊆ {branches, paths, paths-ignore}; branches exactly [master].
 */
export function deployTriggerViolations(repoRoot: string): string[] {
  const violations: string[] = [];
  for (const rel of ALLOWED_DEPLOY_WORKFLOW_PATHS) {
    const abs = join(repoRoot, rel);
    const label = rel.split("/").pop()!;
    if (!existsSync(abs)) {
      violations.push(`${label} missing`);
      continue;
    }
    const loaded = loadYamlFile(abs);
    if (!loaded.ok) {
      violations.push(`${label} fail-closed (${loaded.reason})`);
      continue;
    }
    const on = loaded.doc.on;
    if (typeof on === "string") {
      checkOnEvent(label, on, null, violations);
      continue;
    }
    if (Array.isArray(on)) {
      for (const item of on) {
        if (typeof item !== "string") {
          violations.push(`${label} missing on:`);
          continue;
        }
        checkOnEvent(label, item, null, violations);
      }
      continue;
    }
    if (!on || typeof on !== "object") {
      violations.push(`${label} missing on:`);
      continue;
    }
    const events = on as Record<string, unknown>;
    for (const [event, config] of Object.entries(events)) {
      checkOnEvent(label, event, config, violations);
    }
  }
  return violations;
}

function needsIncludesGates(needs: unknown): boolean {
  if (typeof needs === "string") return needs === "gates";
  if (Array.isArray(needs)) return needs.map(String).includes("gates");
  return false;
}

function gatesJobExact(gates: unknown): boolean {
  if (!gates || typeof gates !== "object" || Array.isArray(gates)) return false;
  const keys = Object.keys(gates as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "uses") return false;
  return (gates as Record<string, unknown>).uses === GATES_USES;
}

function jobHasIfKey(job: Record<string, unknown>): boolean {
  return Object.keys(job).some((k) => k.toLowerCase() === "if");
}

/**
 * Each deploy workflow: gates is exactly reusable ci.yml; deploy needs gates
 * and has no if.
 */
export function deployGatesViolations(repoRoot: string): string[] {
  const violations: string[] = [];
  for (const rel of ALLOWED_DEPLOY_WORKFLOW_PATHS) {
    const abs = join(repoRoot, rel);
    const label = rel.split("/").pop()!;
    if (!existsSync(abs)) {
      violations.push(`${label} missing`);
      continue;
    }
    const loaded = loadYamlFile(abs);
    if (!loaded.ok) {
      violations.push(`${label} fail-closed (${loaded.reason})`);
      continue;
    }
    const jobs = loaded.doc.jobs;
    if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) {
      violations.push(`${label} gates job must be exactly uses ci.yml`);
      violations.push(`${label} deploy job missing needs: gates`);
      continue;
    }
    const jobMap = jobs as Record<string, unknown>;
    if (!gatesJobExact(jobMap.gates)) {
      violations.push(`${label} gates job must be exactly uses ci.yml`);
    }
    const deploy = jobMap.deploy;
    if (!deploy || typeof deploy !== "object" || Array.isArray(deploy)) {
      violations.push(`${label} deploy job missing needs: gates`);
      continue;
    }
    const deployJob = deploy as Record<string, unknown>;
    if (!needsIncludesGates(deployJob.needs)) {
      violations.push(`${label} deploy job missing needs: gates`);
    }
    if (jobHasIfKey(deployJob)) {
      violations.push(`${label} deploy job must not set if`);
    }
  }
  return violations;
}

/** @deprecated alias — prefer deployGatesViolations */
export function deployNeedsGatesViolations(repoRoot: string): string[] {
  return deployGatesViolations(repoRoot);
}

function withTempGithub(
  mutate: (tmpRepo: string) => void,
  run: (tmpRepo: string) => void,
): void {
  const tmpRepo = mkdtempSync(join(tmpdir(), "kargain-gh-"));
  try {
    cpSync(join(ROOT, GITHUB_DIR), join(tmpRepo, GITHUB_DIR), {
      recursive: true,
    });
    mutate(tmpRepo);
    run(tmpRepo);
  } finally {
    rmSync(tmpRepo, { recursive: true, force: true });
  }
}

function writePlantedWorkflow(tmp: string, name: string, body: string): void {
  writeFileSync(join(tmp, WORKFLOWS_DIR, name), body);
}

function loadDeployPonder(tmp: string): { abs: string; doc: YamlDoc } {
  const abs = join(tmp, ".github/workflows/deploy-ponder.yml");
  const loaded = loadYamlFile(abs);
  assert.equal(loaded.ok, true, "live deploy-ponder.yml must parse");
  return { abs, doc: (loaded as { ok: true; doc: YamlDoc }).doc };
}

describe("deploy-vps-secret-policy", () => {
  it("live .github keeps secrets context inside deploy jobs only", () => {
    assert.deepEqual(vpsSecretLocalityViolations(ROOT), []);
  });

  it("live deploy workflows allow only push to master and workflow_dispatch", () => {
    assert.deepEqual(deployTriggerViolations(ROOT), []);
  });

  it("live deploy jobs need exact gates via ci.yml and no if", () => {
    assert.deepEqual(deployGatesViolations(ROOT), []);
  });

  it("constructed: secrets.VPS_ under pull_request_target is red", () => {
    withTempGithub(
      (tmp) => {
        writePlantedWorkflow(
          tmp,
          "plant-pr-target.yml",
          `name: planted-vps-secret-leak
on:
  pull_request_target:
jobs:
  steal:
    runs-on: ubuntu-latest
    steps:
      - name: leak
        run: echo "\${{ secrets.VPS_SSH_KEY }}"
`,
        );
      },
      (tmp) => {
        const hits = vpsSecretLocalityViolations(tmp);
        assert.ok(
          hits.includes(
            "secrets context outside allowed deploy jobs: .github/workflows/plant-pr-target.yml",
          ),
          "secrets context outside allowed deploy jobs: .github/workflows/plant-pr-target.yml",
        );
      },
    );
    assert.deepEqual(vpsSecretLocalityViolations(ROOT), []);
  });

  it("constructed: lowercase secrets.vps_ssh_key is red", () => {
    withTempGithub(
      (tmp) => {
        writePlantedWorkflow(
          tmp,
          "plant-secrets-case.yml",
          `name: planted-case
on:
  pull_request_target:
jobs:
  steal:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.vps_ssh_key }}"
`,
        );
      },
      (tmp) => {
        const hits = vpsSecretLocalityViolations(tmp);
        assert.ok(
          hits.includes(
            "secrets context outside allowed deploy jobs: .github/workflows/plant-secrets-case.yml",
          ),
          "secrets context outside allowed deploy jobs: .github/workflows/plant-secrets-case.yml",
        );
      },
    );
  });

  it("constructed: secrets['VPS_SSH_KEY'] is red", () => {
    withTempGithub(
      (tmp) => {
        writePlantedWorkflow(
          tmp,
          "plant-secrets-bracket.yml",
          `name: planted-bracket
on:
  pull_request_target:
jobs:
  steal:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets['VPS_SSH_KEY'] }}"
`,
        );
      },
      (tmp) => {
        const hits = vpsSecretLocalityViolations(tmp);
        assert.ok(
          hits.includes(
            "secrets context outside allowed deploy jobs: .github/workflows/plant-secrets-bracket.yml",
          ),
          "secrets context outside allowed deploy jobs: .github/workflows/plant-secrets-bracket.yml",
        );
      },
    );
  });

  it("constructed: toJSON(secrets) is red", () => {
    withTempGithub(
      (tmp) => {
        writePlantedWorkflow(
          tmp,
          "plant-secrets-tojson.yml",
          `name: planted-tojson
on:
  pull_request_target:
jobs:
  steal:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ toJSON(secrets) }}"
`,
        );
      },
      (tmp) => {
        const hits = vpsSecretLocalityViolations(tmp);
        assert.ok(
          hits.includes(
            "secrets context outside allowed deploy jobs: .github/workflows/plant-secrets-tojson.yml",
          ),
          "secrets context outside allowed deploy jobs: .github/workflows/plant-secrets-tojson.yml",
        );
      },
    );
  });

  it("constructed: secrets: inherit on a non-deploy job is red", () => {
    withTempGithub(
      (tmp) => {
        writePlantedWorkflow(
          tmp,
          "plant-secrets-inherit.yml",
          `name: planted-inherit
on:
  pull_request_target:
jobs:
  steal:
    uses: octo-org/example/.github/workflows/called.yml@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    secrets: inherit
`,
        );
      },
      (tmp) => {
        const hits = vpsSecretLocalityViolations(tmp);
        assert.ok(
          hits.includes(
            "secrets: key outside allowed deploy jobs: .github/workflows/plant-secrets-inherit.yml",
          ),
          "secrets: key outside allowed deploy jobs: .github/workflows/plant-secrets-inherit.yml",
        );
      },
    );
  });

  it("constructed: workflow_run on deploy-ponder.yml is red", () => {
    withTempGithub(
      (tmp) => {
        const { abs, doc } = loadDeployPonder(tmp);
        const on =
          doc.on && typeof doc.on === "object" && !Array.isArray(doc.on)
            ? (doc.on as Record<string, unknown>)
            : {};
        on.workflow_run = {
          workflows: ["CI"],
          types: ["completed"],
        };
        doc.on = on;
        writeFileSync(abs, yaml.dump(doc));
      },
      (tmp) => {
        const hits = deployTriggerViolations(tmp);
        assert.ok(
          hits.includes("deploy-ponder.yml declares forbidden trigger workflow_run"),
          "deploy-ponder.yml declares forbidden trigger workflow_run",
        );
      },
    );
    assert.deepEqual(deployTriggerViolations(ROOT), []);
  });

  it("constructed: push.tags on deploy-ponder.yml is red", () => {
    withTempGithub(
      (tmp) => {
        const { abs, doc } = loadDeployPonder(tmp);
        const on = doc.on as Record<string, unknown>;
        const push = on.push as Record<string, unknown>;
        push.tags = ["*"];
        writeFileSync(abs, yaml.dump(doc));
      },
      (tmp) => {
        const hits = deployTriggerViolations(tmp);
        assert.ok(
          hits.includes("deploy-ponder.yml push trigger forbids key tags"),
          "deploy-ponder.yml push trigger forbids key tags",
        );
      },
    );
  });

  it("constructed: on sequence [push] without branch filter is red", () => {
    withTempGithub(
      (tmp) => {
        const { abs, doc } = loadDeployPonder(tmp);
        doc.on = ["push"];
        writeFileSync(abs, yaml.dump(doc));
      },
      (tmp) => {
        const hits = deployTriggerViolations(tmp);
        assert.ok(
          hits.includes("deploy-ponder.yml push trigger lacks branch filter"),
          "deploy-ponder.yml push trigger lacks branch filter",
        );
      },
    );
  });

  it("constructed: deploy job without needs: gates is red", () => {
    withTempGithub(
      (tmp) => {
        const { abs, doc } = loadDeployPonder(tmp);
        const jobs = doc.jobs as Record<string, unknown>;
        const deploy = jobs.deploy as Record<string, unknown>;
        delete deploy.needs;
        writeFileSync(abs, yaml.dump(doc));
      },
      (tmp) => {
        const hits = deployGatesViolations(tmp);
        assert.ok(
          hits.includes("deploy-ponder.yml deploy job missing needs: gates"),
          "deploy-ponder.yml deploy job missing needs: gates",
        );
      },
    );
    assert.deepEqual(deployGatesViolations(ROOT), []);
  });

  it("constructed: deploy job if: always() is red", () => {
    withTempGithub(
      (tmp) => {
        const { abs, doc } = loadDeployPonder(tmp);
        const jobs = doc.jobs as Record<string, unknown>;
        const deploy = jobs.deploy as Record<string, unknown>;
        deploy.if = "always()";
        writeFileSync(abs, yaml.dump(doc));
      },
      (tmp) => {
        const hits = deployGatesViolations(tmp);
        assert.ok(
          hits.includes("deploy-ponder.yml deploy job must not set if"),
          "deploy-ponder.yml deploy job must not set if",
        );
      },
    );
  });

  it("constructed: no-op gates job is red", () => {
    withTempGithub(
      (tmp) => {
        const { abs, doc } = loadDeployPonder(tmp);
        const jobs = doc.jobs as Record<string, unknown>;
        jobs.gates = { "runs-on": "ubuntu-latest", steps: [] };
        writeFileSync(abs, yaml.dump(doc));
      },
      (tmp) => {
        const hits = deployGatesViolations(tmp);
        assert.ok(
          hits.includes("deploy-ponder.yml gates job must be exactly uses ci.yml"),
          "deploy-ponder.yml gates job must be exactly uses ci.yml",
        );
      },
    );
  });

  it("constructed: deploy-ponder.yml outside workflows/ is red", () => {
    withTempGithub(
      (tmp) => {
        const dir = join(tmp, ".github/ISSUE_TEMPLATE");
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, "deploy-ponder.yml"),
          `name: planted-basename
on:
  pull_request_target:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.VPS_SSH_KEY }}"
`,
        );
      },
      (tmp) => {
        const hits = vpsSecretLocalityViolations(tmp);
        assert.ok(
          hits.includes(
            "secrets context outside allowed deploy jobs: .github/ISSUE_TEMPLATE/deploy-ponder.yml",
          ),
          "secrets context outside allowed deploy jobs: .github/ISSUE_TEMPLATE/deploy-ponder.yml",
        );
      },
    );
  });
});
