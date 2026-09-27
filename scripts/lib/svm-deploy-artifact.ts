/**
 * Sole owner: SBF deploy artifact directories, ELF e_flags arch gate, cargo-build-sbf
 * (--arch + --sbf-out-dir), and shipping build provenance (manifest).
 *
 * Stand preload = arch v0 → svm/target/deploy (e_flags 0x0); no manifest.
 * Shipping = arch v3 → svm/target/deploy-v3 (e_flags 0x3) + deploy-artifact.manifest.json.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SVM_COMMERCIAL_PROGRAM_CENSUS } from "../../lib/svm/ingest-config.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../..");

export const STAND_DEPLOY_DIR_REL = "svm/target/deploy";
export const SHIPPING_DEPLOY_DIR_REL = "svm/target/deploy-v3";
export const DEPLOY_ARTIFACT_MANIFEST_FILE = "deploy-artifact.manifest.json";

/** Measured: cargo-build-sbf --arch v0 → ELF64 e_flags. */
export const STAND_PRELOAD_E_FLAGS = 0x0;
/** Measured: cargo-build-sbf --arch v3 → ELF64 e_flags. */
export const SHIPPING_E_FLAGS = 0x3;

const GIT_HEAD_HEX = /^[0-9a-f]{40}$/i;

export type DeployArtifactPurpose = "stand_preload" | "upgradeable_ship";

export type DeployArtifactPurposeSpec = {
  purpose: DeployArtifactPurpose;
  arch: "v0" | "v3";
  /** Repo-root-relative default out dir. */
  outDirRel: string;
  requiredEFlags: number;
};

export const DEPLOY_ARTIFACT_PURPOSES: Record<
  DeployArtifactPurpose,
  DeployArtifactPurposeSpec
> = {
  stand_preload: {
    purpose: "stand_preload",
    arch: "v0",
    outDirRel: STAND_DEPLOY_DIR_REL,
    requiredEFlags: STAND_PRELOAD_E_FLAGS,
  },
  upgradeable_ship: {
    purpose: "upgradeable_ship",
    arch: "v3",
    outDirRel: SHIPPING_DEPLOY_DIR_REL,
    requiredEFlags: SHIPPING_E_FLAGS,
  },
};

export type DeployArtifactManifestProgram = {
  stem: string;
  file: string;
  sha256: string;
  bytes: number;
  eFlags: number;
};

export type DeployArtifactManifest = {
  purpose: "upgradeable_ship";
  gitHead: string;
  dirty: false;
  builtAt: string;
  programs: DeployArtifactManifestProgram[];
};

export type DeployArtifactGitState = {
  dirty: boolean;
  head: string;
};

export type ReadSbfEFlagsOk = { ok: true; eFlags: number };
export type ReadSbfEFlagsFail = {
  ok: false;
  cause: "not_elf" | "unsupported_elf_class" | "truncated_elf";
};
export type ReadSbfEFlagsResult = ReadSbfEFlagsOk | ReadSbfEFlagsFail;

