/**
 * VPS deploy secrets and triggers: locality, allowlisted events, needs: gates.
 * Negative controls plant under a temporary .github/ copy — never the live tree.
 */
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
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

const ALLOWED_DEPLOY_WORKFLOWS = new Set([
  "deploy-ponder.yml",
  "deploy-svm-ingest.yml",
]);
const ALLOWED_TRIGGERS = new Set(["push", "workflow_dispatch"]);
const VPS_SECRET_MARKER = "secrets.VPS_";

type YamlDoc = Record<string, unknown>;

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

function loadYamlFile(filePath: string): YamlDoc {
  const raw = readFileSync(filePath, "utf8");
  const doc = yaml.load(raw);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return {};
  }
  return doc as YamlDoc;
}

/** Collect dotted paths whose string values contain secrets.VPS_. */
function collectVpsSecretPaths(
  value: unknown,
  path: readonly string[] = [],
): string[] {
  if (typeof value === "string") {
    return value.includes(VPS_SECRET_MARKER) ? [path.join(".") || "(root)"] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) =>
      collectVpsSecretPaths(item, [...path, String(i)]),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      collectVpsSecretPaths(v, [...path, k]),
    );
  }
  return [];
}

function secretPathAllowed(fileName: string, dottedPath: string): boolean {
  if (!ALLOWED_DEPLOY_WORKFLOWS.has(fileName)) return false;
  return dottedPath === "jobs.deploy" || dottedPath.startsWith("jobs.deploy.");
}

/**
 * secrets.VPS_ may appear only inside jobs.deploy of the two deploy workflows.
 * Returns human-readable violation lines (empty = green).
 */
export function vpsSecretLocalityViolations(repoRoot: string): string[] {
  const gh = githubRoot(repoRoot);
  const violations: string[] = [];
  for (const abs of listFilesRecursive(gh)) {
    const rel = relative(repoRoot, abs).split("\\").join("/");
    const base = abs.split(/[/\\]/).pop() ?? abs;
    if (!isYamlPath(abs)) {
      const text = readFileSync(abs, "utf8");
      if (text.includes(VPS_SECRET_MARKER)) {
        violations.push(
          `secrets.VPS_ outside allowed deploy jobs: ${rel}`,
        );
      }
      continue;
    }
    const doc = loadYamlFile(abs);
    for (const dotted of collectVpsSecretPaths(doc)) {
      if (!secretPathAllowed(base, dotted)) {
        violations.push(
          `secrets.VPS_ outside allowed deploy jobs: ${rel}`,
        );
        break;
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

/**
 * Deploy workflows may only use push→master and/or workflow_dispatch.
 */
export function deployTriggerViolations(repoRoot: string): string[] {
  const violations: string[] = [];
  for (const name of ALLOWED_DEPLOY_WORKFLOWS) {
    const abs = join(repoRoot, WORKFLOWS_DIR, name);
    if (!existsSync(abs)) {
      violations.push(`${name} missing`);
      continue;
    }
    const doc = loadYamlFile(abs);
    const on = doc.on;
    if (typeof on === "string") {
      if (on === "workflow_dispatch") continue;
      violations.push(`${name} declares forbidden trigger ${on}`);
      continue;
    }
    if (!on || typeof on !== "object" || Array.isArray(on)) {
      violations.push(`${name} missing on:`);
      continue;
    }
    const events = on as Record<string, unknown>;
    for (const event of Object.keys(events)) {
      if (!ALLOWED_TRIGGERS.has(event)) {
        violations.push(`${name} declares forbidden trigger ${event}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(events, "push")) {
      const branches = pushBranchList(events.push);
      if (!branches || branches.length !== 1 || branches[0] !== "master") {
        violations.push(
          `${name} push trigger must target only master`,
        );
      }
    }
  }
  return violations;
}

function needsIncludesGates(needs: unknown): boolean {
  if (typeof needs === "string") return needs === "gates";
  if (Array.isArray(needs)) return needs.map(String).includes("gates");
  return false;
}

/**
 * Each deploy workflow's deploy job must needs: gates.
 */
export function deployNeedsGatesViolations(repoRoot: string): string[] {
  const violations: string[] = [];
  for (const name of ALLOWED_DEPLOY_WORKFLOWS) {
    const abs = join(repoRoot, WORKFLOWS_DIR, name);
    if (!existsSync(abs)) {
      violations.push(`${name} missing`);
      continue;
    }
    const doc = loadYamlFile(abs);
    const jobs = doc.jobs;
    if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) {
      violations.push(`${name} deploy job missing needs: gates`);
      continue;
    }
    const deploy = (jobs as Record<string, unknown>).deploy;
    if (!deploy || typeof deploy !== "object" || Array.isArray(deploy)) {
      violations.push(`${name} deploy job missing needs: gates`);
      continue;
    }
    if (!needsIncludesGates((deploy as Record<string, unknown>).needs)) {
      violations.push(`${name} deploy job missing needs: gates`);
    }
  }
  return violations;
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

const PLANTED_PR_TARGET_WORKFLOW = `name: planted-vps-secret-leak
on:
  pull_request_target:
jobs:
  steal:
    runs-on: ubuntu-latest
    steps:
      - name: leak
        run: echo "\${{ secrets.VPS_SSH_KEY }}"
`;

describe("deploy-vps-secret-policy", () => {
  it("live .github keeps secrets.VPS_ inside deploy jobs only", () => {
    assert.deepEqual(vpsSecretLocalityViolations(ROOT), []);
  });

  it("live deploy workflows allow only push to master and workflow_dispatch", () => {
    assert.deepEqual(deployTriggerViolations(ROOT), []);
  });

  it("live deploy jobs need gates", () => {
    assert.deepEqual(deployNeedsGatesViolations(ROOT), []);
  });

  it("constructed: secrets.VPS_ under pull_request_target is red", () => {
    withTempGithub(
      (tmp) => {
        writeFileSync(
          join(tmp, WORKFLOWS_DIR, "plant-pr-target.yml"),
          PLANTED_PR_TARGET_WORKFLOW,
        );
      },
      (tmp) => {
        const hits = vpsSecretLocalityViolations(tmp);
        assert.ok(
          hits.includes(
            "secrets.VPS_ outside allowed deploy jobs: .github/workflows/plant-pr-target.yml",
          ),
          "secrets.VPS_ outside allowed deploy jobs: .github/workflows/plant-pr-target.yml",
        );
      },
    );
    assert.deepEqual(vpsSecretLocalityViolations(ROOT), []);
  });

  it("constructed: workflow_run on deploy-ponder.yml is red", () => {
    withTempGithub(
      (tmp) => {
        const abs = join(tmp, WORKFLOWS_DIR, "deploy-ponder.yml");
        const doc = loadYamlFile(abs);
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

  it("constructed: deploy job without needs: gates is red", () => {
    withTempGithub(
      (tmp) => {
        const abs = join(tmp, WORKFLOWS_DIR, "deploy-ponder.yml");
        const doc = loadYamlFile(abs);
        const jobs = doc.jobs as Record<string, unknown>;
        const deploy = jobs.deploy as Record<string, unknown>;
        delete deploy.needs;
        writeFileSync(abs, yaml.dump(doc));
      },
      (tmp) => {
        const hits = deployNeedsGatesViolations(tmp);
        assert.ok(
          hits.includes("deploy-ponder.yml deploy job missing needs: gates"),
          "deploy-ponder.yml deploy job missing needs: gates",
        );
      },
    );
    assert.deepEqual(deployNeedsGatesViolations(ROOT), []);
  });
});
