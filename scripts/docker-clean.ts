/**
 * pnpm docker:clean — free local Docker space safely.
 * Removes harness leftovers (scoped from the owner), dangling images, and
 * build cache older than 72 h. Never touches the developer-stack project.
 *
 * Query first, then remove only what exists. Every non-zero exit is a failure.
 */
import { spawnSync } from "node:child_process";

import {
  DOCKER_CLEAN_SCRIPT,
  PERMITTED_UNSCOPED_REMOVALS,
  dockerCleanRefusal,
  dockerHarnesses,
  permittedRemovalsForScript,
  type DockerHarness,
} from "../lib/architecture/local-docker.ts";

type RunResult = { status: number; stdout: string; stderr: string };

function runDocker(args: string[]): RunResult {
  const r = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function systemDf(label: string): void {
  process.stdout.write(`\n==> docker system df (${label})\n`);
  const r = runDocker(["system", "df"]);
  process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
}

function idsFrom(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function main(): void {
  const refusal = dockerCleanRefusal();
  if (refusal) {
    process.stderr.write(`${refusal}\n`);
    process.exit(1);
  }

  let failed = false;
  const requireOk = (args: string[]): string => {
    const r = runDocker(args);
    if (r.status === 0) return r.stdout;
    process.stderr.write(
      `docker:clean: docker ${args.join(" ")} failed (${r.status})\n${r.stderr}`,
    );
    failed = true;
    return r.stdout;
  };

  systemDf("before");

  for (const h of dockerHarnesses()) {
    removeHarness(h, requireOk);
  }

  for (const entry of permittedRemovalsForScript(
    DOCKER_CLEAN_SCRIPT,
    PERMITTED_UNSCOPED_REMOVALS,
  )) {
    process.stdout.write(`==> docker ${entry.argv.join(" ")}\n`);
    requireOk([...entry.argv]);
  }

  systemDf("after");
  if (failed) process.exit(1);
}

function removeHarness(
  h: DockerHarness,
  requireOk: (args: string[]) => string,
): void {
  if (h.composeProject != null) {
    process.stdout.write(
      `==> Removing Compose project ${h.composeProject} (volumes)\n`,
    );
    // Absent project: `compose -p <name> down -v` exits 0.
    requireOk([
      "compose",
      "-p",
      h.composeProject,
      "down",
      "-v",
      "--remove-orphans",
      "--timeout",
      "5",
    ]);
    const vols = requireOk([
      "volume",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${h.composeProject}`,
    ]);
    for (const id of idsFrom(vols)) {
      requireOk(["volume", "rm", "-f", id]);
    }
    const nets = requireOk([
      "network",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${h.composeProject}`,
    ]);
    for (const id of idsFrom(nets)) {
      requireOk(["network", "rm", id]);
    }
  }

  for (const name of h.containerNames) {
    process.stdout.write(`==> Removing container ${name} (with volumes)\n`);
    // Exact name match; remove only if present.
    const found = requireOk([
      "ps",
      "-aq",
      "--filter",
      `name=^/${name}$`,
    ]);
    for (const id of idsFrom(found)) {
      requireOk(["rm", "-f", "-v", id]);
    }
  }

  for (const repo of h.imageRepositories) {
    process.stdout.write(`==> Removing images ${repo}:*\n`);
    const listed = requireOk([
      "images",
      repo,
      "--format",
      "{{.Repository}}:{{.Tag}}",
    ]);
    for (const ref of listed
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.endsWith(":<none>"))) {
      requireOk(["rmi", "-f", ref]);
    }
  }

  for (const label of h.imageLabels ?? []) {
    process.stdout.write(`==> Removing images with label ${label}\n`);
    const ids = requireOk([
      "images",
      "-q",
      "--filter",
      `label=${label}`,
    ]);
    for (const id of idsFrom(ids)) {
      requireOk(["rmi", "-f", id]);
    }
  }
}

main();
