/**
 * Trunk CI + deploy workflows: isolation, gates-before-SSH, verify∖CI partition.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import {
  CI_GATE_SCRIPTS,
  DEPLOY_MACHINE_VERIFY_SUITES,
  TOOLCHAIN_GATES,
  ciRunnableVacuousDeploymentsViolation,
  ciVerifyMembers,
  findVerifyPartitionHoles,
  isVacuousGreenOnAbsentDeploymentsSource,
  missingCiYamlGateSteps,
  parseVerifyMembers,
} from "../lib/architecture/ci-verify-partition.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS_DIR = join(ROOT, ".github/workflows");
const CI_WF = join(WORKFLOWS_DIR, "ci.yml");
const PONDER_WF = join(WORKFLOWS_DIR, "deploy-ponder.yml");
const SVM_WF = join(WORKFLOWS_DIR, "deploy-svm-ingest.yml");
const PKG = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as {
  scripts: Record<string, string>;
  packageManager?: string;
  engines?: { node?: string };
  devDependencies?: Record<string, string>;
};
const NODE_VERSION_FILE = join(ROOT, ".node-version");
const NODE_VERSION_EXACT = /^\d+\.\d+\.\d+\n?$/;

/** Local reusable workflow or owner/repo@<40-hex> # vX.Y.Z */
const PINNED_USES =
  /^(?:\.\/\S+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}\s+#\s+v\d+\.\d+\.\d+)$/;

const TOP_LEVEL_CONTENTS_READ = /^permissions:\n {2}contents: read\n/m;

function workflowUsesRefs(yaml: string): string[] {
  const refs: string[] = [];
  for (const line of yaml.split("\n")) {
    // Optional list-item dash: "- uses: …" as well as indented "uses: …".
    const m = line.match(/^\s*(?:-\s+)?uses:\s*(.+?)\s*$/);
    if (m) refs.push(m[1]!);
  }
  return refs;
}

function workflowYamlFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();
}

function unpinnedUsesRefs(yaml: string): string[] {
  return workflowUsesRefs(yaml).filter((ref) => !PINNED_USES.test(ref));
}

function lacksTopLevelContentsRead(yaml: string): boolean {
  return !TOP_LEVEL_CONTENTS_READ.test(yaml);
}

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

const DEPLOY_WORKFLOW_FILES = [
  "deploy-ponder.yml",
  "deploy-svm-ingest.yml",
] as const;

const EXPECTED_CONCURRENCY_GROUP: Record<
  (typeof DEPLOY_WORKFLOW_FILES)[number],
  string
> = {
  "deploy-ponder.yml": "deploy-ponder",
  "deploy-svm-ingest.yml": "deploy-svm-ingest",
};

const LOCK_FAILURE_MESSAGE =
  "deploy_lock_not_acquired: waited 900s for .deploy.lock";

/** Per-service job concurrency with cancel-in-progress: false. */
export function deployConcurrencyDefect(
  yamlText: string,
  expectedGroup: string,
): string | null {
  const doc = yaml.load(yamlText);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return `deploy job lacks concurrency group ${expectedGroup}`;
  }
  const jobs = (doc as Record<string, unknown>).jobs;
  if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) {
    return `deploy job lacks concurrency group ${expectedGroup}`;
  }
  const deploy = (jobs as Record<string, unknown>).deploy;
  if (!deploy || typeof deploy !== "object" || Array.isArray(deploy)) {
    return `deploy job lacks concurrency group ${expectedGroup}`;
  }
  const concurrency = (deploy as Record<string, unknown>).concurrency;
  if (!concurrency || typeof concurrency !== "object" || Array.isArray(concurrency)) {
    return `deploy job lacks concurrency group ${expectedGroup}`;
  }
  const c = concurrency as Record<string, unknown>;
  if (c.group !== expectedGroup) {
    return `deploy job lacks concurrency group ${expectedGroup}`;
  }
  if (c["cancel-in-progress"] !== false) {
    return "deploy job concurrency must set cancel-in-progress: false";
  }
  return null;
}