/** ELF64 e_flags at offset 0x30 (ei_class === 2). Pure — no llvm-readobj. */
export function readSbfEFlagsFromBytes(buf: Uint8Array): ReadSbfEFlagsResult {
  if (buf.length < 52) {
    return { ok: false, cause: "truncated_elf" };
  }
  if (
    buf[0] !== 0x7f ||
    buf[1] !== 0x45 ||
    buf[2] !== 0x4c ||
    buf[3] !== 0x46
  ) {
    return { ok: false, cause: "not_elf" };
  }
  const eiClass = buf[4]!;
  if (eiClass === 1) {
    return { ok: false, cause: "unsupported_elf_class" };
  }
  if (eiClass !== 2) {
    return { ok: false, cause: "not_elf" };
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eFlags = view.getUint32(0x30, true);
  return { ok: true, eFlags };
}

export function readSbfEFlags(soPath: string): ReadSbfEFlagsResult {
  const buf = readFileSync(soPath);
  return readSbfEFlagsFromBytes(buf);
}

export function sha256HexOfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function deployArtifactOutDirAbs(
  purpose: DeployArtifactPurpose,
  repoRoot: string = REPO_ROOT,
): string {
  return resolve(repoRoot, DEPLOY_ARTIFACT_PURPOSES[purpose].outDirRel);
}

export function deployArtifactManifestPath(
  soDirAbs: string,
): string {
  return join(soDirAbs, DEPLOY_ARTIFACT_MANIFEST_FILE);
}

/** Read porcelain + HEAD. Inject for tests. */
export function readDeployArtifactGitState(
  repoRoot: string = REPO_ROOT,
  inject?: DeployArtifactGitState,
): DeployArtifactGitState {
  if (inject !== undefined) {
    return inject;
  }
  const porcelain = spawnSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if ((porcelain.status ?? 1) !== 0) {
    return { dirty: true, head: "" };
  }
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if ((head.status ?? 1) !== 0) {
    return { dirty: true, head: "" };
  }
  return {
    dirty: porcelain.stdout.trim().length > 0,
    head: head.stdout.trim(),
  };
}

export function requireCleanGitForShippingBuild(
  repoRoot: string = REPO_ROOT,
  inject?: DeployArtifactGitState,
): string {
  const state = readDeployArtifactGitState(repoRoot, inject);
  if (state.dirty) {
    throw new Error(
      `svm-deploy-artifact: deploy_artifact_dirty_tree — working tree unclean; refuse shipping build`,
    );
  }
  if (!GIT_HEAD_HEX.test(state.head)) {
    throw new Error(
      `svm-deploy-artifact: deploy_artifact_dirty_tree — invalid HEAD for shipping build`,
    );
  }
  return state.head;
}

export type ResolveDeployArtifactOk = {
  ok: true;
  path: string;
  purpose: DeployArtifactPurpose;
  eFlags: number;
  /** Present only for upgradeable_ship after provenance checks. */
  gitHead?: string;
};

export type ResolveDeployArtifactFailCause =
  | "artifact_missing"
  | "artifact_wrong_arch"
  | "not_elf"
  | "unsupported_elf_class"
  | "truncated_elf"
  | "deploy_artifact_dirty_tree"
  | "deploy_artifact_manifest_missing"
  | "deploy_artifact_stem_absent"
  | "deploy_artifact_stale_head"
  | "deploy_artifact_sha_mismatch";

export type ResolveDeployArtifactFail = {
  ok: false;
  cause: ResolveDeployArtifactFailCause;
  path: string;
  purpose: DeployArtifactPurpose;
  expectedEFlags: number;
  measuredEFlags?: number;
  detail?: string;
};

export type ResolveDeployArtifactResult =
  | ResolveDeployArtifactOk
  | ResolveDeployArtifactFail;

export function formatDeployArtifactRefusal(
  result: ResolveDeployArtifactFail,
): string {
  const base = `svm-deploy-artifact: ${result.cause} path=${result.path} purpose=${result.purpose}`;
  if (result.cause === "artifact_wrong_arch") {
    const measured =
      typeof result.measuredEFlags === "number"
        ? `measured_e_flags=0x${result.measuredEFlags.toString(16)}`
        : "e_flags_unreadable";
    return (
      `${base} expected_e_flags=0x${result.expectedEFlags.toString(16)} ${measured}` +
      (result.detail ? ` ${result.detail}` : "")
    );
  }
  return result.detail ? `${base} ${result.detail}` : base;
}

function fail(
  args: Omit<ResolveDeployArtifactFail, "ok">,
): ResolveDeployArtifactFail {
  return { ok: false, ...args };
}

function loadManifest(manifestPath: string): DeployArtifactManifest | null {
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    if (
      raw == null ||
      typeof raw !== "object" ||
      (raw as DeployArtifactManifest).purpose !== "upgradeable_ship" ||
      typeof (raw as DeployArtifactManifest).gitHead !== "string" ||
      !Array.isArray((raw as DeployArtifactManifest).programs)
    ) {
      return null;
    }
    return raw as DeployArtifactManifest;
  } catch {
    return null;
  }
}

/**
 * Resolve `{stem}.so` under soDir (default = purpose out dir).
 * `upgradeable_ship` also enforces shipping provenance (manifest / sha / HEAD).
 * `stand_preload` is arch-only (stand attests git separately).
 */
