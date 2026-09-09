/**
 * Refuse typecheck when svm/lab modules are absent.
 *
 * svm/tsconfig.json resolves @solana/* and Metaplex via paths into
 * svm/lab/node_modules (gitignored). Root `pnpm install` does not install that
 * package — CI and local typecheck must run `pnpm install:svm-lab` first.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Marker packages that svm/tsconfig paths require. */
export const SVM_LAB_TYPECHECK_MARKERS = [
  "node_modules/@solana/spl-token/package.json",
  "node_modules/@solana/web3.js/package.json",
] as const;

export function svmLabModulesMissing(
  labRoot: string = join(ROOT, "svm/lab"),
): string[] {
  return SVM_LAB_TYPECHECK_MARKERS.filter(
    (rel) => !existsSync(join(labRoot, rel)),
  );
}

export function svmLabModulesMissingMessage(missing: readonly string[]): string {
  return (
    `svm_lab_modules_missing: ${missing.join(", ")} — ` +
    `run \`pnpm install:svm-lab\` (required for svm/tsconfig; CI Install step must too)`
  );
}

function main(): void {
  const missing = svmLabModulesMissing();
  if (missing.length === 0) return;
  process.stderr.write(`${svmLabModulesMissingMessage(missing)}\n`);
  process.exit(1);
}

const isDirectRun =
  process.argv[1] != null &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isDirectRun) {
  main();
}
