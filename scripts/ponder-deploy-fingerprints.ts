/**
 * CLI: print identity + executable digests as GITHUB_OUTPUT lines (and JSON).
 * No environment values are printed.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computePonderExecutableFingerprint } from "./lib/ponder-executable-fingerprint.js";
import { computePonderIdentityFingerprint } from "./lib/ponder-identity-fingerprint.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function main(): void {
  const identity = computePonderIdentityFingerprint(ROOT);
  const executable = computePonderExecutableFingerprint(ROOT);

  // GitHub Actions step outputs
  process.stdout.write(`identity=${identity}\n`);
  process.stdout.write(`executable=${executable}\n`);

  // Human-readable summary on stderr (no secrets)
  process.stderr.write(
    `ponder fingerprints identity=${identity} executable=${executable}\n`,
  );
}

main();