export function resolveDeployArtifact(args: {
  purpose: DeployArtifactPurpose;
  /** File stem without `.so` (evidence key or stand program name). */
  stem: string;
  soDir?: string;
  repoRoot?: string;
  /** Inject porcelain/HEAD for plants. */
  gitState?: DeployArtifactGitState;
}): ResolveDeployArtifactResult {
  const spec = DEPLOY_ARTIFACT_PURPOSES[args.purpose];
  const repoRoot = args.repoRoot ?? REPO_ROOT;
  const soDir = args.soDir
    ? isAbsolute(args.soDir)
      ? args.soDir
      : resolve(repoRoot, args.soDir)
    : resolve(repoRoot, spec.outDirRel);
  const soPath = join(soDir, `${args.stem}.so`);

  if (args.purpose === "upgradeable_ship") {
    const git = readDeployArtifactGitState(repoRoot, args.gitState);
    if (git.dirty || !GIT_HEAD_HEX.test(git.head)) {
      return fail({
        cause: "deploy_artifact_dirty_tree",
        path: soPath,
        purpose: args.purpose,
        expectedEFlags: spec.requiredEFlags,
        detail: "working tree unclean or HEAD unreadable",
      });
    }
    const manifestPath = deployArtifactManifestPath(soDir);
    const manifest = loadManifest(manifestPath);
    if (manifest == null) {
      return fail({
        cause: "deploy_artifact_manifest_missing",
        path: manifestPath,
        purpose: args.purpose,
        expectedEFlags: spec.requiredEFlags,
      });
    }
    if (manifest.gitHead !== git.head) {
      return fail({
        cause: "deploy_artifact_stale_head",
        path: manifestPath,
        purpose: args.purpose,
        expectedEFlags: spec.requiredEFlags,
        detail: `manifest.gitHead=${manifest.gitHead} HEAD=${git.head}`,
      });
    }
    const row = manifest.programs.find((p) => p.stem === args.stem);
    if (row == null) {
      return fail({
        cause: "deploy_artifact_stem_absent",
        path: soPath,
        purpose: args.purpose,
        expectedEFlags: spec.requiredEFlags,
        detail: `stem=${args.stem}`,
      });
    }
    if (!existsSync(soPath)) {
      return fail({
        cause: "artifact_missing",
        path: soPath,
        purpose: args.purpose,
        expectedEFlags: spec.requiredEFlags,
      });
    }
    const sha = sha256HexOfFile(soPath);
    if (sha !== row.sha256) {
      return fail({
        cause: "deploy_artifact_sha_mismatch",
        path: soPath,
        purpose: args.purpose,
        expectedEFlags: spec.requiredEFlags,
        detail: `manifest=${row.sha256} file=${sha}`,
      });
    }
    const flags = readSbfEFlags(soPath);
    if (!flags.ok) {
      return fail({
        cause: flags.cause,
        path: soPath,
        purpose: args.purpose,
        expectedEFlags: spec.requiredEFlags,
      });
    }
    if (flags.eFlags !== spec.requiredEFlags) {
      return fail({
        cause: "artifact_wrong_arch",
        path: soPath,
        purpose: args.purpose,
        expectedEFlags: spec.requiredEFlags,
        measuredEFlags: flags.eFlags,
      });
    }
    if (row.eFlags !== flags.eFlags) {
      return fail({
        cause: "artifact_wrong_arch",
        path: soPath,
        purpose: args.purpose,
        expectedEFlags: spec.requiredEFlags,
        measuredEFlags: flags.eFlags,
        detail: `manifest_e_flags=0x${row.eFlags.toString(16)}`,
      });
    }
    return {
      ok: true,
      path: soPath,
      purpose: args.purpose,
      eFlags: flags.eFlags,
      gitHead: manifest.gitHead,
    };
  }

  // stand_preload — arch only
  if (!existsSync(soPath)) {
    return fail({
      cause: "artifact_missing",
      path: soPath,
      purpose: args.purpose,
      expectedEFlags: spec.requiredEFlags,
    });
  }
  const flags = readSbfEFlags(soPath);
  if (!flags.ok) {
    return fail({
      cause: flags.cause,
      path: soPath,
      purpose: args.purpose,
      expectedEFlags: spec.requiredEFlags,
    });
  }
  if (flags.eFlags !== spec.requiredEFlags) {
    return fail({
      cause: "artifact_wrong_arch",
      path: soPath,
      purpose: args.purpose,
      expectedEFlags: spec.requiredEFlags,
      measuredEFlags: flags.eFlags,
    });
  }
  return {
    ok: true,
    path: soPath,
    purpose: args.purpose,
    eFlags: flags.eFlags,
  };
}

