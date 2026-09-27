/**
 * Sole owner: LIVE stand proof artifact attestation + per-program `.so` path
 * resolution (including named overrides).
 *
 * Hashes every BPF `.so` preloaded by `start-validator.sh` (preload mode) plus
 * fixture programs, and records git HEAD + dirty flag. Wired into each LIVE
 * proof return via {@link withStandArtifactBindings} so the outer suite can
 * assert "this proof ran against these binaries" — not reconstruct from mtime.
 *
 * Keep {@link STAND_PRELOAD_PROGRAMS} in sync with `start-validator.sh`.
 *
 * Per-program override (mixed-version stand): env
 * `KARGAIN_SVM_STAND_SO_OVERRIDE=stem=/abs/path.so,stem2=/other.so`
 * (comma-separated). Override wins over deploy dir; missing override path
 * refuses by name (`stand_so_override_missing`) — never silent fallback.
 *
 * Arch gate (svm-deploy-artifact): preload requires ELF e_flags 0x0; upgradeable
 * load requires 0x3. Wrong arch → `stand_artifact_wrong_arch`.
 *
 * Test overrides: `KARGAIN_SVM_STAND_DEPLOY_DIR`, `KARGAIN_SVM_STAND_FIXTURES_DIR`,
 * `KARGAIN_SVM_STAND_GIT_ROOT`.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEPLOY_ARTIFACT_PURPOSES,
  formatDeployArtifactRefusal,
  readSbfEFlags,
  type DeployArtifactPurpose,
} from "../../scripts/lib/svm-deploy-artifact.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVM_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SVM_ROOT, "..");

/** Env key shared with `start-validator.sh` / `run-stand.sh`. */
export const STAND_SO_OVERRIDE_ENV = "KARGAIN_SVM_STAND_SO_OVERRIDE";

export const STAND_SO_OVERRIDE_MISSING = "stand_so_override_missing";

export const STAND_ARTIFACT_WRONG_ARCH = "stand_artifact_wrong_arch";

/** Absolute stand `.so` / keypair dir — override via `KARGAIN_SVM_STAND_DEPLOY_DIR`. */
export function standDeployDir(): string {
  return process.env.KARGAIN_SVM_STAND_DEPLOY_DIR ?? path.join(SVM_ROOT, "target/deploy");
}

function deployDir(): string {
  return standDeployDir();
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
  /** Absolute path hashed — deploy default or override. */
  path: string;
  /** True when path came from {@link STAND_SO_OVERRIDE_ENV}. */
  overridden: boolean;
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

function sha256File(filePath: string): Omit<StandProgramArtifact, "path" | "overridden"> {
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

function purposeForLoadMode(loadMode: "preload" | "upgradeable"): DeployArtifactPurpose {
  return loadMode === "preload" ? "stand_preload" : "upgradeable_ship";
}

function isStandPreloadProgram(name: string): name is StandPreloadProgram {
  return (STAND_PRELOAD_PROGRAMS as readonly string[]).includes(name);
}

/**
 * Parse `KARGAIN_SVM_STAND_SO_OVERRIDE` (or injected raw). Sole syntax owner.
 * Entries: `stem=/abs/path.so` comma-separated. Empty / unset → {}.
 */
export function parseStandSoOverrides(
  raw: string | undefined = process.env[STAND_SO_OVERRIDE_ENV],
): ReadonlyMap<StandPreloadProgram, string> {
  const out = new Map<StandPreloadProgram, string>();
  if (raw === undefined || raw.trim() === "") return out;
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (entry === "") continue;
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      throw new Error(
        `${STAND_SO_OVERRIDE_MISSING}: malformed override entry ${JSON.stringify(entry)} (want stem=/abs/path.so)`,
      );
    }
    const stem = entry.slice(0, eq).trim();
    const soPath = entry.slice(eq + 1).trim();
    if (!isStandPreloadProgram(stem)) {
      throw new Error(
        `${STAND_SO_OVERRIDE_MISSING}: unknown program stem ${JSON.stringify(stem)}`,
      );
    }
    if (soPath === "") {
      throw new Error(
        `${STAND_SO_OVERRIDE_MISSING}: empty path for ${stem}`,
      );
    }
    out.set(stem, path.resolve(soPath));
  }
  return out;
}

/**
 * Resolve the `.so` path the stand loads for `name`. Override wins; missing
 * override file refuses by name — never falls back to deploy silently.
 */
export function resolveStandProgramSo(
  name: StandPreloadProgram,
  overrides: ReadonlyMap<StandPreloadProgram, string> = parseStandSoOverrides(),
): { path: string; overridden: boolean } {
  const overriddenPath = overrides.get(name);
  if (overriddenPath !== undefined) {
    if (!fs.existsSync(overriddenPath)) {
      throw new Error(
        `${STAND_SO_OVERRIDE_MISSING}: ${name}=${overriddenPath}`,
      );
    }
    return { path: overriddenPath, overridden: true };
  }
  return {
    path: path.join(deployDir(), `${name}.so`),
    overridden: false,
  };
}

/**
 * Refuse wrong SBF arch for the active load mode (named).
 * Arch only — shipping provenance is owned by resolveDeployArtifact(upgradeable_ship);
 * stand already attests gitHead/gitDirty/sha per LIVE run.
 */
export function assertStandProgramSoArch(
  soPath: string,
  loadMode: "preload" | "upgradeable",
): void {
  const purpose = purposeForLoadMode(loadMode);
  const spec = DEPLOY_ARTIFACT_PURPOSES[purpose];
  const flags = readSbfEFlags(soPath);
  if (!flags.ok) {
    throw new Error(
      formatDeployArtifactRefusal({
        ok: false,
        cause: flags.cause,
        path: soPath,
        purpose,
        expectedEFlags: spec.requiredEFlags,
      }),
    );
  }
  if (flags.eFlags !== spec.requiredEFlags) {
    throw new Error(
      `${STAND_ARTIFACT_WRONG_ARCH}: ${formatDeployArtifactRefusal({
        ok: false,
        cause: "artifact_wrong_arch",
        path: soPath,
        purpose,
        expectedEFlags: spec.requiredEFlags,
        measuredEFlags: flags.eFlags,
      })}`,
    );
  }
}

/** Read and hash all stand BPF artifacts on disk (resolved paths + fixtures). */
export function collectStandArtifactBindings(opts?: {
  loadMode?: "preload" | "upgradeable";
}): StandArtifactBindings {
  const loadMode = opts?.loadMode ?? standLoadMode();
  const programs = {} as Record<StandPreloadProgram, StandProgramArtifact>;
  const overrides = parseStandSoOverrides();

  for (const name of STAND_PRELOAD_PROGRAMS) {
    const { path: so, overridden } = resolveStandProgramSo(name, overrides);
    if (!fs.existsSync(so)) {
      if (overridden) {
        throw new Error(`${STAND_SO_OVERRIDE_MISSING}: ${name}=${so}`);
      }
      throw new Error(`missing ${so} — build stand BPF artifacts first (cargo-build-sbf)`);
    }
    assertStandProgramSoArch(so, loadMode);
    programs[name] = { ...sha256File(so), path: so, overridden };
  }

  const fixtures = {} as StandArtifactBindings["fixtures"];
  for (const spec of STAND_PRELOAD_FIXTURES) {
    const filePath = resolveFixturePath(spec);
    if (!fs.existsSync(filePath)) {
      throw new Error(`missing fixture ${filePath}`);
    }
    fixtures[spec.name] = {
      ...sha256File(filePath),
      path: filePath,
      overridden: false,
    };
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
