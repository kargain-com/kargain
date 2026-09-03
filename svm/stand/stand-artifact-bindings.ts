/**
 * Sole owner: LIVE stand proof artifact attestation.
 *
 * Hashes every BPF `.so` preloaded by `start-validator.sh` (preload mode) plus
 * fixture programs, and records git HEAD + dirty flag. Wired into each LIVE
 * proof return via {@link withStandArtifactBindings} so the outer suite can
 * assert "this proof ran against these binaries" — not reconstruct from mtime.
 *
 * Keep {@link STAND_PRELOAD_PROGRAMS} in sync with `start-validator.sh`.
 *
 * Test overrides: `KARGAIN_SVM_STAND_DEPLOY_DIR`, `KARGAIN_SVM_STAND_FIXTURES_DIR`,
 * `KARGAIN_SVM_STAND_GIT_ROOT`.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVM_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SVM_ROOT, "..");

function deployDir(): string {
  return process.env.KARGAIN_SVM_STAND_DEPLOY_DIR ?? path.join(SVM_ROOT, "target/deploy");
}

function fixturesDir(): string {
  return process.env.KARGAIN_SVM_STAND_FIXTURES_DIR ?? path.join(SVM_ROOT, "lab/fixtures");
}

/** Preload stand programs — must match `start-validator.sh` need_so list. */
export const STAND_PRELOAD_PROGRAMS = [
  "mock_endpoint",
  "kar_passport",
  "kar_gateway",
  "mock_staking",
  "kar_pro_staking",
  "kar_pro_pass",
  "money_harness",
  "consignment_harness",
  "kar_fixed_price",
  "kar_ascending",
] as const;

export type StandPreloadProgram = (typeof STAND_PRELOAD_PROGRAMS)[number];

export const STAND_PRELOAD_FIXTURES = [
  { name: "mpl_core", file: "mpl_core_release_0.15.1.so", fallback: "mpl_core.so" },
  { name: "spl_noop", file: "spl_noop.so" },
] as const;

export type StandProgramArtifact = {
  sha256: string;
  bytes: number;
};

export type StandArtifactBindings = {
  gitHead: string;
  gitDirty: boolean;
  loadMode: "preload" | "upgradeable";
  collectedAt: string;
  programs: Record<StandPreloadProgram, StandProgramArtifact>;
  fixtures: Record<(typeof STAND_PRELOAD_FIXTURES)[number]["name"], StandProgramArtifact>;
};

/** Proof result plus attested BPF/git envelope from {@link withStandArtifactBindings}. */
export type WithStandArtifacts<T extends object> = T & { artifacts: StandArtifactBindings };

function sha256File(filePath: string): StandProgramArtifact {
  const buf = fs.readFileSync(filePath);
  return {
    sha256: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
  };
}

function repoRoot(): string {
  return process.env.KARGAIN_SVM_STAND_GIT_ROOT ?? REPO_ROOT;
}

function readGitState(): { gitHead: string; gitDirty: boolean } {
  const root = repoRoot();
  try {
    const gitHead = execSync("git rev-parse HEAD", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const dirty =
      execSync("git status --porcelain", {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().length > 0;
    return { gitHead, gitDirty: dirty };
  } catch {
    return { gitHead: "unknown", gitDirty: true };
  }
}

function resolveFixturePath(spec: (typeof STAND_PRELOAD_FIXTURES)[number]): string {
  const fixtures = fixturesDir();
  const primary = path.join(fixtures, spec.file);
  if ("fallback" in spec && spec.fallback && !fs.existsSync(primary)) {
    return path.join(fixtures, spec.fallback);
  }
  return primary;
}

function standLoadMode(): "preload" | "upgradeable" {
  return process.env.KARGAIN_SVM_STAND_LOAD === "upgradeable" ? "upgradeable" : "preload";
}

/** Read and hash all stand BPF artifacts on disk (deploy dir + fixtures). */
export function collectStandArtifactBindings(opts?: {
  loadMode?: "preload" | "upgradeable";
}): StandArtifactBindings {
  const loadMode = opts?.loadMode ?? standLoadMode();
  const programs = {} as Record<StandPreloadProgram, StandProgramArtifact>;

  const deploy = deployDir();
  for (const name of STAND_PRELOAD_PROGRAMS) {
    const so = path.join(deploy, `${name}.so`);
    if (!fs.existsSync(so)) {
      throw new Error(`missing ${so} — build stand BPF artifacts first (cargo-build-sbf)`);
    }
    programs[name] = sha256File(so);
  }

  const fixtures = {} as StandArtifactBindings["fixtures"];
  for (const spec of STAND_PRELOAD_FIXTURES) {
    const filePath = resolveFixturePath(spec);
    if (!fs.existsSync(filePath)) {
      throw new Error(`missing fixture ${filePath}`);
    }
    fixtures[spec.name] = sha256File(filePath);
  }

  const { gitHead, gitDirty } = readGitState();

  return {
    gitHead,
    gitDirty,
    loadMode,
    collectedAt: new Date().toISOString(),
    programs,
    fixtures,
  };
}

/** Attach filesystem + git attestation to a LIVE proof return envelope. */
export function withStandArtifactBindings<T extends object>(
  result: T,
  opts?: { loadMode?: "preload" | "upgradeable" },
): T & { artifacts: StandArtifactBindings } {
  return {
    ...result,
    artifacts: collectStandArtifactBindings(opts),
  };
}
