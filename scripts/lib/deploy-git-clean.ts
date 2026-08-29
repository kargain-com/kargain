/**
 * Refuse nuclear live deploy from a dirty git working tree (N6-9 V1 process finding).
 * Deploy-time solc metadata must be attributable to a single commit.
 */
import { execFileSync } from "node:child_process";

export function assertCleanGitTreeForDeploy(cwd = process.cwd()): string {
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
  }).trim();
  if (porcelain.length > 0) {
    throw new Error(
      "Nuclear live deploy refuses a dirty working tree. Commit or stash, then re-run.\n" +
        porcelain.split("\n").slice(0, 20).join("\n"),
    );
  }
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  }).trim();
}
