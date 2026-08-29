/**
 * Sole owner: bind Hardhat solc build-info (+ nuclear contract artifacts) to a
 * deployment manifest under `deploymentsDirectory()` so explorer verify can use
 * the deploy-time compiler input instead of whatever `artifacts/` holds later.
 *
 * Layout (same directory as `{chainId}.json`, gitignored like manifests):
 *   `{chainId}.build-info.json`     — Hardhat build-info **input** (~0.6 MB)
 *   `{chainId}.artifacts/<relpath>` — contract artifact JSONs from that compile
 *
 * Manifest fields: `buildInfoId`, `buildInfoSha256`.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

import { deploymentsDirectory } from "./load-deployment.js";

/** Nuclear contracts whose artifacts must travel with the build-info. */
export const NUCLEAR_ARTIFACT_RELPATHS = [
  "contracts/Timelock48h.sol/Timelock48h.json",
  "contracts/KarProPass.sol/KarProPass.json",
  "contracts/KarProStaking.sol/KarProStaking.json",
  "contracts/KarPassport.sol/KarPassport.json",
  "contracts/FixedPriceConsignment.sol/FixedPriceConsignment.json",
  "contracts/AscendingConsignment.sol/AscendingConsignment.json",
  "contracts/lib/AscendingHoldLib.sol/AscendingHoldLib.json",
  "contracts/lib/AscendingOpenLib.sol/AscendingOpenLib.json",
  "contracts/KarPassportBridgeGateway.sol/KarPassportBridgeGateway.json",
  "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json",
] as const;

export type BuildInfoEvidence = {
  buildInfoId: string;
  buildInfoSha256: string;
  /** Bytes of the stored build-info file. */
  buildInfoBytes: number;
};

export function deploymentBuildInfoPathForChain(chainId: number): string {
  return join(deploymentsDirectory(), `${chainId}.build-info.json`);
}

export function deploymentArtifactsDirForChain(chainId: number): string {
  return join(deploymentsDirectory(), `${chainId}.artifacts`);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Hex(hexOrJson: string): string {
  return createHash("sha256").update(hexOrJson).digest("hex");
}

type ArtifactJson = {
  buildInfoId?: string;
  deployedBytecode?: string;
};

/**
 * Resolve the Hardhat build-info **input** file that produced `artifactRelPath`
 * under `artifactsDir` (default `artifacts/`).
 */
export function resolveBuildInfoPathForArtifact(
  artifactRelPath: string,
  artifactsDir = join(process.cwd(), "artifacts"),
): { buildInfoId: string; buildInfoPath: string } {
  const artifactPath = join(artifactsDir, artifactRelPath);
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing artifact ${artifactRelPath} (compile before deploy)`);
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as ArtifactJson;
  const buildInfoId = artifact.buildInfoId?.trim();
  if (!buildInfoId) {
    throw new Error(`Artifact ${artifactRelPath} missing buildInfoId`);
  }
  const buildInfoPath = join(artifactsDir, "build-info", `${buildInfoId}.json`);
  if (!existsSync(buildInfoPath)) {
    throw new Error(`Missing build-info ${buildInfoPath}`);
  }
  return { buildInfoId, buildInfoPath };
}

/**
 * Copy deploy-time build-info + nuclear artifacts next to the manifest.
 * Returns digests to embed in the manifest.
 */
export function persistDeploymentCompileEvidence(chainId: number): BuildInfoEvidence {
  const { buildInfoId, buildInfoPath } = resolveBuildInfoPathForArtifact(
    "contracts/KarPassport.sol/KarPassport.json",
  );
  // All nuclear artifacts in this compile unit must share the same buildInfoId.
  for (const rel of NUCLEAR_ARTIFACT_RELPATHS) {
    const { buildInfoId: id } = resolveBuildInfoPathForArtifact(rel);
    if (id !== buildInfoId) {
      throw new Error(
        `Artifact ${rel} buildInfoId ${id} ≠ Passport ${buildInfoId} (mixed compiles)`,
      );
    }
  }

  const destBuildInfo = deploymentBuildInfoPathForChain(chainId);
  mkdirSync(dirname(destBuildInfo), { recursive: true });
  copyFileSync(buildInfoPath, destBuildInfo);
  const buildInfoSha256 = sha256File(destBuildInfo);
  const buildInfoBytes = statSync(destBuildInfo).size;

  const artifactsRoot = join(process.cwd(), "artifacts");
  const destArtifacts = deploymentArtifactsDirForChain(chainId);
  rmSync(destArtifacts, { recursive: true, force: true });
  mkdirSync(destArtifacts, { recursive: true });
  for (const rel of NUCLEAR_ARTIFACT_RELPATHS) {
    const src = join(artifactsRoot, rel);
    const dest = join(destArtifacts, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }

  return { buildInfoId, buildInfoSha256, buildInfoBytes };
}

export function readStoredBuildInfoSha256(chainId: number): string | null {
  const p = deploymentBuildInfoPathForChain(chainId);
  if (!existsSync(p)) return null;
  return sha256File(p);
}

/**
 * Restore deploy-time build-info + artifacts into `artifacts/` for Hardhat verify.
 * Refuses if manifest digest does not match the stored file.
 */
export function restoreDeploymentCompileEvidence(params: {
  chainId: number;
  buildInfoId: string;
  buildInfoSha256: string;
}): void {
  const stored = deploymentBuildInfoPathForChain(params.chainId);
  if (!existsSync(stored)) {
    throw new Error(
      `No stored build-info at ${stored} — cannot verify from deploy-time input`,
    );
  }
  const actual = sha256File(stored);
  if (actual !== params.buildInfoSha256) {
    throw new Error(
      `Stored build-info sha256 ${actual} ≠ manifest ${params.buildInfoSha256}`,
    );
  }
  const artifactsDir = join(process.cwd(), "artifacts");
  const destInfo = join(artifactsDir, "build-info", `${params.buildInfoId}.json`);
  mkdirSync(dirname(destInfo), { recursive: true });
  copyFileSync(stored, destInfo);

  const srcArtifacts = deploymentArtifactsDirForChain(params.chainId);
  if (!existsSync(srcArtifacts)) {
    throw new Error(`No stored artifacts dir at ${srcArtifacts}`);
  }
  for (const rel of NUCLEAR_ARTIFACT_RELPATHS) {
    const src = join(srcArtifacts, rel);
    if (!existsSync(src)) {
      throw new Error(`Stored evidence missing artifact ${rel}`);
    }
    const dest = join(artifactsDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

/** SHA-256 of artifact `deployedBytecode` hex string (including 0x). */
export function artifactDeployedBytecodeDigest(artifactRelPath: string): string {
  const p = join(process.cwd(), "artifacts", artifactRelPath);
  const j = JSON.parse(readFileSync(p, "utf8")) as ArtifactJson;
  if (!j.deployedBytecode?.startsWith("0x")) {
    throw new Error(`Artifact ${artifactRelPath} missing deployedBytecode`);
  }
  return sha256Hex(j.deployedBytecode);
}

export function listStoredEvidenceFiles(chainId: number): string[] {
  const out: string[] = [];
  const bi = deploymentBuildInfoPathForChain(chainId);
  if (existsSync(bi)) out.push(relative(process.cwd(), bi));
  const ad = deploymentArtifactsDirForChain(chainId);
  if (!existsSync(ad)) return out;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(process.cwd(), full));
    }
  };
  walk(ad);
  return out;
}
