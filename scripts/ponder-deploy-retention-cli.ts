/**
 * Emit DROP SCHEMA SQL for validated deployment schemas only (B6).
 *
 *   --drop-schema <name>           one schema
 *   --drop-schemas-json <json>     JSON string array
 *   --drop-schemas-file <path>     JSON array file
 *   --state <path>                 REQUIRED: deploy state file; its live/previous/
 *                                  pending/legacy schemas are the keep set (R9)
 */
import { readFileSync } from "node:fs";
import {
  dropDeploymentSchemaSql,
  keepSetFromState,
  retentionDropSql,
} from "./lib/ponder-deploy-retention.js";
import {
  DeployStateInvalidError,
  readPonderDeployStateFile,
} from "./lib/ponder-deploy-state.js";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function run(): void {
  const argv = process.argv.slice(2);
  const statePath = argValue(argv, "--state");
  if (!statePath) {
    process.stderr.write(
      "usage: ponder-deploy-retention-cli --state <path> (--drop-schema <name> | --drop-schemas-json <json> | --drop-schemas-file <path>)\n",
    );
    process.exit(2);
  }
  const keep = keepSetFromState(readPonderDeployStateFile(statePath));

  const one = argValue(argv, "--drop-schema");
  if (one) {
    process.stdout.write(`${dropDeploymentSchemaSql(one, keep)}\n`);
    process.exit(0);
  }

  const jsonArg = argValue(argv, "--drop-schemas-json");
  const fileArg = argValue(argv, "--drop-schemas-file");
  let raw: string | undefined = jsonArg;
  if (fileArg) {
    raw = readFileSync(fileArg, "utf8");
  }
  if (raw === undefined) {
    process.stderr.write(
      "usage: ponder-deploy-retention-cli --state <path> (--drop-schema <name> | --drop-schemas-json <json> | --drop-schemas-file <path>)\n",
    );
    process.exit(2);
  }
  let names: unknown;
  try {
    names = JSON.parse(raw);
  } catch {
    process.stderr.write("deploy_retention_refused: schemas JSON parse failed\n");
    process.exit(1);
  }
  if (!Array.isArray(names) || !names.every((n) => typeof n === "string")) {
    process.stderr.write("deploy_retention_refused: schemas must be string[]\n");
    process.exit(1);
  }
  process.stdout.write(retentionDropSql(names as string[], keep));
  process.exit(0);
}

function main(): void {
  try {
    run();
  } catch (err) {
    if (err instanceof DeployStateInvalidError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    if (err instanceof Error && err.message.startsWith("deploy_retention_refused")) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

main();
