import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type {
  DeploymentManifest,
  SpokeDeploymentManifest,
  SvmDevnetEvidence,
} from "./load-deployment.js";

const INDEX_BUFFER = 10;

export function computeIndexFromBlock(blocks: Record<string, number | undefined>): number {
  const values = Object.values(blocks).filter(
    (b): b is number => typeof b === "number" && Number.isFinite(b),
  );
  if (values.length === 0) return 0;
  return Math.max(0, Math.min(...values) - INDEX_BUFFER);
}

export function writeDeploymentManifest(path: string, manifest: DeploymentManifest): void {
  const normalized: DeploymentManifest = {
    ...manifest,
    indexFromBlock: manifest.indexFromBlock ?? computeIndexFromBlock(manifest.blocks),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`);
}

export function writeSpokeDeploymentManifest(
  path: string,
  manifest: SpokeDeploymentManifest,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Blank overwrite of SVM Devnet evidence is removed.
 * Use {@link mergeAndWriteSvmDevnetEvidence} from `svm-devnet-evidence-write.ts`.
 */
export function writeSvmDevnetEvidence(_path: string, _evidence: SvmDevnetEvidence): never {
  throw new Error(
    "writeSvmDevnetEvidence blank overwrite removed — use mergeAndWriteSvmDevnetEvidence " +
      "(scripts/lib/svm-devnet-evidence-write.ts)",
  );
}