/** Whole remote script must flock .deploy.lock with the named timeout refusal. */
export function deployLockDefect(yamlText: string): string | null {
  if (!/\.deploy\.lock/.test(yamlText)) {
    return "deploy script lacks .deploy.lock flock";
  }
  if (!/flock -w 900/.test(yamlText)) {
    return "deploy script lacks .deploy.lock flock";
  }
  if (!yamlText.includes(LOCK_FAILURE_MESSAGE)) {
    return "deploy script lacks .deploy.lock flock";
  }
  return null;
}

export function deployGitPullDefect(yamlText: string): string | null {
  if (/\bgit\s+pull\b/.test(yamlText)) {
    return "deploy script must not use git pull";
  }
  return null;
}

export function deployPipefailDefect(yamlText: string): string | null {
  if (!/set -euo pipefail/.test(yamlText)) {
    return "deploy script lacks set -euo pipefail";
  }
  return null;
}

export function deployCommandTimeoutDefect(yamlText: string): string | null {
  if (!/command_timeout:\s*30m/.test(yamlText)) {
    return "deploy SSH step lacks command_timeout: 30m";
  }
  return null;
}

/** Evidence lines: recreated (+ unchanged for Ponder); ready=status not ready=ok. */
export function deployEvidenceDefect(
  yamlText: string,
  opts: { requireUnchanged: boolean; service: "ponder" | "svm-ingest" },
): string | null {
  if (/ready=\S+\s+ok\b/.test(yamlText)) {
    return "deploy evidence must use ready=<service> status=<code> not ready=… ok";
  }
  if (!/deploy_evidence outcome=recreated/.test(yamlText)) {
    return "deploy script lacks deploy_evidence outcome=recreated";
  }
  if (opts.requireUnchanged && !/deploy_evidence outcome=unchanged/.test(yamlText)) {
    return "deploy script lacks deploy_evidence outcome=unchanged";
  }
  const readyRe = new RegExp(
    `deploy_evidence ready=${opts.service} status=`,
  );
  if (!readyRe.test(yamlText)) {
    return `deploy script lacks deploy_evidence ready=${opts.service} status=`;
  }
  return null;
}

/** Extract appleboy remote `script:` bodies from a deploy workflow. */
export function extractDeployRemoteScripts(yamlText: string): string[] {
  const doc = yaml.load(yamlText);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
  const jobs = (doc as Record<string, unknown>).jobs;
  if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) return [];
  const deploy = (jobs as Record<string, unknown>).deploy;
  if (!deploy || typeof deploy !== "object" || Array.isArray(deploy)) return [];
  const steps = (deploy as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) return [];
  const out: string[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) continue;
    const withBlock = (step as Record<string, unknown>).with;
    if (!withBlock || typeof withBlock !== "object" || Array.isArray(withBlock)) {
      continue;
    }
    const script = (withBlock as Record<string, unknown>).script;
    if (typeof script === "string" && script.trim().length > 0) {
      out.push(script);
    }
  }
  return out;
}

export function bashSyntaxDefect(script: string): string | null {
  const result = spawnSync("bash", ["-n"], {
    input: script,
    encoding: "utf8",
  });
  if (result.status === 0) return null;
  const detail = (result.stderr || result.stdout || "bash -n failed").trim();
  return `deploy remote script fails bash -n: ${detail}`;
}

export function listDeployWorkflowFiles(): string[] {
  return DEPLOY_WORKFLOW_FILES.filter((name) =>
    readdirSync(WORKFLOWS_DIR).includes(name),
  );
}

/** Owner file must be exact x.y.z (optional trailing newline). */
export function nodeVersionOwnerDefect(raw: string): string | null {
  if (!NODE_VERSION_EXACT.test(raw)) {
    return "node-version owner must be exact x.y.z";
  }
  return null;
}

export function readNodeVersionOwner(): string {
  const raw = readFileSync(NODE_VERSION_FILE, "utf8");
  const defect = nodeVersionOwnerDefect(raw);
  assert.equal(defect, null, defect ?? undefined);
  return raw.trim();
}

