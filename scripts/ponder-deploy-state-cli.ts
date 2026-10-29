/**
 * Sole CLI for reading/writing the Ponder deploy state file (A2 / C3).
 * Writes only through writePonderDeployStateFile — never invent a missing file.
 *
 *   --read <path>
 *   --write <path>              state JSON on stdin
 *   --state-json <file> --write <path>
 *   --write-json <path>         arbitrary JSON document on stdin (obs / plan scratch)
 *   --action-field <action.json> <field>   print a top-level string/number field
 *   --action-state-write <action.json> <state-path>   write action.state via owner
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  DeployStateInvalidError,
  parsePonderDeployStateFile,
  readPonderDeployStateFile,
  writePonderDeployStateFile,
  type PonderDeployState,
} from "./lib/ponder-deploy-state.js";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function readStdin(): string {
  return readFileSync(0, "utf8");
}

/** Phase is a DB observation (A1) — never a file field. Strip before parse. */
function stripPhaseField(raw: unknown): unknown {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw) && "phase" in raw) {
    const { phase: _phase, ...rest } = raw as Record<string, unknown>;
    return rest;
  }
  return raw;
}

function main(): void {
  const argv = process.argv.slice(2);

  if (argv[0] === "--read") {
    const path = argv[1];
    if (!path) {
      process.stderr.write("usage: --read <path>\n");
      process.exit(2);
    }
    try {
      const file = readPonderDeployStateFile(path);
      process.stdout.write(`${JSON.stringify(file)}\n`);
      process.exit(0);
    } catch (err) {
      if (err instanceof DeployStateInvalidError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  }

  if (argv[0] === "--write-json") {
    const path = argv[1];
    if (!path) {
      process.stderr.write("usage: --write-json <path>  (JSON on stdin)\n");
      process.exit(2);
    }
    const text = readStdin();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      process.stderr.write("deploy_state_invalid: JSON parse failed\n");
      process.exit(1);
    }
    writeFileSync(path, `${JSON.stringify(raw)}\n`, "utf8");
    process.exit(0);
  }

  if (argv[0] === "--action-field") {
    const actionPath = argv[1];
    const field = argv[2];
    if (!actionPath || !field) {
      process.stderr.write("usage: --action-field <action.json> <field>\n");
      process.exit(2);
    }
    const action = JSON.parse(readFileSync(actionPath, "utf8")) as Record<
      string,
      unknown
    >;
    const value = action[field];
    if (value === null || value === undefined) {
      process.stdout.write("\n");
      process.exit(0);
    }
    if (typeof value === "object") {
      process.stdout.write(`${JSON.stringify(value)}\n`);
    } else {
      process.stdout.write(`${String(value)}\n`);
    }
    process.exit(0);
  }

  if (argv[0] === "--action-state-write") {
    const actionPath = argv[1];
    const statePath = argv[2];
    if (!actionPath || !statePath) {
      process.stderr.write(
        "usage: --action-state-write <action.json> <state-path>\n",
      );
      process.exit(2);
    }
    const action = JSON.parse(readFileSync(actionPath, "utf8")) as {
      state?: unknown;
    };
    if (!action.state) {
      process.stderr.write("deploy_state_invalid: action missing state\n");
      process.exit(1);
    }
    try {
      const parsed = parsePonderDeployStateFile(stripPhaseField(action.state));
      writePonderDeployStateFile(statePath, parsed as PonderDeployState);
      process.exit(0);
    } catch (err) {
      if (err instanceof DeployStateInvalidError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  }

  const writePath = argValue(argv, "--write");
  if (writePath) {
    const fromFile = argValue(argv, "--state-json");
    const text = fromFile ? readFileSync(fromFile, "utf8") : readStdin();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      process.stderr.write("deploy_state_invalid: JSON parse failed\n");
      process.exit(1);
    }
    try {
      const parsed = parsePonderDeployStateFile(stripPhaseField(raw));
      writePonderDeployStateFile(writePath, parsed as PonderDeployState);
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
    "usage: ponder-deploy-state-cli --read|--write|--write-json|--action-field|--action-state-write\n",
  );
  process.exit(2);
}

main();
