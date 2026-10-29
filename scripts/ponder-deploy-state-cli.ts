/**
 * Sole CLI for reading/writing the Ponder deploy state file (ADR 0015 §i).
 *
 *   --read <path> --pre-cutover <0|1>
 *   --write <path>                 state JSON on stdin (post-cutover shape)
 *   --write-json <path>            arbitrary JSON on stdin (obs / plan scratch)
 *   --clear-pending <path> --pre-cutover <0|1>
 *   --live-slot <path> --pre-cutover <0|1>
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  DeployStateInvalidError,
  loadDeployState,
  parsePostCutoverState,
  writeDeployState,
  type PonderDeployState,
} from "./lib/ponder-deploy-state.js";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function readStdin(): string {
  return readFileSync(0, "utf8");
}

function preCutoverFlag(argv: string[]): boolean {
  const v = argValue(argv, "--pre-cutover");
  return v === "1" || v === "true";
}

function main(): void {
  const argv = process.argv.slice(2);

  if (argv[0] === "--write-json") {
    const path = argv[1];
    if (!path) {
      process.stderr.write("usage: --write-json <path>\n");
      process.exit(2);
    }
    writeFileSync(path, readStdin(), "utf8");
    process.exit(0);
  }

  if (argv[0] === "--write") {
    const path = argv[1];
    if (!path) {
      process.stderr.write("usage: --write <path>\n");
      process.exit(2);
    }
    try {
      const state = parsePostCutoverState(JSON.parse(readStdin()));
      writeDeployState(path, state);
      process.exit(0);
    } catch (err) {
      if (err instanceof DeployStateInvalidError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  }

  if (argv[0] === "--read") {
    const path = argv[1];
    if (!path) {
      process.stderr.write("usage: --read <path> --pre-cutover <0|1>\n");
      process.exit(2);
    }
    try {
      const loaded = loadDeployState(path, preCutoverFlag(argv));
      process.stdout.write(`${JSON.stringify(loaded)}\n`);
      process.exit(0);
    } catch (err) {
      if (err instanceof DeployStateInvalidError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  }

  if (argv[0] === "--live-slot") {
    const path = argv[1];
    if (!path) {
      process.stderr.write("usage: --live-slot <path> --pre-cutover <0|1>\n");
      process.exit(2);
    }
    try {
      const loaded = loadDeployState(path, preCutoverFlag(argv));
      if (loaded.kind === "post_cutover" && loaded.state.live) {
        process.stdout.write(`${loaded.state.live.slot}\n`);
      }
      process.exit(0);
    } catch (err) {
      if (err instanceof DeployStateInvalidError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  }

  if (argv[0] === "--clear-pending") {
    const path = argv[1];
    if (!path) {
      process.stderr.write(
        "usage: --clear-pending <path> --pre-cutover <0|1>\n",
      );
      process.exit(2);
    }
    try {
      const loaded = loadDeployState(path, preCutoverFlag(argv));
      if (loaded.kind !== "post_cutover") {
        process.stderr.write("deploy_state_invalid: not post_cutover\n");
        process.exit(1);
      }
      const next: PonderDeployState = { ...loaded.state, pending: null };
      writeDeployState(path, next);
      process.exit(0);
    } catch (err) {
      if (err instanceof DeployStateInvalidError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  }

  process.stderr.write(
    "usage: ponder-deploy-state-cli --read|--write|--write-json|--clear-pending|--live-slot\n",
  );
  process.exit(2);
}

main();