type SetupNodeStep = {
  uses?: string;
  with?: Record<string, unknown>;
};

/** Collect every actions/setup-node step (jobs.*.steps or a bare steps list). */
export function collectSetupNodeSteps(yamlText: string): SetupNodeStep[] {
  const doc = yaml.load(yamlText);
  const out: SetupNodeStep[] = [];

  function scanSteps(steps: unknown): void {
    if (!Array.isArray(steps)) return;
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const uses = (step as SetupNodeStep).uses;
      if (typeof uses === "string" && uses.startsWith("actions/setup-node@")) {
        out.push(step as SetupNodeStep);
      }
    }
  }

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      scanSteps(node);
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.steps)) scanSteps(obj.steps);
    if (obj.jobs && typeof obj.jobs === "object") {
      for (const job of Object.values(obj.jobs as Record<string, unknown>)) {
        walk(job);
      }
    }
  }

  walk(doc);
  return out;
}

/**
 * Every setup-node step must set node-version-file: .node-version in its own
 * with: block and must not set node-version: (setup-node prefers the latter).
 */
export function setupNodeVersionDefect(yamlText: string): string | null {
  if (!/actions\/setup-node@/.test(yamlText)) {
    return null;
  }
  const steps = collectSetupNodeSteps(yamlText);
  if (steps.length === 0) {
    return "setup-node must set node-version-file: .node-version";
  }
  for (const step of steps) {
    const w = step.with;
    if (!w || typeof w !== "object" || Array.isArray(w)) {
      return "setup-node must set node-version-file: .node-version";
    }
    if (w["node-version-file"] !== ".node-version") {
      return "setup-node must set node-version-file: .node-version";
    }
    if (Object.prototype.hasOwnProperty.call(w, "node-version")) {
      return "setup-node must not set node-version:";
    }
  }
  return null;
}

type ParsedFrom = {
  /** Image path with registry normalized away when it is Docker Hub library. */
  image: string;
  tag: string | null;
  digest: string | null;
};

/** True when the image reference names the Node official image. */
export function isNodeImageName(image: string): boolean {
  const parts = image.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  if (parts[parts.length - 1] !== "node") return false;
  if (parts.length === 1) return true;
  if (parts.length === 2 && parts[0] === "library") return true;
  if (
    parts.length === 3 &&
    parts[0] === "docker.io" &&
    parts[1] === "library"
  ) {
    return true;
  }
  return false;
}

/**
 * Parse one Dockerfile FROM line: drop --flags and optional AS name; split
 * image into name / tag / digest.
 */
export function parseDockerfileFromLine(line: string): ParsedFrom | null {
  const trimmed = line.trim();
  if (!/^FROM\s+/i.test(trimmed)) return null;
  const tokens = trimmed.replace(/^FROM\s+/i, "").split(/\s+/);
  let i = 0;
  while (i < tokens.length && tokens[i]!.startsWith("--")) i += 1;
  const ref = tokens[i];
  if (!ref) return null;
  i += 1;
  if (i < tokens.length && /^AS$/i.test(tokens[i]!)) {
    // skip stage name
  }

  let digest: string | null = null;
  let nameAndTag = ref;
  const at = ref.indexOf("@");
  if (at >= 0) {
    digest = ref.slice(at + 1);
    nameAndTag = ref.slice(0, at);
  }

  let image = nameAndTag;
  let tag: string | null = null;
  const colon = nameAndTag.lastIndexOf(":");
  if (colon >= 0) {
    const after = nameAndTag.slice(colon + 1);
    // tag, not registry:port — no slash in the tag segment
    if (!after.includes("/")) {
      tag = after;
      image = nameAndTag.slice(0, colon);
    }
  }
  return { image, tag, digest };
}

export function dockerfileNodeFromLines(dockerfile: string): ParsedFrom[] {
  const out: ParsedFrom[] = [];
  for (const line of dockerfile.split("\n")) {
    if (!/^\s*FROM\s+/i.test(line)) continue;
    const parsed = parseDockerfileFromLine(line);
    if (parsed && isNodeImageName(parsed.image)) out.push(parsed);
  }
  return out;
}

