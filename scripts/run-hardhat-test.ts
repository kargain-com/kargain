/**
 * Derived `pnpm test` — runs only HARDHAT_NATIVE_SUITES via Hardhat.
 * File list is never hand-maintained here; sole owner is hardhat-test-suites.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HARDHAT_NATIVE_SUITES } from "../lib/architecture/hardhat-test-suites.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function main(): void {
  const files = [...HARDHAT_NATIVE_SUITES];
  if (files.length === 0) {
    console.error("pnpm test: Hardhat suite list is empty — refusing");
    process.exit(1);
  }
  const hardhatBin = join(ROOT, "node_modules", ".bin", "hardhat");
  const result = spawnSync(hardhatBin, ["test", ...files], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

main();
