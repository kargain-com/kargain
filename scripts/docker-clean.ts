/**
 * pnpm docker:clean — free local Docker space safely.
 * Removes harness leftovers (scoped from the owner), dangling images, and
 * build cache older than 72 h. Never touches the developer-stack project.
 */
import { spawnSync } from "node:child_process";

import {
  DOCKER_CLEAN_SCRIPT,
  DEVELOPER_STACK_PROJECT,
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

/** Absence of the named target is success for rm / rmi / network rm / volume rm. */
function isAbsentTarget(args: string[], stderr: string): boolean {
  const verb = args[0];
  const msg = stderr.toLowerCase();
  if (verb === "rm" || verb === "rmi" || verb === "volume" || verb === "network") {
    if (
      /no such (container|image|volume|network)/.test(msg) ||
      /not found/.test(msg) ||
      /no such object/.test(msg)
    ) {
      return true;
    }
  }
  if (verb === "compose" && args.includes("down")) {
    if (
      /no container/.test(msg) ||
      /not found/.test(msg) ||
      /no such/.test(msg) ||
      /project.*not found/.test(msg)
    ) {
      return true;
    }
  }
  return false;
}

function systemDf(label: string): void {
  process.stdout.write(`\n==> docker system df (${label})\n`);
  const r = runDocker(["system", "df"]);
  process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
}

function main(): void {
  const refusal = dockerCleanRefusal();
  if (refusal) {
    process.stderr.write(`${refusal}\n`);
    process.exit(1);
  }

  let failed = false;
  const noteFailure = (args: string[], r: RunResult): void => {
    process.stderr.write(
      `docker:clean: docker ${args.join(" ")} failed (${r.status})\n${r.stderr}`,
    );
    failed = true;
  };

  const remove = (args: string[]): string => {
    const r = runDocker(args);
    if (r.status === 0) return r.stdout;
    if (isAbsentTarget(args, r.stderr)) return r.stdout;
    noteFailure(args, r);
    return r.stdout;
  };

  systemDf("before");

  for (const h of dockerHarnesses()) {
    removeHarness(h, remove);
  }

  for (const entry of permittedRemovalsForScript(
    DOCKER_CLEAN_SCRIPT,
    PERMITTED_UNSCOPED_REMOVALS,
  )) {
    process.stdout.write(`==> docker ${entry.argv.join(" ")}\n`);
    remove([...entry.argv]);
  }

  systemDf("after");
  if (failed) process.exit(1);
}

function removeHarness(
  h: DockerHarness,
  remove: (args: string[]) => string,
): void {
  if (h.composeProject != null) {
    if (h.composeProject === DEVELOPER_STACK_PROJECT) {
      process.stderr.write(
        `docker:clean: target resolves to developer-stack project ${DEVELOPER_STACK_PROJECT}\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      `==> Removing Compose project ${h.composeProject} (volumes)\n`,
    );
    remove([
      "compose",
      "-p",
      h.composeProject,
      "down",
      "-v",
      "--remove-orphans",
      "--timeout",
      "5",
    ]);
    const vols = remove([
      "volume",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${h.composeProject}`,
    ]);
    for (const id of vols.split("\n").map((s) => s.trim()).filter(Boolean)) {
      remove(["volume", "rm", "-f", id]);
    }
    const nets = remove([
      "network",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${h.composeProject}`,
    ]);
    for (const id of nets.split("\n").map((s) => s.trim()).filter(Boolean)) {
      remove(["network", "rm", id]);
    }
  }

  for (const name of h.containerNames) {
    process.stdout.write(`==> Removing container ${name} (with volumes)\n`);
    remove(["rm", "-f", "-v", name]);
  }

  for (const repo of h.imageRepositories) {
    process.stdout.write(`==> Removing images ${repo}:*\n`);
    const listed = remove([
      "images",
      repo,
      "--format",
      "{{.Repository}}:{{.Tag}}",
    ]);
    for (const ref of listed
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.endsWith(":<none>"))) {
      remove(["rmi", "-f", ref]);
    }
    const dangling = remove([
      "images",
      "-q",
      "--filter",
      `reference=${repo}`,
      "--filter",
      "dangling=true",
    ]);
    for (const id of dangling
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)) {
      remove(["rmi", "-f", id]);
    }
  }
}

main();