/** Arch-only check used while building before the shipping manifest exists. */
function resolveArchOnly(args: {
  purpose: DeployArtifactPurpose;
  stem: string;
  soDir: string;
}): ResolveDeployArtifactResult {
  const spec = DEPLOY_ARTIFACT_PURPOSES[args.purpose];
  const soPath = join(args.soDir, `${args.stem}.so`);
  if (!existsSync(soPath)) {
    return fail({
      cause: "artifact_missing",
      path: soPath,
      purpose: args.purpose,
      expectedEFlags: spec.requiredEFlags,
    });
  }
  const flags = readSbfEFlags(soPath);
  if (!flags.ok) {
    return fail({
      cause: flags.cause,
      path: soPath,
      purpose: args.purpose,
      expectedEFlags: spec.requiredEFlags,
    });
  }
  if (flags.eFlags !== spec.requiredEFlags) {
    return fail({
      cause: "artifact_wrong_arch",
      path: soPath,
      purpose: args.purpose,
      expectedEFlags: spec.requiredEFlags,
      measuredEFlags: flags.eFlags,
    });
  }
  return {
    ok: true,
    path: soPath,
    purpose: args.purpose,
    eFlags: flags.eFlags,
  };
}

export function writeDeployArtifactManifest(
  soDirAbs: string,
  manifest: DeployArtifactManifest,
): string {
  const path = deployArtifactManifestPath(soDirAbs);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return path;
}

/**
 * Throw with named message. Shipping returns path + manifest gitHead.
 * Stand preload returns path only (gitHead undefined).
 */
export function requireDeployArtifact(args: {
  purpose: DeployArtifactPurpose;
  stem: string;
  soDir?: string;
  repoRoot?: string;
  gitState?: DeployArtifactGitState;
}): { path: string; gitHead?: string } {
  const result = resolveDeployArtifact(args);
  if (!result.ok) {
    throw new Error(formatDeployArtifactRefusal(result));
  }
  return { path: result.path, gitHead: result.gitHead };
}

/** Map evidence key / program dir slug hyphen form → crate directory name. */
export function programDirForStem(stem: string): string {
  return stem.replaceAll("_", "-");
}

/** Census evidence keys (shipping CLI default). */
export function commercialDeployArtifactStems(): readonly string[] {
  return SVM_COMMERCIAL_PROGRAM_CENSUS.map((r) => r.evidenceKey);
}

export type AdmitCommercialDeployStemOk = {
  ok: true;
  stem: string;
  programDir: string;
};
export type AdmitCommercialDeployStemFail = {
  ok: false;
  cause: "deploy_artifact_unknown_program";
  entry: string;
};
export type AdmitCommercialDeployStemResult =
  | AdmitCommercialDeployStemOk
  | AdmitCommercialDeployStemFail;

/** Admit a CLI --programs entry against the commercial census only. */
export function admitCommercialDeployStem(
  entry: string,
): AdmitCommercialDeployStemResult {
  const trimmed = entry.trim();
  if (trimmed.length === 0) {
    return { ok: false, cause: "deploy_artifact_unknown_program", entry };
  }
  const asStem = trimmed.includes("-")
    ? trimmed.replaceAll("-", "_")
    : trimmed;
  const row = SVM_COMMERCIAL_PROGRAM_CENSUS.find((r) => r.evidenceKey === asStem);
  if (row == null) {
    return { ok: false, cause: "deploy_artifact_unknown_program", entry };
  }
  return { ok: true, stem: row.evidenceKey, programDir: row.slug };
}

export type BuildDeployArtifactsArgs = {
  purpose: DeployArtifactPurpose;
  /** Crate directory names under svm/programs (hyphen form). */
  programDirs: readonly string[];
  repoRoot?: string;
  gitState?: DeployArtifactGitState;
  builtAt?: string;
  /** Inject for tests — default spawns cargo-build-sbf. */
  runBuild?: (args: {
    programDir: string;
    arch: "v0" | "v3";
    outDirAbs: string;
  }) => { status: number; stdout: string; stderr: string };
};

export type BuildDeployArtifactsResult = {
  purpose: DeployArtifactPurpose;
  outDirAbs: string;
  artifacts: ReadonlyArray<{
    stem: string;
    path: string;
    eFlags: number;
    sha256?: string;
    bytes?: number;
  }>;
  manifestPath?: string;
  gitHead?: string;
};

