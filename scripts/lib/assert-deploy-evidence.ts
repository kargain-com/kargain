/**
 * Sole owner: read-only checks that deploy-time compile evidence is present and
 * matches the manifest — before explorer verify restores/submits.
 *
 * Refuses (any):
 * 1. Manifest missing `buildInfoId` or `buildInfoSha256`
 * 2. `deployments/{chainId}.build-info.json` absent
 * 3. Stored file SHA-256 ≠ `buildInfoSha256`
 * 4. Manifest missing or empty `artifactDigests`
 * 5. On-disk `artifacts/` deployedBytecode digest ≠ recorded (rebuild since deploy)
 * 6. On-disk artifact `buildInfoId` ≠ manifest `buildInfoId`
 *
 * Does **not** compile, restore, or rewrite files.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  NUCLEAR_ARTIFACT_RELPATHS,
  artifactDeployedBytecodeDigest,
  deploymentBuildInfoPathForChain,
} from "./deployment-build-info.js";
import type { DeploymentManifest } from "./load-deployment.js";

export type DeployEvidenceOk = { ok: true };

export type DeployEvidenceFail = {
  ok: false;
  reasons: string[];
};

export type DeployEvidenceResult = DeployEvidenceOk | DeployEvidenceFail;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Assert manifest + on-disk evidence is intact for explorer verify.
 * Safe anytime; read-only.
 */
export function assertDeployEvidence(
  manifest: DeploymentManifest,
): DeployEvidenceResult {
  const reasons: string[] = [];
  const chainId = manifest.chainId;

  const buildInfoId = manifest.buildInfoId?.trim();
  const buildInfoSha256 = manifest.buildInfoSha256?.trim();
  if (!buildInfoId) {
    reasons.push("Manifest missing buildInfoId");
  }
  if (!buildInfoSha256) {
    reasons.push("Manifest missing buildInfoSha256");
  }

  const storedPath = deploymentBuildInfoPathForChain(chainId);
  if (!existsSync(storedPath)) {
    reasons.push(`Stored build-info absent at ${storedPath}`);
  } else if (buildInfoSha256) {
    const actual = sha256File(storedPath);
    if (actual !== buildInfoSha256) {
      reasons.push(
        `Stored build-info sha256 ${actual} ≠ manifest ${buildInfoSha256}`,
      );
    }
  }

  const digests = manifest.artifactDigests;
  if (!digests || Object.keys(digests).length === 0) {
    reasons.push("Manifest missing or empty artifactDigests");
  } else {
    for (const rel of NUCLEAR_ARTIFACT_RELPATHS) {
      const recorded = digests[rel];
      if (!recorded) {
        reasons.push(`artifactDigests missing entry for ${rel}`);
        continue;
      }
      const artifactPath = join(process.cwd(), "artifacts", rel);
      if (!existsSync(artifactPath)) {
        reasons.push(`On-disk artifact absent: ${rel}`);
        continue;
      }
      try {
        const now = artifactDeployedBytecodeDigest(rel);
        if (now !== recorded) {
          reasons.push(
            `Artifact ${rel} deployedBytecode digest drifted (${recorded} → ${now}) — rebuilt since deploy`,
          );
        }
      } catch (err) {
        reasons.push(
          err instanceof Error ? err.message : `Digest failed for ${rel}`,
        );
      }

      if (buildInfoId) {
        const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
          buildInfoId?: string;
        };
        const artId = artifact.buildInfoId?.trim();
        if (!artId) {
          reasons.push(`Artifact ${rel} missing buildInfoId`);
        } else if (artId !== buildInfoId) {
          reasons.push(
            `Artifact ${rel} buildInfoId ${artId} ≠ manifest ${buildInfoId}`,
          );
        }
      }
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true };
}

/** Format failure for CLI / verify.ts — one reason per line. */
export function formatDeployEvidenceFailure(result: DeployEvidenceFail): string {
  return [
    "Deploy evidence check failed — refuse explorer verify until fixed:",
    ...result.reasons.map((r) => `  - ${r}`),
  ].join("\n");
}