/**
 * Every FROM whose image is node must be exactly node:<owner>-alpine.
 * Non-node bases are ignored. Digest form is red. Empty node set is red when
 * this helper is used on a planted node Dockerfile; live scan counts globally.
 */
export function dockerfileNodeFromDefect(
  dockerfile: string,
  ownerXyz: string,
): string | null {
  const expected = `${ownerXyz}-alpine`;
  const nodeFroms = dockerfileNodeFromLines(dockerfile);
  if (nodeFroms.length === 0) {
    return "Dockerfile must have FROM node:<tag>";
  }
  for (const from of nodeFroms) {
    if (from.digest !== null || from.tag !== expected) {
      return `Dockerfile FROM node tag must be ${expected}`;
    }
  }
  return null;
}

export function enginesNodeDefect(
  enginesNode: string | undefined,
  ownerMajor: string,
): string | null {
  const expected = `${ownerMajor}.x`;
  if (enginesNode !== expected) {
    return `engines.node must be ${expected}`;
  }
  return null;
}

export function typesNodeMajorDefect(
  range: string | undefined,
  ownerMajor: string,
): string | null {
  if (range === undefined) {
    return "@types/node must be declared";
  }
  const m = range.match(/^\^?(\d+)\./);
  if (!m) {
    return "@types/node range must start with a major version";
  }
  if (m[1] !== ownerMajor) {
    return `@types/node major must be ${ownerMajor}`;
  }
  return null;
}

function rootDockerfiles(): string[] {
  return readdirSync(ROOT)
    .filter((name) => name.startsWith("Dockerfile"))
    .sort();
}