function defaultRunBuild(args: {
  programDir: string;
  arch: "v0" | "v3";
  outDirAbs: string;
  repoRoot: string;
}): { status: number; stdout: string; stderr: string } {
  mkdirSync(args.outDirAbs, { recursive: true });
  const cwd = join(args.repoRoot, "svm/programs", args.programDir);
  const r = spawnSync(
    "cargo-build-sbf",
    ["--arch", args.arch, "--sbf-out-dir", args.outDirAbs],
    { cwd, encoding: "utf8", env: process.env },
  );
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/**
 * Sole cargo-build-sbf door: purpose → arch + --sbf-out-dir, then arch-gated resolve.
 * Shipping refuses a dirty tree and writes deploy-artifact.manifest.json (this run's stems only).
 */
export function buildDeployArtifacts(
  args: BuildDeployArtifactsArgs,
): BuildDeployArtifactsResult {
  const spec = DEPLOY_ARTIFACT_PURPOSES[args.purpose];
  const repoRoot = args.repoRoot ?? REPO_ROOT;
  const outDirAbs = resolve(repoRoot, spec.outDirRel);
  mkdirSync(outDirAbs, { recursive: true });

  let shippingHead: string | undefined;
  if (args.purpose === "upgradeable_ship") {
    shippingHead = requireCleanGitForShippingBuild(repoRoot, args.gitState);
  }

  const runBuild =
    args.runBuild ??
    ((opts) =>
      defaultRunBuild({
        ...opts,
        repoRoot,
      }));

  for (const programDir of args.programDirs) {
    const built = runBuild({
      programDir,
      arch: spec.arch,
      outDirAbs,
    });
    if (built.status !== 0) {
      throw new Error(
        `svm-deploy-artifact: cargo-build-sbf failed purpose=${args.purpose} ` +
          `dir=${programDir} arch=${spec.arch}: ` +
          `${built.stderr || built.stdout}`.slice(0, 400),
      );
    }
  }

  const artifacts: Array<{
    stem: string;
    path: string;
    eFlags: number;
    sha256?: string;
    bytes?: number;
  }> = [];
  const manifestPrograms: DeployArtifactManifestProgram[] = [];

  for (const programDir of args.programDirs) {
    const stem = programDir.replaceAll("-", "_");
    const resolved = resolveArchOnly({
      purpose: args.purpose,
      stem,
      soDir: outDirAbs,
    });
    if (!resolved.ok) {
      throw new Error(formatDeployArtifactRefusal(resolved));
    }
    if (args.purpose === "upgradeable_ship") {
      const sha256 = sha256HexOfFile(resolved.path);
      const bytes = readFileSync(resolved.path).byteLength;
      artifacts.push({
        stem,
        path: resolved.path,
        eFlags: resolved.eFlags,
        sha256,
        bytes,
      });
      manifestPrograms.push({
        stem,
        file: `${stem}.so`,
        sha256,
        bytes,
        eFlags: resolved.eFlags,
      });
    } else {
      artifacts.push({
        stem,
        path: resolved.path,
        eFlags: resolved.eFlags,
      });
    }
  }

  if (args.purpose === "upgradeable_ship" && shippingHead !== undefined) {
    const manifest: DeployArtifactManifest = {
      purpose: "upgradeable_ship",
      gitHead: shippingHead,
      dirty: false,
      builtAt: args.builtAt ?? new Date().toISOString(),
      programs: manifestPrograms,
    };
    const manifestPath = writeDeployArtifactManifest(outDirAbs, manifest);
    return {
      purpose: args.purpose,
      outDirAbs,
      artifacts,
      manifestPath,
      gitHead: shippingHead,
    };
  }

  return { purpose: args.purpose, outDirAbs, artifacts };
}

/** Write a minimal ELF64 with given e_flags (tests / plants). */
export function synthesizeElf64WithEFlags(eFlags: number): Uint8Array {
  const buf = new Uint8Array(64);
  buf[0] = 0x7f;
  buf[1] = 0x45;
  buf[2] = 0x4c;
  buf[3] = 0x46;
  buf[4] = 2; // ELFCLASS64
  buf[5] = 1; // ELFDATA2LSB
  const view = new DataView(buf.buffer);
  view.setUint32(0x30, eFlags >>> 0, true);
  return buf;
}
