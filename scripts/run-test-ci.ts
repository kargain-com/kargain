/**
 * Derived `pnpm test:ci` — runs test:verify members minus deploy-machine enumerator.
 * File list is never hand-maintained; sole owner is lib/architecture/ci-verify-partition.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ciVerifyMembers } from "../lib/architecture/ci-verify-partition.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function main(): void {
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  const files = ciVerifyMembers(pkg.scripts);
  if (files.length === 0) {
    console.error("test:ci: derived member list is empty — refusing");
    process.exit(1);
  }
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", ...files],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

main();