function workflowsUsingSetupNode(): string[] {
  return workflowYamlFiles().filter((name) => {
    const yaml = readFileSync(join(WORKFLOWS_DIR, name), "utf8");
    return /actions\/setup-node@/.test(yaml);
  });
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

  it("live deploy workflows enumerate a non-empty set with ADR 0010 serialization", () => {
    const files = listDeployWorkflowFiles();
    assert.ok(files.length > 0, "deploy workflow set must be non-empty");
    for (const name of files) {
      const yamlText = readFileSync(join(WORKFLOWS_DIR, name), "utf8");
      const group = EXPECTED_CONCURRENCY_GROUP[name as keyof typeof EXPECTED_CONCURRENCY_GROUP];
      assert.equal(deployConcurrencyDefect(yamlText, group), null, name);
      assert.equal(deployLockDefect(yamlText), null, name);
      assert.equal(deployGitPullDefect(yamlText), null, name);
      assert.equal(deployPipefailDefect(yamlText), null, name);
      assert.equal(deployCommandTimeoutDefect(yamlText), null, name);
      const service = name === "deploy-ponder.yml" ? "ponder" : "svm-ingest";
      assert.equal(
        deployEvidenceDefect(yamlText, {
          requireUnchanged: name === "deploy-ponder.yml",
          service,
        }),
        null,
        name,
      );
      const scripts = extractDeployRemoteScripts(yamlText);
      assert.ok(scripts.length > 0, `${name} must expose a remote script`);
      for (const script of scripts) {
        assert.equal(bashSyntaxDefect(script), null, name);
      }
    }
  });

  it("constructed: deploy job without its per-service concurrency group is red", () => {
    const planted = `
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps: []
`;
    assert.equal(
      deployConcurrencyDefect(planted, "deploy-ponder"),
      "deploy job lacks concurrency group deploy-ponder",
    );
  });

  it("constructed: deploy script without the lock is red", () => {
    const planted = `
script: |
  set -euo pipefail
  git checkout --force "$DEPLOY_SHA"
`;
    assert.equal(
      deployLockDefect(planted),
      "deploy script lacks .deploy.lock flock",
    );
  });

  it("constructed: deploy script using git pull is red", () => {
    const planted = `
script: |
  set -euo pipefail
  git pull https://github.com/kargain-com/kargain.git master
`;
    assert.equal(
      deployGitPullDefect(planted),
      "deploy script must not use git pull",
    );
  });

  it("constructed: deploy script without set -euo pipefail is red", () => {
    const planted = `
script: |
  flock -w 900 9
  git checkout --force "$DEPLOY_SHA"
`;
    assert.equal(
      deployPipefailDefect(planted),
      "deploy script lacks set -euo pipefail",
    );
  });

  it("constructed: deploy without evidence lines is red", () => {
    const planted = `
script: |
  set -euo pipefail
  flock -w 900 9
`;
    assert.equal(
      deployEvidenceDefect(planted, {
        requireUnchanged: true,
        service: "ponder",
      }),
      "deploy script lacks deploy_evidence outcome=recreated",
    );
  });

  it("constructed: ready=… ok instead of ready=<service> status=<code> is red", () => {
    const planted = `
script: |
  set -euo pipefail
  echo "deploy_evidence outcome=recreated"
  echo "deploy_evidence outcome=unchanged"
  echo "deploy_evidence ready=ponder ok"
`;
    assert.equal(
      deployEvidenceDefect(planted, {
        requireUnchanged: true,
        service: "ponder",
      }),
      "deploy evidence must use ready=<service> status=<code> not ready=… ok",
    );
  });

  it("constructed: missing command_timeout is red", () => {
    const planted = `
with:
  host: example
  script: |
    set -euo pipefail
`;
    assert.equal(
      deployCommandTimeoutDefect(planted),
      "deploy SSH step lacks command_timeout: 30m",
    );
  });

  it("constructed: remote script that fails bash -n is red", () => {
    const planted = "if then fi\n";
    const defect = bashSyntaxDefect(planted);
    assert.ok(defect, "planted script must fail bash -n");
    assert.match(defect!, /^deploy remote script fails bash -n:/);
  });

  it("svm-ingest workflow exists and never builds or restarts ponder", () => {
    const yaml = readFileSync(SVM_WF, "utf8");
    const paths = pathsBlock(yaml);
    assert.match(paths, /src\/svm-ingest\/\*\*/);
    assert.match(paths, /lib\/svm\/\*\*/);
    assert.match(paths, /src\/lib\/svm-projection-writer\.ts/);
    assert.match(paths, /src\/lib\/svm-raw-writer\.ts/);
    assert.match(paths, /Dockerfile\.svm-ingest/);
    assert.match(yaml, /workflow_dispatch:/);
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

  it(".node-version is exact x.y.z", () => {
    const raw = readFileSync(NODE_VERSION_FILE, "utf8");
    assert.equal(nodeVersionOwnerDefect(raw), null);
  });

  it("setup-node workflows use node-version-file and omit node-version", () => {
    const names = workflowsUsingSetupNode();
    assert.ok(names.length > 0, "at least one workflow must use setup-node");
    for (const name of names) {
      const text = readFileSync(join(WORKFLOWS_DIR, name), "utf8");
      assert.equal(
        setupNodeVersionDefect(text),
        null,
        `${name} must pin Node via .node-version`,
      );
      assert.ok(
        collectSetupNodeSteps(text).length > 0,
        `${name} must expose at least one setup-node step to the per-step scan`,
      );
    }
  });

  it("root Dockerfiles pin every node FROM to node:<owner>-alpine", () => {
    const owner = readNodeVersionOwner();
    const names = rootDockerfiles();
    assert.ok(names.length > 0, "at least one root Dockerfile* must exist");
    let nodeFromCount = 0;
    for (const name of names) {
      const df = readFileSync(join(ROOT, name), "utf8");
      const nodeFroms = dockerfileNodeFromLines(df);
      nodeFromCount += nodeFroms.length;
      if (nodeFroms.length === 0) {
        // Non-node bases (e.g. Dockerfile.strfry on alpine) stay allowed.
        continue;
      }
      assert.equal(
        dockerfileNodeFromDefect(df, owner),
        null,
        `${name} must match .node-version on every node FROM`,
      );
    }
    assert.ok(
      nodeFromCount > 0,
      "at least one root Dockerfile FROM must use the node image",
    );
  });

  it("engines.node major matches .node-version", () => {
    const owner = readNodeVersionOwner();
    const major = owner.split(".")[0]!;
    assert.equal(enginesNodeDefect(PKG.engines?.node, major), null);
  });

  it("@types/node major matches .node-version", () => {
    const owner = readNodeVersionOwner();
    const major = owner.split(".")[0]!;
    assert.equal(
      typesNodeMajorDefect(PKG.devDependencies?.["@types/node"], major),
      null,
    );
  });

  it("constructed: Dockerfile FROM node:20-alpine is red", () => {
    const owner = readNodeVersionOwner();
    assert.equal(
      dockerfileNodeFromDefect("FROM node:20-alpine\n", owner),
      `Dockerfile FROM node tag must be ${owner}-alpine`,
    );
  });

  it("constructed: Dockerfile floating FROM node:<major>-alpine is red", () => {
    const owner = readNodeVersionOwner();
    const major = owner.split(".")[0]!;
    assert.equal(
      dockerfileNodeFromDefect(`FROM node:${major}-alpine\n`, owner),
      `Dockerfile FROM node tag must be ${owner}-alpine`,
    );
  });

  it("constructed: Dockerfile FROM --platform node:20-alpine is red", () => {
    const owner = readNodeVersionOwner();
    assert.equal(
      dockerfileNodeFromDefect(
        "FROM --platform=linux/amd64 node:20-alpine\n",
        owner,
      ),
      `Dockerfile FROM node tag must be ${owner}-alpine`,
    );
  });

  it("constructed: Dockerfile FROM docker.io/library/node:20-alpine is red", () => {
    const owner = readNodeVersionOwner();
    assert.equal(
      dockerfileNodeFromDefect(
        "FROM docker.io/library/node:20-alpine\n",
        owner,
      ),
      `Dockerfile FROM node tag must be ${owner}-alpine`,
    );
  });

  it("constructed: Dockerfile FROM node@sha256 digest is red", () => {
    const owner = readNodeVersionOwner();
    const digest =
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    assert.equal(
      dockerfileNodeFromDefect(`FROM node@${digest}\n`, owner),
      `Dockerfile FROM node tag must be ${owner}-alpine`,
    );
  });

  it("constructed: Dockerfile second stage FROM node:20-alpine is red", () => {
    const owner = readNodeVersionOwner();
    const planted = `FROM node:${owner}-alpine AS build\nFROM node:20-alpine AS run\n`;
    assert.equal(
      dockerfileNodeFromDefect(planted, owner),
      `Dockerfile FROM node tag must be ${owner}-alpine`,
    );
  });

  it("constructed: workflow with literal node-version is red", () => {
    const planted = `
jobs:
  gates:
    steps:
      - name: Setup Node
        uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with:
          node-version: "22"
          package-manager-cache: false
`;
    assert.equal(
      setupNodeVersionDefect(planted),
      "setup-node must set node-version-file: .node-version",
    );
  });

  it("constructed: setup-node with both version keys is red", () => {
    const planted = `
jobs:
  gates:
    steps:
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with:
          node-version-file: .node-version
          node-version: "22"
`;
    assert.equal(
      setupNodeVersionDefect(planted),
      "setup-node must not set node-version:",
    );
  });

  it("constructed: second setup-node step without with: is red", () => {
    const planted = `
jobs:
  gates:
    steps:
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with:
          node-version-file: .node-version
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
`;
    assert.equal(
      setupNodeVersionDefect(planted),
      "setup-node must set node-version-file: .node-version",
    );
  });

  it("constructed: engines.node with a different major is red", () => {
    const owner = readNodeVersionOwner();
    const major = owner.split(".")[0]!;
    const wrong = major === "20" ? "22.x" : "20.x";
    assert.equal(
      enginesNodeDefect(wrong, major),
      `engines.node must be ${major}.x`,
    );
  });

  it("constructed: @types/node with a different major is red", () => {
    const owner = readNodeVersionOwner();
    const major = owner.split(".")[0]!;
    const wrong = major === "20" ? "^22.14.1" : "^20.14.1";
    assert.equal(
      typesNodeMajorDefect(wrong, major),
      `@types/node major must be ${major}`,
    );
  });

  it("constructed: .node-version of major-only is red", () => {
    assert.equal(
      nodeVersionOwnerDefect("24\n"),
      "node-version owner must be exact x.y.z",
    );
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
    assert.deepEqual(
      missingCiYamlGateSteps(yaml),
      [],
      `ci.yml missing CI_GATE_SCRIPTS steps: ${missingCiYamlGateSteps(yaml).join(", ")}`,
    );
    assert.match(yaml, /pnpm build/);
    // Order: lint → first CI gate → … → last CI gate → build.
    const lintIdx = yaml.search(/^\s*run:\s*pnpm\s+lint\s*$/m);
    const firstGate = CI_GATE_SCRIPTS[0]!;
    const lastGate = CI_GATE_SCRIPTS[CI_GATE_SCRIPTS.length - 1]!;
    const firstGateIdx = yaml.search(
      new RegExp(
        `^\\s*run:\\s*pnpm\\s+${firstGate.replace(":", "\\:")}\\s*$`,
        "m",
      ),
    );
    const lastGateIdx = yaml.search(
      new RegExp(
        `^\\s*run:\\s*pnpm\\s+${lastGate.replace(":", "\\:")}\\s*$`,
        "m",
      ),
    );
    const buildIdx = yaml.search(/^\s*run:\s*pnpm\s+build\s*$/m);
    assert.ok(lintIdx >= 0 && firstGateIdx > lintIdx, "CI gates after lint");
    assert.ok(lastGateIdx > firstGateIdx, "CI gates ordered");
    assert.ok(buildIdx > lastGateIdx, "build after CI gates");
    assert.doesNotMatch(yaml, /appleboy\/ssh-action/);
    // secrets locality: sole owner test/deploy-vps-secret-policy.test.ts
    // Per-caller group — shared ci-${{ github.ref }} dropped Deploy svm-ingest runs.
    assert.match(yaml, /group:\s*\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
    assert.doesNotMatch(yaml, /group:\s*ci-\$\{\{/);
    assert.match(
      yaml,
      /cancel-in-progress:\s*\$\{\{\s*github\.ref\s*!=\s*'refs\/heads\/master'\s*\}\}/,
    );
  });

  it("constructed: shared ci-ref concurrency group is red", () => {
    const planted = `
concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: false
`;
    assert.match(planted, /group:\s*ci-\$\{\{/);
    const live = readFileSync(CI_WF, "utf8");
    assert.doesNotMatch(live, /group:\s*ci-\$\{\{/);
    assert.match(
      live,
      /group:\s*\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/,
    );
  });

  it("ci.yml Install installs svm/lab for typecheck paths", () => {
    const yaml = readFileSync(CI_WF, "utf8");
    assert.match(
      yaml,
      /pnpm --dir svm\/lab install --frozen-lockfile/,
      "CI must install svm/lab so svm/tsconfig can resolve @solana/spl-token",
    );
    // Pin expectation: mutable tags replaced by full commit SHAs (issue #17).
    assert.match(yaml, /actions\/checkout@[0-9a-f]{40}/);
    assert.match(yaml, /actions\/setup-node@[0-9a-f]{40}/);
  });

  it("ci.yml checkout is deep so append-only can load published-trunk baseline", () => {
    const yaml = readFileSync(CI_WF, "utf8");
    assert.match(
      yaml,
      /actions\/checkout@[0-9a-f]{40}[\s\S]*?fetch-depth:\s*0/,
      "CI checkout must use fetch-depth: 0 for git show <before|base>:manifest",
    );
    assert.match(
      yaml,
      /git fetch --no-tags origin master:refs\/remotes\/origin\/master/,
      "CI must fetch origin/master (local-shaped tooling / inspect; Actions append-only uses push/PR)",
    );
  });

  it("constructed: shallow CI checkout is red vs live deep checkout", () => {
    const planted = `
      - name: Checkout
        uses: actions/checkout@0000000000000000000000000000000000000000
`;
    assert.doesNotMatch(planted, /fetch-depth:\s*0/);
    const live = readFileSync(CI_WF, "utf8");
    assert.match(live, /fetch-depth:\s*0/);
    assert.notEqual(
      /fetch-depth:\s*0/.test(planted),
      /fetch-depth:\s*0/.test(live),
    );
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

  it("constructed: omitting a CI_GATE_SCRIPTS step is red", () => {
    const live = readFileSync(CI_WF, "utf8");
    assert.deepEqual(missingCiYamlGateSteps(live), []);
    const planted = live.replace(
      /^\s*- name: test:unit\n\s*run: pnpm test:unit\n/m,
      "",
    );
    assert.ok(
      missingCiYamlGateSteps(planted).includes("test:unit"),
      "planted yaml without test:unit must fail missingCiYamlGateSteps",
    );
  });

  it("TOOLCHAIN_GATES are named exclusions, never CI_GATE_SCRIPTS members", () => {
    for (const gate of Object.keys(TOOLCHAIN_GATES) as (keyof typeof TOOLCHAIN_GATES)[]) {
      assert.equal(
        (CI_GATE_SCRIPTS as readonly string[]).includes(gate),
        false,
        `${gate} must not be a trunk CI gate`,
      );
      assert.ok(
        TOOLCHAIN_GATES[gate].length > 0,
        `${gate} must carry a reason`,
      );
      assert.ok(
        PKG.scripts[gate],
        `${gate} must exist in package.json scripts`,
      );
    }
  });

  it("both deploy workflows place SSH under the deploy job", () => {
    // gates uses ci.yml, needs: gates, and deploy.if: sole owner
    // test/deploy-vps-secret-policy.test.ts (YAML parse).
    for (const [label, path] of [
      ["ponder", PONDER_WF],
      ["svm-ingest", SVM_WF],
    ] as const) {
      const yaml = readFileSync(path, "utf8");
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

  it("every workflow uses: is local or SHA-pinned with exact release comment", () => {
    const files = workflowYamlFiles();
    assert.ok(
      files.length >= 3,
      "expected .yml/.yaml workflows under .github/workflows",
    );
    for (const file of files) {
      const yaml = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
      const bad = unpinnedUsesRefs(yaml);
      assert.deepEqual(
        bad,
        [],
        `${file}: uses must be ./… or owner/repo@<40-hex> # vX.Y.Z; got ${bad.join(", ")}`,
      );
    }
  });

  it("every workflow declares top-level permissions: contents: read", () => {
    const files = workflowYamlFiles();
    for (const file of files) {
      const yaml = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
      assert.equal(
        lacksTopLevelContentsRead(yaml),
        false,
        `${file}: missing top-level permissions: contents: read`,
      );
    }
  });

  it("constructed: mutable action tag is red vs live SHA pin", () => {
    const planted = "uses: actions/checkout@v5";
    assert.deepEqual(
      unpinnedUsesRefs(planted),
      ["actions/checkout@v5"],
      "planted @v5 must fail PINNED_USES",
    );
    const live = readFileSync(CI_WF, "utf8");
    assert.deepEqual(unpinnedUsesRefs(live), []);
  });

  it("constructed: list-item mutable uses tag is red", () => {
    const planted = "      - uses: actions/checkout@v5";
    assert.deepEqual(
      unpinnedUsesRefs(planted),
      ["actions/checkout@v5"],
      "planted list-item - uses: @v5 must fail PINNED_USES",
    );
    const live = readFileSync(CI_WF, "utf8");
    assert.deepEqual(unpinnedUsesRefs(live), []);
  });

  it("constructed: workflow without permissions block is red", () => {
    const planted = `name: X
on: push
jobs:
  gates:
    runs-on: ubuntu-latest
`;
    assert.equal(
      lacksTopLevelContentsRead(planted),
      true,
      "planted YAML without permissions must be red",
    );
    const live = readFileSync(CI_WF, "utf8");
    assert.equal(lacksTopLevelContentsRead(live), false);
  });
});
