/**
 * Sole owner: SBF deploy artifact directories, ELF e_flags arch gate, and
 * cargo-build-sbf invocation (--arch + --sbf-out-dir).
 *
 * Stand preload = arch v0 → svm/target/deploy (e_flags 0x0).
 * Shipping / upgradeable = arch v3 → svm/target/deploy-v3 (e_flags 0x3).
 * Paths never overwrite each other.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../..");

export const STAND_DEPLOY_DIR_REL = "svm/target/deploy";
export const SHIPPING_DEPLOY_DIR_REL = "svm/target/deploy-v3";

/** Measured: cargo-build-sbf --arch v0 → ELF64 e_flags. */
export const STAND_PRELOAD_E_FLAGS = 0x0;
/** Measured: cargo-build-sbf --arch v3 → ELF64 e_flags. */
export const SHIPPING_E_FLAGS = 0x3;

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

export function deployArtifactOutDirAbs(
  purpose: DeployArtifactPurpose,
  repoRoot: string = REPO_ROOT,
): string {
  return resolve(repoRoot, DEPLOY_ARTIFACT_PURPOSES[purpose].outDirRel);
}

export type ResolveDeployArtifactOk = {
  ok: true;
  path: string;
  purpose: DeployArtifactPurpose;
  eFlags: number;
};

export type ResolveDeployArtifactFail = {
  ok: false;
  cause:
    | "artifact_missing"
    | "artifact_wrong_arch"
    | "not_elf"
    | "unsupported_elf_class"
    | "truncated_elf";
  path: string;
  purpose: DeployArtifactPurpose;
  expectedEFlags: number;
  measuredEFlags?: number;
};

export type ResolveDeployArtifactResult =
  | ResolveDeployArtifactOk
  | ResolveDeployArtifactFail;

export function formatDeployArtifactRefusal(
  result: ResolveDeployArtifactFail,
): string {
  const base = `svm-deploy-artifact: ${result.cause} path=${result.path} purpose=${result.purpose}`;
  if (result.cause === "artifact_wrong_arch") {
    return (
      `${base} expected_e_flags=0x${result.expectedEFlags.toString(16)} ` +
      `measured_e_flags=0x${(result.measuredEFlags ?? 0).toString(16)}`
    );
  }
  return base;
}

/**
 * Resolve `{stem}.so` under soDir (default = purpose out dir) and refuse
 * wrong ELF arch by name.
 */
export function resolveDeployArtifact(args: {
  purpose: DeployArtifactPurpose;
  /** File stem without `.so` (evidence key or stand program name). */
  stem: string;
  soDir?: string;
  repoRoot?: string;
}): ResolveDeployArtifactResult {
  const spec = DEPLOY_ARTIFACT_PURPOSES[args.purpose];
  const repoRoot = args.repoRoot ?? REPO_ROOT;
  const soDir = args.soDir
    ? isAbsolute(args.soDir)
      ? args.soDir
      : resolve(repoRoot, args.soDir)
    : resolve(repoRoot, spec.outDirRel);
  const soPath = join(soDir, `${args.stem}.so`);
  if (!existsSync(soPath)) {
    return {
      ok: false,
      cause: "artifact_missing",
      path: soPath,
      purpose: args.purpose,
      expectedEFlags: spec.requiredEFlags,
    };
  }
  const flags = readSbfEFlags(soPath);
  if (!flags.ok) {
    return {
      ok: false,
      cause: flags.cause,
      path: soPath,
      purpose: args.purpose,
      expectedEFlags: spec.requiredEFlags,
    };
  }
  if (flags.eFlags !== spec.requiredEFlags) {
    return {
      ok: false,
      cause: "artifact_wrong_arch",
      path: soPath,
      purpose: args.purpose,
      expectedEFlags: spec.requiredEFlags,
      measuredEFlags: flags.eFlags,
    };
  }
  return {
    ok: true,
    path: soPath,
    purpose: args.purpose,
    eFlags: flags.eFlags,
  };
}

/** Throw with named message — upgrade/extend/CLI consumers. */
export function requireDeployArtifact(args: {
  purpose: DeployArtifactPurpose;
  stem: string;
  soDir?: string;
  repoRoot?: string;
}): string {
  const result = resolveDeployArtifact(args);
  if (!result.ok) {
    throw new Error(formatDeployArtifactRefusal(result));
  }
  return result.path;
}

/** Map evidence key / program dir slug hyphen form → crate directory name. */
export function programDirForStem(stem: string): string {
  return stem.replaceAll("_", "-");
}

export type BuildDeployArtifactsArgs = {
  purpose: DeployArtifactPurpose;
  /** Crate directory names under svm/programs (hyphen form). */
  programDirs: readonly string[];
  repoRoot?: string;
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
  artifacts: ReadonlyArray<{ stem: string; path: string; eFlags: number }>;
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
 */
export function buildDeployArtifacts(
  args: BuildDeployArtifactsArgs,
): BuildDeployArtifactsResult {
  const spec = DEPLOY_ARTIFACT_PURPOSES[args.purpose];
  const repoRoot = args.repoRoot ?? REPO_ROOT;
  const outDirAbs = resolve(repoRoot, spec.outDirRel);
  mkdirSync(outDirAbs, { recursive: true });

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

  const artifacts: Array<{ stem: string; path: string; eFlags: number }> = [];
  for (const programDir of args.programDirs) {
    const stem = programDir.replaceAll("-", "_");
    const resolved = resolveDeployArtifact({
      purpose: args.purpose,
      stem,
      soDir: outDirAbs,
      repoRoot,
    });
    if (!resolved.ok) {
      throw new Error(formatDeployArtifactRefusal(resolved));
    }
    artifacts.push({
      stem,
      path: resolved.path,
      eFlags: resolved.eFlags,
    });
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
